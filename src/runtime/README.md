# Pi RPC transport

`PiRpcClient` owns one local child process and its stdin/stdout JSONL transport.
The host owns session generations, state/history queries, run projection and
recovery decisions.

## Contract

```ts
import { PiRpcClient } from './pi-rpc-client.js';

const client = new PiRpcClient({
  executable: nodeExecutable,
  args: [piCliPath, '--mode', 'rpc'],
  cwd: workspacePath,
  requestTimeoutMs: 30_000,
});

client.on('record', (record) => { /* Agent / extension / future event */ });
client.on('diagnostic', ({ kind, message }) => { /* stderr | protocol | process */ });
client.on('exit', ({ code, signal }) => { /* Invalidate the host generation */ });
await client.start();
const response = await client.request({ type: 'get_state' });
// Check response.success before interpreting response.data.
await client.dispose();
```

- `start()` resolves on the OS `spawn` event. It sends no initialization command
  and does not claim Pi is ready to answer. Concurrent/repeated starts share the
  same live child. A closed/disposed client cannot be restarted.
- `executable`, `args` and `cwd` are passed directly to `spawn` with `shell: false`
  and `windowsHide: true`. Supply all CLI arguments, including `--mode rpc`.
  On Windows use Node plus Pi's CLI entrypoint rather than an npm `.cmd` shim.
  `env` overrides inherited environment variables. `pid` is present while the
  child is owned, and cleared after cleanup.
- `request(command, timeoutMs?)` assigns a fresh UUID, replacing any caller ID.
  It correlates responses by **both ID and command**, including concurrent
  requests for the same command. All structurally valid Pi responses resolve,
  including `success: false` and `data: { cancelled: true }`.
- A prompt response represents acceptance. `agent_end`, `agent_settled`, queue
  changes, retries, and compaction are passed through verbatim as records.
  Events carrying a request ID (such as bash updates) are still events.
- `notify(record)` preserves the entire JSON record, including extension IDs.
  It resolves when the write callback succeeds; it does not wait for a response
  or claim the peer handled the record. It uses the default request timeout.
- Deadlines include waiting in the transport's write queue. Unsent expired
  records are removed. A record already submitted to the OS cannot be withdrawn:
  its write can finish after the caller times out. The transport never retries,
  resends, automatically aborts a Pi run, or restarts the process.
- Rejections are `PiRpcError` with `code` and `delivery: 'not-sent' | 'unknown'`.
  `unknown` explicitly means the command may already have executed. A timeout,
  process failure, or disposal is not proof that remote work was cancelled.
  Host recovery must query actual state using a new client/generation as needed.
- `dispose()` is idempotent, immediately rejects pending requests/writes,
  discards unsent records, suppresses further record events, closes stdin and
  terminates the owned RPC child. SIGTERM escalates to SIGKILL after 500 ms.
  It resolves after the child has exited and its transport has been cleaned up.
  It does not manage arbitrary descendant tools or detached processes; that
  execution-target policy belongs to the host supervisor.

## Framing, limits and diagnostics

The incremental decoder accepts valid UTF-8 split at any byte, frames only on
LF, removes an optional trailing CR, and flushes a final record at EOF. Unicode
U+2028/U+2029 stay inside JSON strings. Invalid/incomplete UTF-8, malformed JSON,
and non-object JSON produce protocol diagnostics. Unknown object events and
optional fields are preserved. Blank lines are ignored.

`RPC_LIMITS` documents the fixed transport bounds:

| Resource | Bound |
| --- | --- |
| Incoming record before LF | 16 MiB (including optional CR) |
| Serialized outgoing record | 16 MiB (including LF) |
| Queued plus actively-writing data | 32 MiB |
| Pending command responses | 1,024 |
| Queued plus actively-writing records | 1,024 |
| Malformed record preview | 512 characters |

Oversized stdout records are diagnosed once and discarded through the next LF,
then parsing resumes. Outbound overload rejects before sending the new record.
These limits apply to each individual JSONL record, so a single exceptionally
large history/image response may exceed them and leave its request to time out.
There is at most one native stdin write in flight. Both its callback and, when
`write()` returns false, `drain` gate further writes.

stderr uses a separate incremental UTF-8 decoder and emits raw text chunks as
`diagnostic` events; it is never parsed as a command or retained in an unbounded
log. Consumers decide diagnostic retention. Invalid, uncorrelated and late
responses produce bounded protocol diagnostics and never appear as records.
A matching malformed envelope or command mismatch rejects only that request.

On natural process exit, new operations fail immediately. stdout is drained
before rejecting remaining requests and emitting the single public `exit`
event, so final unterminated responses/events are not lost. Drain is bounded to
one second if a descendant retains a stdio handle. Exit diagnostics retain the
actual exit code/signal; stderr is separate. Transport errors also settle all
callers and terminate the owned child.

## Verification and protocol provenance

`tests/runtime/pi-rpc-client.test.ts` uses built-in `node:test`/`assert` and real
Node child processes. `tests/fixtures/rpc-child.mjs` supplies deterministic
framing, response/event, failure, queue and backpressure scenarios. Its default
mode also supports `get_state`, `get_messages`, `get_commands`, text `prompt`,
and `--version` for host integration. It identifies itself as an offline fixture;
it is not evidence of a real model invocation.

From the repository root, with the scaffold dependencies installed:

```text
node --import tsx --test tests/runtime/pi-rpc-client.test.ts
```

When dependencies have not been installed in this worktree:

```text
npm exec --yes --package=tsx -- tsx --test tests/runtime/pi-rpc-client.test.ts
```

Implementation and fixture are locally authored against
`@earendil-works/pi-coding-agent@0.87.0`, release commit
`16787ad5b2dc748047f314ca1bfe7708f30f54f3` (upstream MIT). Protocol/reference sources:

- [RPC documentation](https://github.com/earendil-works/pi/blob/16787ad5b2dc748047f314ca1bfe7708f30f54f3/packages/coding-agent/docs/rpc.md)
- [RPC types](https://github.com/earendil-works/pi/blob/16787ad5b2dc748047f314ca1bfe7708f30f54f3/packages/coding-agent/src/modes/rpc/rpc-types.ts)
- [Upstream JSONL reader](https://github.com/earendil-works/pi/blob/16787ad5b2dc748047f314ca1bfe7708f30f54f3/packages/coding-agent/src/modes/rpc/jsonl.ts)
- [Upstream RPC client](https://github.com/earendil-works/pi/blob/16787ad5b2dc748047f314ca1bfe7708f30f54f3/packages/coding-agent/src/modes/rpc/rpc-client.ts)

No upstream source code was copied.
