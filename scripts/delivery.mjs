import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const repo = 'axgiroud312-byte/pi-agent-gui';
const tickets = JSON.parse(await readFile(new URL('../docs/delivery/tickets.json', import.meta.url), 'utf8'));
const nativeContract = await readFile(new URL('../docs/delivery/native-issue-contract.md', import.meta.url), 'utf8');
const keys = new Set();
for (const ticket of tickets) {
  if (keys.has(ticket.key)) throw new Error(`Duplicate ticket ${ticket.key}`);
  for (const blocker of ticket.blockedBy) {
    if (!keys.has(blocker)) throw new Error(`${ticket.key}: blocker ${blocker} must appear first`);
  }
  keys.add(ticket.key);
}
for (const [field, required] of [
  ['capabilities', [...Array.from({ length: 34 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`), ...Array.from({ length: 18 }, (_, i) => `I${String(i + 1).padStart(2, '0')}`)]],
  ['scenarios', Array.from({ length: 20 }, (_, i) => `T${String(i + 1).padStart(2, '0')}`)],
  ['stories', Array.from({ length: 84 }, (_, i) => i + 1)],
]) {
  // Neither final acceptance nor the historical prototype may hide native implementation gaps.
  const covered = new Set(tickets.filter(t => !['release-acceptance', 'runtime'].includes(t.key)).flatMap(t => t[field]));
  const missing = required.filter(id => !covered.has(id));
  if (missing.length) throw new Error(`Uncovered ${field}: ${missing.join(', ')}`);
}
console.log(`Coverage valid: ${tickets.length} slices; 52 capabilities, 84 stories, 20 scenarios; acyclic ordered dependencies.`);
if (!process.argv.includes('--publish')) process.exit(0);

function gh(args, input) {
  return execFileSync('gh', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
const existing = JSON.parse(gh(['api', `repos/${repo}/issues?state=all&per_page=100`, '--paginate', '--slurp'])).flat().filter(issue => !issue.pull_request);
const sync = process.argv.includes('--sync-managed');
function nativeRelationship(args) {
  try {
    return gh(args);
  } catch (error) {
    // Only unsupported endpoints may fall back. Auth, network and validation failures remain failures.
    if (/HTTP (404|410|501)/.test(String(error.stderr))) {
      console.warn(`Native relationship unavailable: ${args.join(' ')}; using explicit textual references.`);
      return undefined;
    }
    throw error;
  }
}
const byKey = new Map();
for (const ticket of tickets) {
  const marker = `<!-- delivery:${ticket.key} -->`;
  const matches = existing.filter(i => i.body?.includes(marker));
  if (matches.length > 1) throw new Error(`Duplicate marker ${marker}`);
  let issue = matches[0];
  const refs = ticket.blockedBy.map(key => `#${byKey.get(key).number}`);
  const nativeCapability = !['runtime', 'zcode-design', 'native-ui-gate', 'native-agent'].includes(ticket.key);
  const label = ticket.label ?? 'ready-for-agent';
  const body = [
    marker, `Blocked by: ${refs.join(', ') || 'None (can start immediately).'}`, '## Parent', '#1 — 完整首版范围；本票不缩减父规格。',
    '## Coverage', `能力：${ticket.capabilities.join(', ')}。`, `用户故事：${ticket.stories.map(n => `US${String(n).padStart(2, '0')}`).join(', ')}（编号对应父规格）。`, `验收场景：${ticket.scenarios.join(', ')}。`,
    '## What to build', ticket.outcome,
    ...(nativeCapability ? ['## Native ZCode delivery contract', nativeContract.trim()] : []),
    '## Boundaries and decisions', ...ticket.decisions.map(x => `- ${x}`),
    '## Acceptance criteria', ...ticket.acceptance.map(x => `- [ ] ${x}`),
    '## Testing', ...ticket.tests.map(x => `- ${x}`),
    '## Blocked by', refs.length ? refs.map(x => `- ${x}`).join('\n') : 'None (can start immediately).',
    '## Evidence', '实施后回写 PR、实际执行命令/结果、协议场景、关键 UI 截图和真实环境验收。尚未执行或受外部条件阻塞的项目保持未完成。',
  ].join('\n\n');
  if (!issue) {
    const url = gh(['issue', 'create', '--repo', repo, '--title', ticket.title, '--label', label, '--body-file', '-'], body);
    issue = { number: Number(url.split('/').at(-1)) };
  } else if (issue.body.split('## Evidence')[0] !== body.split('## Evidence')[0] || issue.title !== ticket.title) {
    if (!sync) throw new Error(`Managed content drift in #${issue.number}; review then use --sync-managed. Evidence is preserved.`);
    const evidenceIndex = issue.body.indexOf('## Evidence');
    if (evidenceIndex < 0) throw new Error(`#${issue.number} has no evidence boundary; reconcile manually.`);
    gh(['issue', 'edit', String(issue.number), '--repo', repo, '--title', ticket.title, '--body-file', '-'], body.split('## Evidence')[0] + issue.body.slice(evidenceIndex));
  }
  const details = JSON.parse(gh(['api', `repos/${repo}/issues/${issue.number}`]));
  if (!details.labels.some(item => item.name === label)) gh(['issue', 'edit', String(issue.number), '--repo', repo, '--add-label', label]);
  const otherReadyLabel = label === 'ready-for-human' ? 'ready-for-agent' : 'ready-for-human';
  if (details.labels.some(item => item.name === otherReadyLabel)) gh(['issue', 'edit', String(issue.number), '--repo', repo, '--remove-label', otherReadyLabel]);
  byKey.set(ticket.key, { number: issue.number, id: details.id });
  const childResponse = nativeRelationship(['api', `repos/${repo}/issues/1/sub_issues`, '--paginate', '--slurp']);
  const children = childResponse ? JSON.parse(childResponse).flat() : undefined;
  if (children && !children.some(child => child.id === details.id)) nativeRelationship(['api', '--method', 'POST', `repos/${repo}/issues/1/sub_issues`, '-F', `sub_issue_id=${details.id}`]);
  const blockerResponse = nativeRelationship(['api', `repos/${repo}/issues/${issue.number}/dependencies/blocked_by`, '--paginate', '--slurp']);
  const blockers = blockerResponse ? JSON.parse(blockerResponse).flat() : undefined;
  if (!blockers) continue;
  const desiredIds = ticket.blockedBy.map(key => byKey.get(key).id);
  for (const blocker of blockers.filter(item => !desiredIds.includes(item.id))) {
    if (!sync) throw new Error(`Removed blocker #${blocker.number} still linked to #${issue.number}; review then --sync-managed.`);
    nativeRelationship(['api', '--method', 'DELETE', `repos/${repo}/issues/${issue.number}/dependencies/blocked_by/${blocker.id}`]);
  }
  for (const key of ticket.blockedBy) {
    const blocker = byKey.get(key);
    if (!blockers.some(item => item.id === blocker.id)) nativeRelationship(['api', '--method', 'POST', `repos/${repo}/issues/${issue.number}/dependencies/blocked_by`, '-F', `issue_id=${blocker.id}`]);
  }
  console.log(`${ticket.key}: #${issue.number} | ${refs.join(', ') || 'ready'} | https://github.com/${repo}/issues/${issue.number}`);
}
