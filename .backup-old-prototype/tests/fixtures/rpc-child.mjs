// Offline process-boundary fixture for Pi 0.87.0, not a real model invocation.
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as delay } from 'node:timers/promises';

if (process.argv.includes('--version')) {
  console.log('0.87.0');
  process.exit(0);
}

const mode = process.argv.find((arg) => arg.startsWith('--fixture-mode='))?.split('=')[1];
const received = [];
const messages = [];
const reverseBatch = [];
let pausedTimer;
let streaming = false;
let input = '';
const decoder = new StringDecoder('utf8');

function emit(record) {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function response(command, data, extra = {}) {
  emit({ type: 'response', id: command.id, command: command.type, success: true, ...(data === undefined ? {} : { data }), ...extra });
}

async function writeBytes(bytes, stream = process.stdout) {
  await new Promise((resolve, reject) => stream.write(bytes, (error) => error ? reject(error) : resolve()));
}

async function bytewise(text, stream = process.stdout) {
  // Deliberately separate OS writes, including inside multibyte code points.
  for (const byte of Buffer.from(text)) {
    await writeBytes(Buffer.from([byte]), stream);
    await delay(1);
  }
}

function finish(tail, code = 0) {
  clearTimeout(pausedTimer);
  process.stdin.destroy();
  process.stdout.end(tail, () => process.exit(code));
}

function runEvents(command) {
  const text = `Fixture reply: ${command.message}`;
  const message = {
    role: 'assistant', content: [{ type: 'text', text }],
    provider: 'fixture', model: 'offline', api: 'openai-completions',
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop', timestamp: Date.now(),
  };
  emit({ type: 'agent_start' });
  emit({ type: 'message_start', message: { ...message, content: [] } });
  emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: text } });
  emit({ type: 'message_end', message });
  messages.push(message);
  emit({ type: 'agent_end', messages: [message], willRetry: false });
  if (command.fixtureAction !== 'manual-run') {
    streaming = false;
    emit({ type: 'agent_settled' });
  }
}

async function handle(command) {
  received.push({ id: command.id, type: command.type, index: command.index,
    length: typeof command.payload === 'string' ? command.payload.length : undefined,
    value: command.value, cancelled: command.cancelled, message: command.message });
  if (command.fixtureAction === 'reverse') {
    reverseBatch.push(command);
    emit({ type: 'queue_update', steering: reverseBatch.filter((item) => item.type === 'steer').map((item) => item.message),
      followUp: reverseBatch.filter((item) => item.type === 'follow_up').map((item) => item.message) });
    if (reverseBatch.length === 3) {
      for (const item of reverseBatch.reverse()) response(item, { index: item.index });
      reverseBatch.length = 0;
    }
    return;
  }
  switch (command.type) {
    case 'get_state':
      response(command, { sessionId: 'fixture-session', isStreaming: streaming, isCompacting: false,
        thinkingLevel: 'off', steeringMode: 'one-at-a-time', followUpMode: 'one-at-a-time',
        autoCompactionEnabled: true, messageCount: messages.length, pendingMessageCount: 0,
        model: { id: 'offline', name: 'Offline fixture', provider: 'fixture' } });
      break;
    case 'get_messages': response(command, { messages }); break;
    case 'get_commands': response(command, { commands: [] }); break;
    case 'prompt':
      messages.push({ role: 'user', content: command.message, timestamp: Date.now() });
      streaming = true;
      response(command);
      setTimeout(() => runEvents(command), 20);
      break;
    case 'test_settle':
      streaming = false;
      emit({ type: 'agent_settled' });
      response(command);
      break;
    case 'test_stats': response(command, received.slice(0, -1)); break;
    case 'test_environment': response(command, { cwd: process.cwd(), value: process.env.PI_RPC_TEST_VALUE, args: process.argv.slice(2) }); break;
    case 'test_echo':
      if (command.delay) await delay(command.delay);
      response(command, { id: command.id, index: command.index, value: command.value });
      break;
    case 'test_blob': response(command, { index: command.index, length: command.payload?.length }); break;
    case 'extension_ui_response': emit({ type: 'fixture_notification', record: command }); break;
    case 'test_extension':
      emit({ type: 'extension_ui_request', id: 'dialog-1', method: 'input', title: 'Fixture input' });
      response(command);
      break;
    case 'test_framing':
      await bytewise(`${JSON.stringify({ type: 'unicode', text: '中文😀\u2028line\u2029paragraph' })}\r\n`);
      await writeBytes('\n\r\n{"type":"first"}\n{"type":"second"}\r\n');
      response(command);
      break;
    case 'test_stderr':
      await bytewise('诊断😀\n{"type":"not_stdout"}\n', process.stderr);
      response(command);
      break;
    case 'test_malformed':
      await writeBytes('console pollution\n{bad json}\nnull\n[]\ntrue\n42\n"string"\n');
      emit({ type: 'future_event', payload: { unknown: true }, id: command.id });
      emit({ opaque: 'object without a type is preserved' });
      response(command);
      break;
    case 'test_invalid_utf8':
      await writeBytes(Buffer.concat([Buffer.from('{"type":"bad_utf8","text":"'), Buffer.from([0xff]), Buffer.from('"}\n')]));
      await writeBytes(Buffer.concat([Buffer.from('{"type":"truncated_utf8","text":"'), Buffer.from([0xe4]), Buffer.from('\n')]));
      emit({ type: 'recovered' });
      response(command);
      break;
    case 'test_oversized':
      await writeBytes('{"type":"oversized","text":"');
      for (let sent = 0; sent < command.bytes; sent += 65536) {
        await writeBytes(Buffer.alloc(Math.min(65536, command.bytes - sent), 120));
      }
      await writeBytes('"}\n');
      emit({ type: 'recovered' });
      response(command);
      break;
    case 'test_mismatch': response(command, undefined, { command: 'wrong_command' }); break;
    case 'test_bad_response': response(command, undefined, { success: 'yes' }); break;
    case 'test_bad_error': response(command, undefined, { success: false, error: 42 }); break;
    case 'test_rejected': response(command, undefined, { success: false, error: 'Fixture rejection' }); break;
    case 'switch_session': response(command, { cancelled: true }); break;
    case 'test_unsolicited':
      emit({ type: 'response', command: command.type, success: true });
      emit({ type: 'response', id: 'unknown', command: command.type, success: true });
      emit({ type: 'response', id: 42, command: command.type, success: true });
      response(command);
      response(command);
      break;
    case 'test_ignore': break;
    case 'test_tail':
      emit({ type: 'before_tail' });
      finish(JSON.stringify({ type: 'response', id: command.id, command: command.type, success: true, data: '尾😀' }) + '\r');
      break;
    case 'test_tail_event':
      response(command);
      finish(JSON.stringify({ type: 'tail_event', text: '最后😀\u2028\u2029' }));
      break;
    case 'test_bad_tail':
      response(command);
      finish(Buffer.concat([Buffer.from('{"type":"incomplete"'), Buffer.from([0xe4])]));
      break;
    case 'test_crash':
      await writeBytes('fixture crashed\n', process.stderr);
      process.exit(43);
      break;
    case 'test_pause':
      process.stdin.pause();
      response(command);
      emit({ type: 'fixture_paused' });
      if (command.delay !== null) pausedTimer = setTimeout(() => process.stdin.resume(), command.delay ?? 500);
      if (command.crashAfter) setTimeout(() => process.exit(44), command.crashAfter);
      break;
    case 'test_inherited_stdio': {
      const descendant = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], {
        stdio: ['ignore', process.stdout, process.stderr], windowsHide: true,
      });
      descendant.once('spawn', () => {
        process.stdout.write(`${JSON.stringify({ type: 'fixture_descendant', pid: descendant.pid })}\n`, () => process.exit(45));
      });
      break;
    }
    case 'test_bash_event':
      emit({ type: 'bash_execution_update', id: command.id, delta: 'first\n' });
      response(command, { output: 'first\n', exitCode: 0 });
      break;
    default: response(command); break;
  }
}

process.stdin.on('data', (chunk) => {
  input += decoder.write(chunk);
  let newline;
  while ((newline = input.indexOf('\n')) !== -1) {
    const line = input.slice(0, newline).replace(/\r$/, '');
    input = input.slice(newline + 1);
    if (line.length === 0) continue;
    try {
      void handle(JSON.parse(line)).catch((error) => { console.error(error); process.exit(90); });
    } catch (error) {
      console.error(error);
      process.exit(91);
    }
  }
});
process.stdin.on('end', () => {
  if (mode !== 'stubborn') process.exit(0);
});

if (mode === 'stubborn') {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
}
if (mode === 'startup-exit') {
  process.exit(17);
}
emit({ type: 'fixture_ready' });
