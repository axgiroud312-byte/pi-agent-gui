import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, dirname, isAbsolute } from 'node:path';
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { PiRpcClient, PiRpcError } from '../runtime/pi-rpc-client.js';
import { PI_VERSION, type AppSnapshot, type LaunchProfile, type SessionSnapshot, type Workspace } from '../shared/contracts.js';
import { diagnosticRecord, diagnosticText, errorMessage, launchProfile, object, text } from './validation.js';
import { MessageProjection, projectMessage } from './message-projection.js';
import { acquireSessionLease } from './session-lease.js';

const execute = promisify(execFile);
const busyPhases = new Set(['starting', 'submitting', 'accepted', 'running', 'retrying', 'compacting', 'waiting']);

interface SessionRuntime {
  snapshot: SessionSnapshot;
  client: PiRpcClient;
  projection: MessageProjection;
  closing: boolean;
  uncertain: boolean;
  runError: boolean;
  runStarted: boolean;
  releaseLease?: () => Promise<void>;
}

export interface WorkspaceHostOptions { profile: LaunchProfile; settingsPath: string; version: string }

export class WorkspaceHost extends EventEmitter<{ change: [] }> {
  private profile: LaunchProfile;
  private workspaces: Workspace[] = [];
  private readonly sessions = new Map<string, SessionRuntime>();
  private readonly nativeOwners = new Map<string, string>();
  private writes: Promise<void> = Promise.resolve();
  private changeTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(private readonly options: WorkspaceHostOptions) {
    super();
    this.profile = launchProfile(options.profile);
  }

  async initialize(profileOverride?: LaunchProfile): Promise<void> {
    try {
      const saved = object(JSON.parse(await readFile(this.options.settingsPath, 'utf8')));
      if (saved.version !== 1) throw new Error('不支持的工作台配置版本；原配置已保留');
      this.profile = launchProfile(saved.profile);
      if (Array.isArray(saved.workspaces)) {
        this.workspaces = saved.workspaces.map(item => {
          const data = object(item);
          return { id: text(data.id, '工作区 ID'), path: text(data.path, '工作区路径'), name: text(data.name, '工作区名称'), target: 'local' as const, branch: typeof data.branch === 'string' ? data.branch : null };
        });
      }
    } catch (error) {
      if (object(error).code !== 'ENOENT') throw error;
    }
    if (profileOverride) this.profile = launchProfile(profileOverride);
  }

  snapshot(): AppSnapshot {
    return structuredClone({ workspaces: this.workspaces, sessions: [...this.sessions.values()].map(item => this.sessionView(item)), profile: this.profile, version: this.options.version });
  }

  private submissionBlock(runtime: SessionRuntime): string | undefined {
    if (runtime.closing || runtime.snapshot.phase === 'exited') return '会话进程不可用，请新建会话';
    if (runtime.uncertain) return '此前请求状态待核实，请查看诊断并新建会话；未自动重放输入';
    if (busyPhases.has(runtime.snapshot.phase)) return '会话正在运行，请等待结束';
    return undefined;
  }

  private sessionView(runtime: SessionRuntime): SessionSnapshot {
    const reason = this.submissionBlock(runtime);
    return { ...runtime.snapshot, canSubmit: !reason, submissionBlockedReason: reason };
  }

  private async releaseOwnership(runtime: SessionRuntime): Promise<void> {
    const nativeId = runtime.snapshot.nativeSessionId;
    if (nativeId && this.nativeOwners.get(nativeId) === runtime.snapshot.id) this.nativeOwners.delete(nativeId);
    await runtime.releaseLease?.();
  }

  private changed(): void {
    if (!this.changeTimer && !this.disposed) this.changeTimer = setTimeout(() => { this.changeTimer = undefined; this.emit('change'); }, 16);
  }

  private persist(): Promise<void> {
    const data = JSON.stringify({ version: 1, profile: this.profile, workspaces: this.workspaces }, null, 2);
    const operation = this.writes.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.options.settingsPath), { recursive: true });
      const temporary = `${this.options.settingsPath}.${randomUUID()}.tmp`;
      await writeFile(temporary, data, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, this.options.settingsPath);
    });
    this.writes = operation;
    return operation;
  }

  async saveProfile(value: unknown): Promise<LaunchProfile> {
    const next = launchProfile(value);
    const previous = this.profile;
    this.profile = next;
    try { await this.persist(); } catch (error) { this.profile = previous; throw error; }
    this.changed();
    return structuredClone(next);
  }

  async openWorkspace(value: unknown): Promise<Workspace> {
    const requested = text(value, '工作区路径');
    if (!isAbsolute(requested)) throw new Error('工作区路径必须为绝对目录');
    const path = await realpath(requested);
    if (!(await stat(path)).isDirectory()) throw new Error('工作区必须是目录');
    const existing = this.workspaces.find(workspace => workspace.path === path);
    if (existing) return structuredClone(existing);
    let branch: string | null = null;
    try { branch = (await execute('git', ['-C', path, 'branch', '--show-current'], { windowsHide: true, timeout: 5_000 })).stdout.trim() || '(detached HEAD)'; } catch { /* Ordinary folders remain valid workspaces. */ }
    const workspace: Workspace = { id: randomUUID(), path, name: basename(path) || path, target: 'local', branch };
    this.workspaces.push(workspace);
    try { await this.persist(); } catch (error) { this.workspaces = this.workspaces.filter(item => item.id !== workspace.id); throw error; }
    this.changed();
    return structuredClone(workspace);
  }

  getWorkspace(id: unknown): Workspace {
    const workspace = this.workspaces.find(item => item.id === text(id, '工作区 ID', 200));
    if (!workspace) throw new Error('工作区不存在，请重新打开目录');
    return structuredClone(workspace);
  }

  private environment(profile: LaunchProfile): NodeJS.ProcessEnv {
    return { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...(profile.agentDir ? { PI_CODING_AGENT_DIR: profile.agentDir } : {}) };
  }

  async createSession(workspaceId: unknown): Promise<SessionSnapshot> {
    if (this.disposed) throw new Error('工作台正在退出');
    const workspace = this.getWorkspace(workspaceId);
    if (!(await stat(workspace.path)).isDirectory()) throw new Error('工作区目录不可用');
    const profile = structuredClone(this.profile);
    const env = this.environment(profile);
    const version = (await execute(profile.executable, [...profile.args, '--version'], { cwd: workspace.path, env, timeout: 15_000, windowsHide: true, maxBuffer: 65_536 })).stdout.trim();
    if (version !== PI_VERSION) throw new Error(`Pi 版本不兼容：需要 ${PI_VERSION}，实际 ${version || '未知'}。请修改启动配置。`);
    if (this.disposed) throw new Error('工作台正在退出');
    const snapshot: SessionSnapshot = {
      id: randomUUID(), workspaceId: workspace.id, generation: randomUUID(), phase: 'starting', canSubmit: false, piVersion: version, messages: [], diagnostics: [],
    };
    const client = new PiRpcClient({ executable: profile.executable, args: [...profile.args, '--mode', 'rpc', '--session-id', randomUUID()], cwd: workspace.path, env });
    const runtime: SessionRuntime = { snapshot, client, projection: new MessageProjection(), closing: false, uncertain: false, runError: false, runStarted: false };
    this.sessions.set(snapshot.id, runtime);
    const current = () => !runtime.closing && this.sessions.get(snapshot.id) === runtime && !this.disposed;
    client.on('record', record => { if (current()) this.applyRecord(runtime, record); });
    client.on('diagnostic', diagnostic => {
      if (!current()) return;
      snapshot.diagnostics.push({ ...diagnostic, message: diagnosticText(diagnostic.message), time: new Date().toISOString() });
      snapshot.diagnostics = snapshot.diagnostics.slice(-200);
      if (diagnostic.kind === 'protocol') { snapshot.error = 'Pi 协议异常；检查诊断并新建会话，未自动重放任何请求。'; runtime.uncertain = true; }
      this.changed();
    });
    client.on('exit', exit => {
      if (!current()) return;
      snapshot.phase = 'exited';
      snapshot.error = `Pi 进程退出（code=${exit.code ?? '未知'}, signal=${exit.signal ?? '无'}）；请新建会话恢复。未自动重放输入。`;
      void this.releaseOwnership(runtime).catch(error => { snapshot.diagnostics.push({ kind: 'ownership', message: diagnosticText(errorMessage(error)), time: new Date().toISOString() }); });
      this.changed();
    });
    this.changed();
    try {
      await client.start();
      snapshot.pid = client.pid;
      const stateResponse = await client.request({ type: 'get_state' });
      if (!stateResponse.success) throw new Error(stateResponse.error || '无法读取 Pi 状态');
      const state = object(stateResponse.data);
      snapshot.nativeSessionId = text(state.sessionId, 'Pi sessionId');
      if (this.nativeOwners.has(snapshot.nativeSessionId)) throw new Error('此原生 Pi 会话已经由另一个活动进程拥有，请新建会话');
      this.nativeOwners.set(snapshot.nativeSessionId, snapshot.id);
      if (typeof state.sessionFile === 'string') {
        snapshot.sessionFile = state.sessionFile;
        runtime.releaseLease = await acquireSessionLease(state.sessionFile);
      }
      const model = object(state.model);
      if (typeof model.id === 'string') snapshot.model = `${String(model.provider ?? '')}/${model.id}`;
      const messagesResponse = await client.request({ type: 'get_messages' });
      if (!messagesResponse.success) throw new Error(messagesResponse.error || '无法读取 Pi 消息');
      const messages = object(messagesResponse.data).messages;
      if (!Array.isArray(messages)) throw new Error('Pi get_messages 未返回消息数组');
      snapshot.messages = messages.map(message => projectMessage(message));
      snapshot.phase = state.isCompacting ? 'compacting' : state.isStreaming ? 'running' : 'idle';
    } catch (error) {
      snapshot.phase = 'error'; snapshot.error = diagnosticText(errorMessage(error));
      runtime.closing = true;
      await client.dispose();
      await this.releaseOwnership(runtime);
    }
    this.changed();
    return structuredClone(this.sessionView(runtime));
  }

  private applyRecord(runtime: SessionRuntime, record: Record<string, unknown>): void {
    const snapshot = runtime.snapshot;
    runtime.projection.apply(snapshot, record);
    switch (record.type) {
      case 'agent_start': runtime.runStarted = true; snapshot.phase = 'running'; break;
      case 'auto_retry_start': snapshot.phase = 'retrying'; break;
      case 'auto_retry_end':
        snapshot.phase = 'running';
        if (record.success === false) { runtime.runError = true; snapshot.error = diagnosticText(String(record.finalError ?? 'Pi 重试失败')); }
        else if (record.success === true) { runtime.runError = false; snapshot.error = undefined; }
        break;
      case 'compaction_start': snapshot.phase = 'compacting'; break;
      case 'compaction_end':
        snapshot.phase = 'running';
        if (record.errorMessage || record.aborted) {
          runtime.runError = true;
          snapshot.error = diagnosticText(String(record.errorMessage ?? 'Pi 压缩已取消'));
        } else if (record.reason === 'overflow' && record.willRetry === true && record.result) {
          runtime.runError = false;
          snapshot.error = undefined;
        }
        break;
      case 'extension_error':
        runtime.runError = true; snapshot.error = diagnosticText(String(record.error ?? 'Pi 扩展失败')); break;
      case 'extension_ui_request': {
        if (['select', 'confirm', 'input', 'editor'].includes(String(record.method))) snapshot.phase = 'waiting';
        snapshot.diagnostics.push({ kind: 'extension', message: diagnosticText(JSON.stringify(diagnosticRecord(record))), time: new Date().toISOString() });
        break;
      }
      case 'message_end': {
        const message = object(record.message);
        if (message.stopReason === 'error' || message.errorMessage) {
          runtime.runError = true; snapshot.error = diagnosticText(String(message.errorMessage ?? 'Pi 模型运行失败'));
        }
        break;
      }
      case 'agent_settled': snapshot.phase = runtime.runError ? 'error' : 'settled'; break;
      // agent_end only ends one low-level Agent cycle, never the overall Run.
    }
    snapshot.diagnostics = snapshot.diagnostics.slice(-200);
    this.changed();
  }

  async sendPrompt(id: unknown, value: unknown): Promise<void> {
    const runtime = this.sessions.get(text(id, '会话 ID', 200));
    if (!runtime) throw new Error('会话进程不可用，请新建会话');
    const blocked = this.submissionBlock(runtime);
    if (blocked) throw new Error(blocked);
    const message = text(value, '消息', 1_000_000);
    runtime.snapshot.phase = 'submitting';
    runtime.snapshot.error = undefined;
    runtime.runError = false;
    runtime.runStarted = false;
    this.changed();
    try {
      const response = await runtime.client.request({ type: 'prompt', message });
      if (!response.success) throw new Error(response.error || 'Pi 拒绝了输入');
      if (runtime.snapshot.phase === 'submitting') runtime.snapshot.phase = 'accepted';
      // In pinned Pi, normal preflight calls _runAgentPrompt synchronously and
      // sets isStreaming before the next stdin command. Handled extension/input
      // requests return success without creating a Run or emitting agent_settled.
      const stateResponse = await runtime.client.request({ type: 'get_state' });
      if (!stateResponse.success) throw new Error(stateResponse.error || '已接收输入，但无法核实 Pi 状态');
      const state = object(stateResponse.data);
      if (state.sessionId !== runtime.snapshot.nativeSessionId) {
        runtime.uncertain = true;
        throw new Error('扩展替换了原生会话；此运行时身份需要重新绑定，请新建会话。未向新身份重放输入。');
      }
      if (!runtime.runStarted && state.isStreaming === false && state.isCompacting === false && state.pendingMessageCount === 0) {
        runtime.snapshot.phase = runtime.runError ? 'error' : 'idle';
      }
      this.changed();
    } catch (error) {
      if (runtime.closing) throw new Error(diagnosticText(errorMessage(error)));
      if ((runtime.snapshot as SessionSnapshot).phase !== 'exited') runtime.snapshot.phase = 'error';
      runtime.snapshot.error = diagnosticText(errorMessage(error));
      runtime.runError = true;
      if (error instanceof PiRpcError && error.delivery === 'unknown') runtime.uncertain = true;
      this.changed();
      throw new Error(runtime.snapshot.error);
    }
  }

  async closeSession(id: unknown): Promise<void> {
    const runtime = this.sessions.get(text(id, '会话 ID', 200));
    if (!runtime) return;
    runtime.closing = true;
    await runtime.client.dispose();
    await this.releaseOwnership(runtime);
    runtime.snapshot.phase = 'exited';
    this.changed();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.changeTimer) clearTimeout(this.changeTimer);
    await Promise.all([...this.sessions.values()].map(async runtime => { runtime.closing = true; await runtime.client.dispose(); await this.releaseOwnership(runtime); }));
    await this.writes;
  }
}
