import { createServer } from 'node:http';

// External OpenAI Chat Completions boundary; Pi (not this server) executes tools.
export async function startPiModel() {
  const requests = [];
  const sockets = new Set();
  const held = new Set();
  let scrollFrames = 0;
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url.split('?')[0] === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'pi-native-test', object: 'model' }] })); return;
    }
    if (req.method !== 'POST' || req.url.split('?')[0] !== '/v1/chat/completions') {
      res.writeHead(404); res.end(); return;
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const text = value => typeof value === 'string' ? value : JSON.stringify(value);
    const prompt = body.messages?.filter(message => message.role === 'user').map(message => text(message.content)).at(-1) ?? '';
    const scenario = /PI_(?:TEXT|READ|HELLO|STOP|SCROLL)/.exec(prompt)?.[0] ?? 'other';
    const toolResults = body.messages?.filter(message => message.role === 'tool') ?? [];
    const request = { scenario, tools: body.tools?.map(tool => tool.function?.name),
      toolResults: toolResults.map(message => text(message.content)), stream: body.stream, closed: false };
    requests.push(request);
    res.on('close', () => { request.closed = true; });
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({
      id: 'pi-native-test', object: 'chat.completion.chunk', created: 1, model: body.model,
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    send({ role: 'assistant', content: '' });
    const ownReadResult = toolResults.some(result => text(result.content).includes(
      scenario === 'PI_HELLO' ? 'Native parity file content' : 'NATIVE_PARITY_PREVIEW'));
    if ((scenario === 'PI_READ' || scenario === 'PI_HELLO') && !ownReadResult) {
      send({ tool_calls: [{ index: 0, id: 'pi-native-tool', type: 'function', function: {
        name: 'read', arguments: JSON.stringify({ path: scenario === 'PI_HELLO' ? 'hello.txt' : 'README.md' }),
      } }] });
      send({}, 'tool_calls'); res.end('data: [DONE]\n\n'); return;
    }
    const response = scenario === 'PI_READ' ? 'PI_READ_COMPLETE' : scenario === 'PI_HELLO'
      ? 'PI_HELLO_COMPLETE' : scenario === 'PI_STOP'
      ? 'PI_STOP_PARTIAL' : 'PI_TEXT_COMPLETE';
    if (scenario === 'PI_TEXT') {
      send({ content: 'PI_TEXT_' });
      await new Promise(resolve => setTimeout(resolve, 900));
      send({ content: 'COMPLETE' });
    } else if (scenario === 'PI_SCROLL') {
      // Long-enough real Pi text stream to overflow the native virtual timeline.
      send({ content: 'PI_SCROLL_START\n' + Array.from({ length: 100 }, (_, i) => `Line ${i}: native scrolling parity`).join('\n') + '\n' });
      scrollFrames += 1;
      for (let i = 1; i <= 18 && !res.destroyed; i++) {
        await new Promise(resolve => setTimeout(resolve, 220));
        send({ content: `\nPI_SCROLL_FRAME_${i}: more native content` });
        scrollFrames += 1;
      }
    } else send({ content: response });
    if (scenario === 'PI_STOP') {
      await new Promise(resolve => {
        held.add(resolve);
        res.on('close', () => { held.delete(resolve); resolve(); });
      });
    }
    if (!res.destroyed) { send({}, 'stop'); res.end('data: [DONE]\n\n'); }
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/v1`, requests,
    get held() { return held.size; },
    get scrollFrames() { return scrollFrames; },
    close: async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); },
  };
}
