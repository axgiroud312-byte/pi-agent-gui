import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import { RpcJsonlDecoder } from './rpc-jsonl.js';

export interface RpcResponse {
  type: 'response';
  id?: string;
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface PiRpcClientOptions {
  executable: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
}

export interface RpcDiagnostic {
  kind: 'stderr' | 'protocol' | 'process';
  message: string;
}

export interface RpcExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export type RpcErrorCode =
  | 'NOT_RUNNING'
  | 'DISPOSED'
  | 'SPAWN_FAILED'
  | 'PROCESS_EXITED'
  | 'IO_ERROR'
  | 'PROTOCOL_ERROR'
  | 'TIMEOUT'
  | 'LIMIT_EXCEEDED'
  | 'INVALID_RECORD';

/** A transport failure is not evidence that a command did not execute. */
export class PiRpcError extends Error {
  readonly code: RpcErrorCode;
  readonly delivery: 'not-sent' | 'unknown';

  constructor(code: RpcErrorCode, message: string, delivery: 'not-sent' | 'unknown' = 'not-sent') {
    super(message);
    this.name = 'PiRpcError';
    this.code = code;
    this.delivery = delivery;
  }
}

/** Byte limits include JSON syntax; outbound record size also includes the LF. */
export const RPC_LIMITS = Object.freeze({
  maxRecordBytes: 16 * 1024 * 1024,
  maxQueuedBytes: 32 * 1024 * 1024,
  maxPendingRequests: 1024,
  maxQueuedRecords: 1024,
  diagnosticPreviewCharacters: 512,
});

const DEFAULT_TIMEOUT_MS = 30_000;
const TERMINATE_GRACE_MS = 500;
const EXIT_DRAIN_MS = 1_000;

interface PendingRequest {
  command: string;
  sent: boolean;
  timer: ReturnType<typeof setTimeout>;
  write: OutboundWrite | undefined;
  resolve: (response: RpcResponse) => void;
  reject: (error: PiRpcError) => void;
}

interface OutboundWrite {
  buffer: Buffer;
  started: boolean;
  finished: boolean;
  onStart: () => void;
  onFlush: () => void;
  onFailure: (error: PiRpcError) => void;
}

type ClientEvents = {
  record: [record: Record<string, unknown>];
  diagnostic: [diagnostic: RpcDiagnostic];
  exit: [exit: RpcExit];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateTimeout(timeout: number): void {
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) {
    throw new PiRpcError('INVALID_RECORD', 'RPC timeout must be an integer between 1 and 2147483647 ms');
  }
}

function deliveryError(error: PiRpcError, sent: boolean): PiRpcError {
  return new PiRpcError(error.code, error.message, sent ? 'unknown' : 'not-sent');
}

/**
 * One client owns one child lifetime. The host owns session generations and any
 * explicit recovery. This transport never restarts, retries, or projects events.
 */
export class PiRpcClient extends EventEmitter<ClientEvents> {
  private readonly options: PiRpcClientOptions;
  private readonly timeoutMs: number;
  private child: ChildProcessWithoutNullStreams | undefined;
  private state: 'new' | 'starting' | 'running' | 'stopping' | 'closed' = 'new';
  private disposed = false;
  private terminalError: PiRpcError | undefined;
  private startPromise: Promise<void> | undefined;
  private resolveStart: (() => void) | undefined;
  private rejectStart: ((error: PiRpcError) => void) | undefined;
  private disposePromise: Promise<void> | undefined;
  private readonly closedPromise: Promise<void>;
  private resolveClosed!: () => void;
  private exitResult: RpcExit | undefined;
  private exitEmitted = false;
  private terminateTimer: ReturnType<typeof setTimeout> | undefined;
  private drainTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly writes: OutboundWrite[] = [];
  private activeWrite: OutboundWrite | undefined;
  private queuedBytes = 0;
  private waitingDrain = false;
  private readonly stdoutDecoder: RpcJsonlDecoder;
  private readonly stderrDecoder = new StringDecoder('utf8');
  private stderrEnded = false;

  constructor(options: PiRpcClientOptions) {
    super();
    this.timeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    validateTimeout(this.timeoutMs);
    this.options = { ...options, args: [...options.args] };
    if (options.env) this.options.env = { ...options.env };
    this.closedPromise = new Promise((resolve) => { this.resolveClosed = resolve; });
    this.stdoutDecoder = new RpcJsonlDecoder(
      RPC_LIMITS.maxRecordBytes,
      (line) => this.handleLine(line),
      (message) => this.diagnostic('protocol', message),
    );
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  /** Resolves on OS spawn, without issuing get_state or any other command. */
  start(): Promise<void> {
    if (this.disposed) return Promise.reject(this.unavailableError());
    if (this.state === 'starting' || this.state === 'running') return this.startPromise!;
    if (this.state !== 'new') return Promise.reject(this.unavailableError());
    this.state = 'starting';
    this.startPromise = new Promise<void>((resolve, reject) => {
      this.resolveStart = resolve;
      this.rejectStart = reject;
    });

    try {
      const child = spawn(this.options.executable, this.options.args, {
        cwd: this.options.cwd,
        env: { ...process.env, ...this.options.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      });
      this.child = child;
      child.once('spawn', () => {
        if (this.state !== 'starting') return;
        this.state = 'running';
        this.resolveStart?.();
        this.resolveStart = undefined;
        this.rejectStart = undefined;
      });
      child.on('error', (error) => this.fail(new PiRpcError(
        child.pid === undefined ? 'SPAWN_FAILED' : 'IO_ERROR',
        `RPC process error: ${messageOf(error)}`,
      )));
      child.once('exit', (code, signal) => this.onExit({ code, signal }));
      child.once('close', (code, signal) => this.finishClose({ code, signal }));
      child.stdout.on('data', this.onStdout);
      child.stdout.once('end', this.onStdoutEnd);
      child.stdout.on('error', (error) => this.fail(new PiRpcError('IO_ERROR', `RPC stdout error: ${messageOf(error)}`)));
      child.stderr.on('data', this.onStderr);
      child.stderr.once('end', this.onStderrEnd);
      child.stderr.on('error', (error) => this.fail(new PiRpcError('IO_ERROR', `RPC stderr error: ${messageOf(error)}`)));
      child.stdin.on('drain', this.onDrain);
      child.stdin.on('error', (error) => this.fail(new PiRpcError('IO_ERROR', `RPC stdin error: ${messageOf(error)}`)));
    } catch (error) {
      this.fail(new PiRpcError('SPAWN_FAILED', `Could not spawn RPC process: ${messageOf(error)}`));
      this.finishClose();
    }
    return this.startPromise;
  }

  /** Resolves for both Pi success and Pi rejection responses; rejects transport failures. */
  async request(command: { type: string; [key: string]: unknown }, timeoutMs = this.timeoutMs): Promise<RpcResponse> {
    this.assertRunning();
    validateTimeout(timeoutMs);
    if (!isObject(command) || typeof command.type !== 'string' || command.type.length === 0) {
      throw new PiRpcError('INVALID_RECORD', 'RPC command must be an object with a nonempty type');
    }
    if (this.pending.size >= RPC_LIMITS.maxPendingRequests) {
      throw new PiRpcError('LIMIT_EXCEEDED', 'Too many pending RPC requests');
    }
    const id = randomUUID();
    const commandType = command.type;
    const buffer = this.serialize({ ...command, type: commandType, id });
    this.assertCapacity(buffer.length);

    return new Promise<RpcResponse>((resolve, reject) => {
      const pending: PendingRequest = {
        command: commandType,
        sent: false,
        write: undefined,
        resolve,
        reject,
        timer: setTimeout(() => {
          if (pending.write) this.removeUnsent(pending.write);
          this.rejectRequest(id, new PiRpcError(
            'TIMEOUT',
            `RPC ${commandType} timed out after ${timeoutMs} ms; ${pending.sent ? 'delivery unknown' : 'not sent'}`,
          ));
        }, timeoutMs),
      };
      const write: OutboundWrite = {
        buffer,
        started: false,
        finished: false,
        onStart: () => { pending.sent = true; },
        onFlush: () => { pending.write = undefined; },
        onFailure: (error) => this.rejectRequest(id, error),
      };
      pending.write = write;
      this.pending.set(id, pending);
      this.enqueue(write);
    });
  }

  /** Preserves extension correlation IDs; completion means flushed, not acknowledged. */
  async notify(record: Record<string, unknown>): Promise<void> {
    this.assertRunning();
    const buffer = this.serialize(record);
    this.assertCapacity(buffer.length);
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeUnsent(write);
        reject(new PiRpcError(
          'TIMEOUT',
          `RPC notification write timed out after ${this.timeoutMs} ms; ${write.started ? 'delivery unknown' : 'not sent'}`,
          write.started ? 'unknown' : 'not-sent',
        ));
      }, this.timeoutMs);
      const write: OutboundWrite = {
        buffer,
        started: false,
        finished: false,
        onStart: () => {},
        onFlush: () => { clearTimeout(timer); resolve(); },
        onFailure: (error) => { clearTimeout(timer); reject(deliveryError(error, write.started)); },
      };
      this.enqueue(write);
    });
  }

  /** Cancels queued writes, settles callers, terminates the child, and awaits cleanup. */
  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.stdoutDecoder.discard();
    const error = new PiRpcError('DISPOSED', 'RPC client disposed');
    this.terminalError ??= error;
    this.rejectStarting(error);
    this.rejectOperations(error);
    this.disposePromise = this.closedPromise;
    if (this.state === 'new') this.finishClose();
    else if (this.state !== 'closed') {
      this.state = 'stopping';
      this.terminate();
    }
    return this.disposePromise;
  }

  private readonly onStdout = (chunk: Buffer): void => {
    if (!this.disposed && this.state !== 'closed') this.stdoutDecoder.push(chunk);
  };

  private readonly onStdoutEnd = (): void => { this.stdoutDecoder.end(); };

  private readonly onStderr = (chunk: Buffer): void => {
    if (this.disposed || this.state === 'closed') return;
    // No accumulated stderr log: consumers choose their own retention policy.
    const text = this.stderrDecoder.write(chunk);
    if (text) this.diagnostic('stderr', text);
  };

  private readonly onStderrEnd = (): void => {
    if (this.stderrEnded) return;
    this.stderrEnded = true;
    const text = this.stderrDecoder.end();
    if (text && !this.disposed) this.diagnostic('stderr', text);
  };

  private readonly onDrain = (): void => {
    this.waitingDrain = false;
    this.pump();
  };

  private handleLine(line: string): void {
    if (this.disposed || this.state === 'closed' || line.trim().length === 0) return;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      this.diagnostic('protocol', `Malformed JSON on stdout: ${JSON.stringify(line.slice(0, RPC_LIMITS.diagnosticPreviewCharacters))}`);
      return;
    }
    if (!isObject(record)) {
      this.diagnostic('protocol', 'stdout JSON record must be an object');
      return;
    }
    if (record.type !== 'response') {
      this.emit('record', record);
      return;
    }

    const id = typeof record.id === 'string' ? record.id : undefined;
    const pending = id === undefined ? undefined : this.pending.get(id);
    let problem: string | undefined;
    if (typeof record.command !== 'string' || record.command.length === 0
      || typeof record.success !== 'boolean'
      || (record.id !== undefined && typeof record.id !== 'string')
      || (record.error !== undefined && typeof record.error !== 'string')
      || (record.success === false && typeof record.error !== 'string')) {
      problem = 'Malformed RPC response envelope';
    } else if (!pending) {
      problem = 'RPC response has no matching in-flight request (missing, unknown, or late ID)';
    } else if (record.command !== pending.command) {
      problem = `RPC response command mismatch: expected ${pending.command}, received ${record.command}`;
    } else if (!pending.sent) {
      problem = 'RPC response arrived before its request was sent';
    }
    if (problem) {
      if (id !== undefined && pending) {
        if (pending.write) this.removeUnsent(pending.write);
        this.rejectRequest(id, new PiRpcError('PROTOCOL_ERROR', problem));
      }
      this.diagnostic('protocol', problem);
      return;
    }
    if (id === undefined || pending === undefined) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.resolve(record as unknown as RpcResponse);
  }

  private serialize(record: Record<string, unknown>): Buffer {
    if (!isObject(record)) throw new PiRpcError('INVALID_RECORD', 'RPC record must be an object');
    let json: string;
    try {
      const plain = { ...record };
      if (typeof plain.toJSON === 'function') throw new Error('Root toJSON overrides are not supported');
      json = JSON.stringify(plain);
    } catch (error) {
      throw new PiRpcError('INVALID_RECORD', `RPC record is not JSON serializable: ${messageOf(error)}`);
    }
    if (Buffer.byteLength(json, 'utf8') + 1 > RPC_LIMITS.maxRecordBytes) {
      throw new PiRpcError('LIMIT_EXCEEDED', `RPC record exceeds ${RPC_LIMITS.maxRecordBytes} bytes`);
    }
    return Buffer.from(`${json}\n`, 'utf8');
  }

  private assertCapacity(bytes: number): void {
    if (this.queuedBytes + bytes > RPC_LIMITS.maxQueuedBytes
      || this.writes.length + (this.activeWrite ? 1 : 0) >= RPC_LIMITS.maxQueuedRecords) {
      throw new PiRpcError('LIMIT_EXCEEDED', 'RPC stdin queue is full; record was not sent');
    }
  }

  private enqueue(write: OutboundWrite): void {
    this.queuedBytes += write.buffer.length;
    this.writes.push(write);
    this.pump();
  }

  private pump(): void {
    if (this.state !== 'running' || this.activeWrite || this.waitingDrain) return;
    const write = this.writes.shift();
    if (!write) return;
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) {
      this.writes.unshift(write);
      this.fail(new PiRpcError('IO_ERROR', 'RPC stdin is not writable'));
      return;
    }
    this.activeWrite = write;
    write.started = true;
    write.onStart();
    try {
      // At most one write is submitted to Node. A false return gates the next
      // write on drain; callbacks independently report flush/errors.
      this.waitingDrain = !stdin.write(write.buffer, (error) => {
        if (write.finished) return;
        if (error) {
          this.fail(new PiRpcError('IO_ERROR', `RPC stdin write failed: ${messageOf(error)}`));
          return;
        }
        write.finished = true;
        this.queuedBytes -= write.buffer.length;
        this.activeWrite = undefined;
        write.onFlush();
        this.pump();
      });
    } catch (error) {
      this.fail(new PiRpcError('IO_ERROR', `RPC stdin write failed: ${messageOf(error)}`));
    }
  }

  private removeUnsent(write: OutboundWrite): void {
    if (write.started || write.finished) return;
    const index = this.writes.indexOf(write);
    if (index === -1) return;
    this.writes.splice(index, 1);
    this.queuedBytes -= write.buffer.length;
    write.finished = true;
  }

  private rejectRequest(id: string, error: PiRpcError): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.reject(deliveryError(error, pending.sent));
  }

  private rejectOperations(error: PiRpcError): void {
    for (const id of this.pending.keys()) this.rejectRequest(id, error);
    const writes = this.writes.splice(0);
    if (this.activeWrite) writes.unshift(this.activeWrite);
    this.activeWrite = undefined;
    this.queuedBytes = 0;
    this.waitingDrain = false;
    for (const write of writes) {
      write.finished = true;
      write.onFailure(error);
    }
  }

  private rejectStarting(error: PiRpcError): void {
    this.rejectStart?.(error);
    this.resolveStart = undefined;
    this.rejectStart = undefined;
  }

  private fail(error: PiRpcError): void {
    if (this.state === 'closed') return;
    const firstFailure = this.terminalError === undefined;
    this.terminalError ??= error;
    this.state = 'stopping';
    this.rejectStarting(this.terminalError);
    this.rejectOperations(this.terminalError);
    if (firstFailure) this.diagnostic('process', error.message);
    this.terminate();
  }

  private onExit(exit: RpcExit): void {
    if (this.state === 'closed') return;
    this.exitResult = exit;
    this.state = 'stopping';
    clearTimeout(this.terminateTimer);
    this.terminateTimer = undefined;
    this.terminalError ??= this.exitError(exit);
    this.rejectStarting(this.terminalError);
    // exit can precede stdout EOF. Give the final response/event a chance to
    // arrive, but do not wait forever on pipes inherited by a descendant.
    this.drainTimer = setTimeout(() => {
      this.diagnostic('process', 'RPC process exited but stdio did not close; ending the drain window');
      this.finishClose(exit);
    }, EXIT_DRAIN_MS);
  }

  private finishClose(exit?: RpcExit): void {
    if (this.state === 'closed') return;
    this.stdoutDecoder.end();
    this.onStderrEnd();
    const result = this.exitResult ?? exit;
    const error = this.terminalError ?? (result ? this.exitError(result) : new PiRpcError('DISPOSED', 'RPC client closed'));
    this.terminalError = error;
    this.state = 'closed';
    this.rejectStarting(error);
    this.rejectOperations(error);
    clearTimeout(this.terminateTimer);
    clearTimeout(this.drainTimer);
    this.terminateTimer = undefined;
    this.drainTimer = undefined;
    const child = this.child;
    this.child = undefined;
    if (child) {
      child.stdout.off('data', this.onStdout);
      child.stdout.off('end', this.onStdoutEnd);
      child.stderr.off('data', this.onStderr);
      child.stderr.off('end', this.onStderrEnd);
      child.stdin.off('drain', this.onDrain);
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
    }
    this.resolveClosed();
    if (result && !this.exitEmitted) {
      this.exitEmitted = true;
      if (!this.disposed) this.diagnostic('process', this.exitError(result).message);
      this.emit('exit', result);
    }
  }

  private terminate(): void {
    const child = this.child;
    if (!child || this.exitResult || this.terminateTimer || child.pid === undefined) return;
    child.stdin.destroy();
    this.terminateTimer = setTimeout(() => {
      this.terminateTimer = undefined;
      if (this.state !== 'closed' && !this.exitResult) this.signal(child, 'SIGKILL');
    }, TERMINATE_GRACE_MS);
    this.signal(child, 'SIGTERM');
  }

  private signal(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
    try {
      child.kill(signal);
    } catch (error) {
      this.diagnostic('process', `Could not send ${signal} to RPC child: ${messageOf(error)}`);
    }
  }

  private exitError(exit: RpcExit): PiRpcError {
    return new PiRpcError('PROCESS_EXITED', `RPC process exited (code=${exit.code}, signal=${exit.signal})`);
  }

  private unavailableError(): PiRpcError {
    if (this.disposed) return new PiRpcError('DISPOSED', 'RPC client disposed');
    return this.terminalError
      ? deliveryError(this.terminalError, false)
      : new PiRpcError('NOT_RUNNING', 'RPC client is not running; await start() first');
  }

  private assertRunning(): void {
    if (this.state !== 'running') throw this.unavailableError();
  }

  private diagnostic(kind: RpcDiagnostic['kind'], message: string): void {
    // stderr is emitted in stream-sized chunks; protocol/process messages never
    // retain an arbitrarily large malformed envelope or command name.
    this.emit('diagnostic', {
      kind,
      message: kind === 'stderr' ? message : message.slice(0, RPC_LIMITS.diagnosticPreviewCharacters + 128),
    });
  }
}
