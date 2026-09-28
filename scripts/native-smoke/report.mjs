import { readFile, writeFile } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';

export function sanitize(text) {
  return String(text).replace(/(Bearer\s+)[^\s"\\]+/gi, '$1[redacted]')
    .replace(/([?&](?:token|key|secret|code)=)[^&\s"]+/gi, '$1[redacted]')
    .replace(/("(?:apiKey|accessToken|refreshToken|authorization|brokerToken)"\s*:\s*")[^"]*"/gi, '$1[redacted]"');
}
const html = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export async function finishReport(f, report, log) {
  const boundaries = (await readFile(f.env.NATIVE_SMOKE_BOUNDARY_LOG, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  report.isolation = { launchedEnvKeys: Object.keys(f.env).sort(), boundaryCounts: {},
    guardedProcesses: boundaries.filter(b => b.type === 'guard-active').map(b => ({ pid: b.pid, home: b.detail.home })) };
  for (const b of boundaries) report.isolation.boundaryCounts[b.type] = (report.isolation.boundaryCounts[b.type] ?? 0) + 1;
  for (const p of report.isolation.guardedProcesses) {
    const path = relative(f.sandbox, p.home);
    if (path.startsWith('..') || isAbsolute(path)) report.error ??= 'A guarded process home escaped the fixture';
  }
  if (!report.error && (report.isolation.guardedProcesses.length < 2
    || report.isolation.boundaryCounts['directory-chooser'] !== 1
    || report.isolation.boundaryCounts['filesystem-blocked'])) report.error = 'Isolation audit did not meet the smoke contract';
  report.nativeSmokePassed = !report.error && !report.cleanup?.survivors?.length;
  report.fullIssue32Passed = false;
  report.execution = f.baseline === 'original'
    ? 'Original native Agent reference; NOT Pi; controlled model, NOT online inference'
    : 'Real pinned Pi 0.87.0 RPC and tools; controlled model, NOT online inference';
  report.remaining = [
    'Independent visual comparison is separate from DOM/action assertions',
    'Physical Windows IME candidate-window interaction (CDP composition is covered)',
    'Conversation splits when unavailable upstream; full Git/editor/install/WSL/SSH acceptance',
    'Online-provider authentication/inference is not established by this controlled baseline',
    ...(f.baseline === 'product' ? ['Pi resource-command suggestions and GUI compaction (#10/#12) remain unsupported',
      'Pi extension waiting/answer UI (#13) remains unsupported, not a passing original AskUserQuestion equivalent']
      : ['Original Agent actions are reference evidence, not Pi product acceptance']),
  ];
  report.finished = new Date().toISOString();
  report.summary = { passedActions: report.actions?.filter(a => a.status === 'passed').length ?? 0,
    screenshots: report.screenshots?.length ?? 0, modelRequests: f.model.requests.length };
  await writeFile(join(f.output, 'application.log'), sanitize(log.join('\n')));
  await writeFile(join(f.output, 'model-requests.json'), sanitize(JSON.stringify(f.model.requests, null, 2)));
  await writeFile(join(f.output, 'report.json'), sanitize(JSON.stringify(report, null, 2)));
  const actions = (report.actions ?? []).map(a => `<li><b>${html(a.status)}</b> ${html(a.name)}${a.error ? `<pre>${html(a.error)}</pre>` : ''}</li>`).join('');
  const images = (report.screenshots ?? []).map(s => `<figure><a href="${html(s.file)}"><img loading="lazy" src="${html(s.file)}"></a><figcaption>${html(s.file)}</figcaption></figure>`).join('');
  await writeFile(join(f.output, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Native parity — ${html(f.baseline)}</title>
<style>body{font:16px system-ui;background:#171717;color:#eee;margin:32px}a{color:#91c9ff}img{max-width:100%;border:1px solid #777}figure{margin:24px 0}pre{white-space:pre-wrap}li{margin:8px 0}</style>
<h1>Native parity — ${html(f.baseline)}</h1><p>Native smoke: ${report.nativeSmokePassed ? 'passed' : 'failed'}. This does not close an Issue or its independent acceptance gates.</p>
<p>${html(report.execution)}. Actual Electron UI/host. OS registration/chooser/network boundaries are isolated.</p>
<p><a href="report.json">Actions and gaps</a> · <a href="provenance.json">Source/build hashes</a> · <a href="boundaries.jsonl">Boundary audit</a> · <a href="trace.zip">Playwright trace</a></p>
<ul>${actions}</ul><h2>Unavailable / remaining</h2><pre>${html(JSON.stringify({ unavailable: report.unavailable, remaining: report.remaining }, null, 2))}</pre><h2>Actual screenshots</h2>${images}`);
  console.log(`Native smoke ${report.nativeSmokePassed ? 'PASSED' : 'FAILED'}: ${f.output}`);
  console.log('Smoke result is not full Issue acceptance. See report.json and index.html for unsupported capabilities.');
}
