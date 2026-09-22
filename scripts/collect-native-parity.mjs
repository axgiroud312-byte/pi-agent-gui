import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = {
  original: resolve(root, 'test-results/native-parity/original/baseline-verified'),
  product: resolve(root, 'test-results/native-parity/product'),
};
const output = resolve(root, 'docs/delivery/issue-32-parity');
const reports = {};
for (const [kind, directory] of Object.entries(source)) {
  const report = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'));
  assert.equal(report.nativeSmokePassed, true, `${kind} smoke must pass`);
  assert.equal(report.buildUnchanged, true, `${kind} source/build must remain unchanged during capture`);
  reports[kind] = report;
}
assert.equal(reports.original.provenance.pinnedSourceVerified, true);
assert.deepEqual(reports.original.provenance.sourceMismatches, []);
await mkdir(output, { recursive: true });
const pairs = [];
const key = shot => `${shot.viewport.width}x${shot.viewport.height}-${shot.theme}-${shot.state}`;
const states = new Set(['empty', 'running', 'waiting', 'error', 'file-preview', 'model-settings', 'read-tool-expanded', 'terminal', 'appearance']);
for (const shot of reports.original.screenshots.filter(shot => states.has(shot.state))) {
  const other = reports.product.screenshots.find(candidate => key(candidate) === key(shot));
  if (!other) continue;
  const item = { state: shot.state, theme: shot.theme, viewport: shot.viewport };
  for (const [kind, capture] of [['original', shot], ['product', other]]) {
    const filename = `${kind}-${key(shot)}.png`;
    await copyFile(join(source[kind], capture.file), join(output, filename));
    item[kind] = filename;
  }
  pairs.push(item);
}
for (const state of ['empty', 'running', 'waiting', 'error', 'file-preview']) {
  assert.equal(pairs.filter(pair => pair.state === state).length, 4, `Missing paired ${state} matrix`);
}
const summary = Object.fromEntries(Object.entries(reports).map(([kind, report]) => [kind, {
  head: report.provenance.head, sourceDigest: report.provenance.sourceDigest,
  artifactDigest: report.provenance.artifactDigest, started: report.started, finished: report.finished,
  nativeSmokePassed: report.nativeSmokePassed, summary: report.summary,
  actions: report.actions.map(({ name, status }) => ({ name, status })),
  unavailable: report.unavailable, pageErrors: report.pageErrors,
  boundaryCounts: report.isolation.boundaryCounts,
  cleanup: { survivors: report.cleanup.survivors },
}]));
await writeFile(join(output, 'evidence.json'), JSON.stringify({
  upstream: '872ad960de7ec172591f7e1952f7849229f94521',
  note: 'Real native Electron UI and original Agent; controlled loopback model. Not Pi execution. Human gate #33 is separate.',
  reports: summary, pairs,
}, null, 2) + '\n');
const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
await writeFile(join(output, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>#33 原生工作台对照</title>
<style>body{font:15px/1.65 system-ui;background:#171717;color:#eee;margin:24px}a{color:#9bd2ff}h1{font-size:24px}section{margin:32px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}img{width:100%;border:1px solid #555}figure{margin:0}figcaption{font-weight:600;margin-bottom:8px}button{padding:6px 12px}aside{padding:16px;background:#272727;border-radius:8px}@media(max-width:900px){.pair{grid-template-columns:1fr}}</style>
<h1>#33 原生 ZCode / Pi Agent IDE 界面对照</h1>
<aside>左侧为固定原版，右侧为品牌/厂商入口处理后的产品。两侧均实际运行原生 Electron、输入框、宿主和 Agent；模型是可控本地 SSE 测试端点，<b>尚未接入 Pi</b>。Pi 适配在您确认 #33 后由 #34 实施。<br>允许差异：π 品牌、移除厂商产品账户/充值/配额/云服务入口；通用 API key 供应商保留。动态时间、测试目录与任务标题可能不同。</aside>
<p><a href="evidence.json">操作、源码和构建证据</a> · <a href="https://github.com/axgiroud312-byte/pi-agent-gui/issues/33">#33 确认关卡</a></p>
<p>已知原版状态：会话拆分入口在此固定版本中未启用，保持原状，完整能力由 #5 后续补齐。物理中文输入法候选窗口仍需人工操作；自动验证覆盖 Chromium 合成输入不误发送。</p>
${pairs.map(pair => `<section><h2>${escape(pair.state)} · ${pair.viewport.width}×${pair.viewport.height} · ${escape(pair.theme)}</h2><div class="pair">${['original', 'product'].map(kind => `<figure><figcaption>${kind === 'original' ? '原版 ZCode' : 'Pi Agent IDE 原生底座'}</figcaption><a href="${escape(pair[kind])}"><img loading="lazy" src="${escape(pair[kind])}" alt="${kind} ${escape(pair.state)}"></a></figure>`).join('')}</div></section>`).join('')}
</html>`);
console.log(`Collected ${pairs.length} actual screenshot pairs: ${output}`);
