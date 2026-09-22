// Locally authored external-process fixture, NOT a real model or product path.
// Protocol: @earendil-works/pi-coding-agent 0.87.0 (MIT), release
// 16787ad5b2dc748047f314ca1bfe7708f30f54f3; see docs/references/upstream-and-ui.md.
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as delay } from 'node:timers/promises';

function option(name) {
  return process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

if (process.argv.includes('--version')) {
  console.log(option('--fixture-version') ?? '0.87.0');
  process.exit(0);
}

const controlDir = option('--fixture-control-dir');
const model = {
  id: 'offline-fixture', name: 'Offline fixture', provider: 'fixture',
  api: 'openai-completions', baseUrl: 'http://127.0.0.1:1', reasoning: false,
  input: ['text'], contextWindow: 8192, maxTokens: 1024,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const usage = {
  input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const messages = [];
let runNumber = 0;
let activeRun;
let streaming = false;

function audit(direction, record) {
  if (controlDir) appendFileSync(join(controlDir, `${process.pid}.jsonl`), `${JSON.stringify({ direction, record })}\n`);
}

function emit(record) {
  audit('out', record);
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function respond(command, data, error) {
  emit({ type: 'response', id: command.id, command: command.type, success: !error,
    ...(data === undefined ? {} : { data }), ...(error ? { error } : {}) });
}

async function gate(run, stage, milliseconds, signal) {
  if (!controlDir) return delay(milliseconds, undefined, { signal });
  // The test controls timing only here, outside the application. No test RPCs.
  while (!existsSync(join(controlDir, `${process.pid}-${run}-${stage}`))) {
    await delay(20, undefined, { signal });
  }
  signal.throwIfAborted();
}

function assistant(text, timestamp, extra = {}) {
  return { role: 'assistant', content: [{ type: 'text', text }],
    provider: model.provider, model: model.id, api: model.api,
    usage, stopReason: 'stop', timestamp, ...extra };
}

function endMessage(message) {
  messages.push(message);
  emit({ type: 'message_end', message });
}

async function runPrompt(text, run, signal) {
  await gate(run, 'start', 600, signal);
  streaming = true;
  emit({ type: 'agent_start' });
  emit({ type: 'turn_start' });
  const user = { role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() };
  emit({ type: 'message_start', message: user });
  endMessage(user);

  if (text === 'retry') {
    const failed = assistant('', Date.now(), { stopReason: 'error', errorMessage: 'Fixture transient provider error' });
    emit({ type: 'message_start', message: { ...failed, content: [] } });
    endMessage(failed);
    emit({ type: 'turn_end', message: failed, toolResults: [] });
    emit({ type: 'agent_end', messages: [user, failed], willRetry: true });
    emit({ type: 'auto_retry_start', attempt: 1, maxAttempts: 2, delayMs: 600, errorMessage: failed.errorMessage });
    await gate(run, 'retry', 600, signal);
    streaming = true;
    emit({ type: 'agent_start' });
    emit({ type: 'turn_start' });
  }

  const timestamp = Date.now();
  const partial = `流式片段：${text} · 中文🙂\u2028行\u2029段`;
  // The final message deliberately corrects the deltas instead of repeating them.
  const final = assistant(`权威回复：${text} · 中文🙂\u2028行\u2029段 · 已校正 ✓`, timestamp);
  emit({ type: 'message_start', message: { ...final, content: [] } });
  emit({ type: 'message_update', usage, assistantMessageEvent: { type: 'text_start', contentIndex: 0 } });
  for (const delta of ['流式片段：', partial.slice('流式片段：'.length)]) {
    emit({ type: 'message_update', usage, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta } });
  }
  await gate(run, 'finish', 500, signal);
  emit({ type: 'message_update', usage, assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: partial } });
  endMessage(final);
  if (text === 'retry') emit({ type: 'auto_retry_end', success: true, attempt: 1 });
  emit({ type: 'turn_end', message: final, toolResults: [] });
  emit({ type: 'agent_end', messages: [final], willRetry: false });
  await gate(run, 'settle', 1_000, signal);
  streaming = false;
  emit({ type: 'agent_settled' });
}

function handle(command) {
  audit('in', command);
  switch (command.type) {
    case 'get_state':
      respond(command, { sessionId: option('--fixture-session-id') ?? `workspace-fixture-${process.pid}`, ...(option('--fixture-session-file') ? { sessionFile: option('--fixture-session-file') } : {}), sessionName: 'Offline fixture', model,
        thinkingLevel: 'off', isStreaming: streaming, isCompacting: false,
        steeringMode: 'one-at-a-time', followUpMode: 'one-at-a-time',
        autoCompactionEnabled: true, messageCount: messages.length, pendingMessageCount: 0 });
      break;
    case 'get_messages': respond(command, { messages }); break;
    case 'get_commands': respond(command, { commands: [] }); break;
    case 'get_available_models': respond(command, { models: [model] }); break;
    case 'prompt': {
      if (command.message === 'fail') {
        respond(command, undefined, 'No API key for fixture provider; configure authentication and retry.');
        break;
      }
      if (command.message === 'secret-error') {
        respond(command, undefined, 'api_key=SYNTHETIC_SECRET {"access_token":"SYNTHETIC_TOKEN"}');
        break;
      }
      if (command.message === '/handled') {
        emit({ type: 'extension_ui_request', id: 'notice', method: 'notify', message: 'handled without a run' });
        respond(command);
        break;
      }
      if (command.message === 'compact-fail' || command.message === 'compact-recover') {
        streaming = true;
        respond(command);
        emit({ type: 'agent_start' });
        if (command.message === 'compact-recover') {
          const failed = assistant('', Date.now(), { stopReason: 'error', errorMessage: 'context overflow' });
          emit({ type: 'message_start', message: failed }); endMessage(failed);
        }
        emit({ type: 'compaction_start', reason: command.message === 'compact-fail' ? 'threshold' : 'overflow' });
        setTimeout(() => {
          if (command.message === 'compact-fail') emit({ type: 'compaction_end', reason: 'threshold', aborted: false, willRetry: false, errorMessage: 'summary failed' });
          else {
            emit({ type: 'compaction_end', reason: 'overflow', aborted: false, willRetry: true, result: { summary: 'compacted' } });
            const recovered = assistant('recovered response', Date.now());
            emit({ type: 'message_start', message: recovered }); endMessage(recovered);
          }
          streaming = false;
          emit({ type: 'agent_settled' });
        }, 200);
        break;
      }
      if (command.message === 'crash') {
        process.stderr.write('Fixture RPC process crashed intentionally\n', () => process.exit(43));
        break;
      }
      // Intentionally leave a request in flight for process-exit/timeout checks.
      if (command.message === 'pending') break;
      if (activeRun) {
        respond(command, undefined, 'Fixture run is still active');
        break;
      }
      const controller = new AbortController();
      activeRun = controller;
      streaming = true;
      respond(command);
      void runPrompt(command.message, ++runNumber, controller.signal).catch((error) => {
        if (error.name !== 'AbortError') {
          console.error(error);
          process.exitCode = 1;
          input.close();
        }
      }).finally(() => { activeRun = undefined; });
      break;
    }
    case 'clear_queue': respond(command, { steering: [], followUp: [] }); break;
    case 'abort':
      activeRun?.abort();
      streaming = false;
      respond(command);
      emit({ type: 'agent_settled' });
      break;
    default: respond(command, undefined, `Unknown command: ${command.type}`);
  }
}

// Node 24 readline also splits on U+2028/U+2029, which are legal JSON string
// contents, not RPC delimiters. Escape them losslessly before readline sees
// them; incremental decoding also preserves UTF-8 split across stdin chunks.
const decoder = new StringDecoder('utf8');
const escapeSeparators = (text) => text.replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
const jsonlInput = new Transform({
  transform(chunk, _encoding, callback) { callback(null, escapeSeparators(decoder.write(chunk))); },
  flush(callback) { callback(null, escapeSeparators(decoder.end())); },
});
const input = createInterface({ input: process.stdin.pipe(jsonlInput), crlfDelay: Infinity, terminal: false });
input.on('line', (line) => {
  if (!line.trim()) return;
  try { handle(JSON.parse(line)); }
  catch (error) { console.error(error); process.exit(1); }
});
input.on('close', () => { activeRun?.abort(); process.exit(process.exitCode ?? 0); });
