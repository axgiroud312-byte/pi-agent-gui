import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

// External OpenAI Chat Completions boundary; Pi (not this server) executes tools.
export async function startPiModel({ holdAfterRequests = Infinity, failFirstRequests = 0,
  overflowAtRequest = Infinity } = {}) {
  const requests = [];
  const sockets = new Set();
  const held = new Set();
  let releaseText;
  const textObserved = new Promise(resolve => { releaseText = resolve; });
  let releaseLongTool;
  const longToolObserved = new Promise(resolve => { releaseLongTool = resolve; });
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
    const scenario = /PI_(?:LONG_TOOL|TEXT|IMAGE|READ|HELLO|STOP|SCROLL)/.exec(prompt)?.[0] ?? 'other';
    const toolResults = body.messages?.filter(message => message.role === 'tool') ?? [];
    const ownLongToolResult = toolResults.some(message => message.tool_call_id === 'pi-native-long-bash');
    const imageUrls = body.messages?.filter(message => message.role === 'user')
      .flatMap(message => Array.isArray(message.content) ? message.content : [])
      .filter(part => part.type === 'image_url').map(part => part.image_url?.url) ?? [];
    const latestUser = body.messages?.filter(message => message.role === 'user').at(-1);
    const promptText = typeof latestUser?.content === 'string' ? latestUser.content
      : Array.isArray(latestUser?.content) ? latestUser.content.filter(part => part.type === 'text')
        .map(part => part.text).join('') : '';
    const contextText = body.messages?.filter(message => message.role === 'user')
      .map(message => text(message.content)).join('\n') ?? '';
    const request = { scenario, promptText, tools: body.tools?.map(tool => tool.function?.name),
      contextMarkers: { included: contextText.includes('PI_CONTEXT_INCLUDED'),
        excluded: contextText.includes('PI_CONTEXT_EXCLUDED') },
      imageMimeTypes: imageUrls.map(url => /^data:([^;]+);base64,/u.exec(url)?.[1] ?? 'unknown'),
      imageDigests: imageUrls.map(url => {
        const encoded = /^data:[^;]+;base64,(.*)$/u.exec(url)?.[1];
        return encoded ? createHash('sha256').update(Buffer.from(encoded, 'base64')).digest('hex') : null;
      }),
      toolResults: toolResults.map(message => text(message.content)), stream: body.stream, closed: false };
    requests.push(request);
    res.on('close', () => { request.closed = true; });
    if (requests.length === overflowAtRequest) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Your input exceeds the context window of this model',
        type: 'invalid_request_error' } }));
      return;
    }
    if (requests.length <= failFirstRequests) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'PI_RETRY_CONTROLLED_FAILURE', type: 'server_error' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({
      id: 'pi-native-test', object: 'chat.completion.chunk', created: 1, model: body.model,
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    send({ role: 'assistant', content: '' });
    if (requests.length > holdAfterRequests) {
      await new Promise(resolve => {
        held.add(resolve);
        res.on('close', () => { held.delete(resolve); resolve(); });
      });
      return;
    }
    const ownReadResult = toolResults.some(result => text(result.content).includes(
      scenario === 'PI_HELLO' ? 'Native parity file content' : 'NATIVE_PARITY_PREVIEW'));
    if ((scenario === 'PI_READ' || scenario === 'PI_HELLO') && !ownReadResult) {
      send({ tool_calls: [{ index: 0, id: 'pi-native-tool', type: 'function', function: {
        name: 'read', arguments: JSON.stringify({ path: scenario === 'PI_HELLO' ? 'hello.txt' : 'README.md' }),
      } }] });
      send({}, 'tool_calls'); res.end('data: [DONE]\n\n'); return;
    }
    if (scenario === 'PI_LONG_TOOL' && !ownLongToolResult) {
      const command = "for i in $(seq 1 120); do printf 'PI_LONG_TOOL_LINE_%s\\n' \"$i\"; done";
      send({ tool_calls: [{ index: 0, id: 'pi-native-long-bash', type: 'function', function: {
        name: 'bash', arguments: JSON.stringify({ command }),
      } }] });
      send({}, 'tool_calls'); res.end('data: [DONE]\n\n'); return;
    }
    const response = scenario === 'PI_LONG_TOOL' ? 'PI_LONG_TOOL_COMPLETE' : scenario === 'PI_IMAGE' ? 'PI_IMAGE_COMPLETE' : scenario === 'PI_READ' ? 'PI_READ_COMPLETE' : scenario === 'PI_HELLO'
      ? 'PI_HELLO_COMPLETE' : scenario === 'PI_STOP'
      ? 'PI_STOP_PARTIAL' : 'PI_TEXT_COMPLETE';
    if (scenario === 'PI_TEXT') {
      send({ content: 'PI_TEXT_' });
      // Hold the partial frame until the GUI has observed it. A fixed delay can
      // expire before a busy Windows CI renderer paints the streaming state.
      await textObserved;
      const historyItem = /history item (\d+)/u.exec(promptText)?.[1];
      send({ content: `COMPLETE${historyItem === undefined ? '' : `_${historyItem}`}` });
    } else if (scenario === 'PI_LONG_TOOL') {
      send({ content: 'PI_LONG_TOOL_START\n' });
      await longToolObserved;
      for (let i = 1; i <= 24 && !res.destroyed; i++) {
        await new Promise(resolve => setTimeout(resolve, 220));
        send({ content: `\nPI_LONG_TOOL_FRAME_${i}: continuing after nested scroll` });
        scrollFrames += 1;
      }
      send({ content: '\nPI_LONG_TOOL_COMPLETE' });
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
    releaseText: () => releaseText(),
    releaseLongTool: () => releaseLongTool(),
    close: async () => { releaseText(); releaseLongTool(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); },
  };
}
