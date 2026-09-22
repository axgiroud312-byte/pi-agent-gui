import { createServer } from 'node:http';
import { join } from 'node:path';

// An explicitly controlled OpenAI-compatible wire endpoint, never a live model or Pi.
export async function startModel(f) {
  const requests = [];
  const sockets = new Set();
  const holds = new Set();
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body;
    try { body = raw ? JSON.parse(raw) : {}; }
    catch { res.writeHead(400); return res.end('Invalid fixture JSON'); }
    res.setHeader('content-type', 'application/json');
    const text = message => typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content);
    const promptIndex = (body.messages ?? []).findLastIndex(m => m.role === 'user' && /PARITY_[A-Z]+/.test(text(m) ?? ''));
    const prompt = text(body.messages?.[promptIndex]);
    const after = body.messages?.slice(promptIndex + 1) ?? [];
    const toolResults = after.filter(m => m.role === 'tool');
    const request = { at: new Date().toISOString(), method: req.method, path: req.url.split('?')[0], model: body.model,
      stream: body.stream, roles: body.messages?.map(m => m.role),
      tools: body.tools?.map(t => t.function?.name),
      toolResults: toolResults.map(m => ({ id: m.tool_call_id, content: text(m) })),
      scenario: /PARITY_[A-Z]+/.exec(prompt ?? '')?.[0] ?? 'auxiliary' };
    requests.push(request);
    res.on('finish', () => { request.status = res.statusCode; request.finished = true; });
    res.on('close', () => { request.status = res.statusCode; request.aborted = !res.writableEnded; });
    if (req.method === 'GET') return res.end(JSON.stringify({ data: [{ id: 'parity-controlled', object: 'model' }] }));
    if (prompt?.includes('PARITY_ERROR')) {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'PARITY_CONTROLLED_ERROR: intentional fixture failure', type: 'invalid_request_error', code: 'parity_fixture' } }));
    }
    const content = prompt?.includes('PARITY_READ') ? 'PARITY_READ_COMPLETE'
      : prompt?.includes('PARITY_WAIT') ? 'PARITY_WAIT_COMPLETE'
        : prompt?.includes('PARITY_RECOVER') ? 'PARITY_RECOVER_COMPLETE'
        : 'CONTROLLED_NATIVE_REPLY: **native timeline**\n\n```text\nNATIVE_PARITY_CODE\n```';
    if (!body.stream) return res.end(JSON.stringify({ id: 'parity', object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 } }));
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({
      id: 'parity', object: 'chat.completion.chunk', created: 1, model: body.model,
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    send({ role: 'assistant', content: '' });
    const tool = prompt?.includes('PARITY_READ') ? { name: 'Read', args: { file_path: join(f.workspace, 'README.md') } }
      : prompt?.includes('PARITY_WAIT') ? { name: 'AskUserQuestion', args: { questions: [{
        header: 'Parity', question: 'PARITY_QUESTION: choose a fixture option?', multiSelect: false,
        options: [{ label: 'Fixture A', description: 'Continue controlled native test' }, { label: 'Fixture B', description: 'Alternative fixture choice' }],
      }] } } : null;
    if (tool && toolResults.length === 0) {
      send({ tool_calls: [{ index: 0, id: `parity-${requests.length}`, type: 'function',
        function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] });
      send({}, 'tool_calls'); return res.end('data: [DONE]\n\n');
    }
    send({ content });
    if (prompt?.includes('PARITY_RUNNING')) await new Promise(resolve => {
      holds.add(resolve); res.on('close', () => { holds.delete(resolve); resolve(); });
    });
    if (!res.destroyed) { send({}, 'stop'); res.end('data: [DONE]\n\n'); }
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/v1`, requests,
    get held() { return holds.size; },
    release: () => { for (const release of holds) release(); holds.clear(); },
    close: async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); },
  };
}
