import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { startModel } from '../native-smoke/model.mjs';

// Validate the external model fixture's protocol split, not Agent execution.
// Actual Pi tool execution and the native UI remain separate integration gates.
async function withModel(baseline, fn) {
  const fixture = { baseline, workspace: join(process.cwd(), 'fixture workspace') };
  const model = await startModel(fixture);
  try {
    const request = async content => fetch(`${model.url}/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'parity-controlled', stream: true,
        messages: [{ role: 'user', content }] }),
    });
    await fn(request, fixture);
  } finally { await model.close(); }
}

for (const baseline of ['original', 'product']) {
  test(`${baseline} fixture emits its actual Agent read contract`, async () => {
    await withModel(baseline, async (request, f) => {
      const response = await request('PARITY_READ');
      assert.equal(response.status, 200);
      const records = (await response.text()).split('\n')
        .filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
      const tool = records.flatMap(record => record.choices[0].delta.tool_calls ?? [])[0];
      assert.equal(tool.function.name, baseline === 'original' ? 'Read' : 'read');
      assert.deepEqual(JSON.parse(tool.function.arguments), {
        [baseline === 'original' ? 'file_path' : 'path']: join(f.workspace, 'README.md'),
      });
    });
  });
}

test('original waiting fixture retains AskUserQuestion and both answer options', async () => {
  await withModel('original', async request => {
    const response = await request('PARITY_WAIT');
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /AskUserQuestion/);
    assert.match(text, /Fixture A/);
    assert.match(text, /Fixture B/);
  });
});

test('Pi fixture fails rather than impersonating original waiting capability', async () => {
  await withModel('product', async request => {
    const response = await request('PARITY_WAIT');
    assert.equal(response.status, 400);
    assert.match((await response.json()).error.message, /not a Pi capability/);
  });
});
