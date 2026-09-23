// Read-only coverage and dependency audit. GitHub remains the live issue/status authority.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { github: { type: 'boolean', default: false } } });
const repo = 'axgiroud312-byte/pi-agent-gui';
const tickets = JSON.parse(await readFile(new URL('../docs/delivery/tickets.json', import.meta.url), 'utf8'));
const ids = (prefix, count) => Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(2, '0')}`);
const required = {
  capabilities: [...ids('P', 34), ...ids('I', 18)],
  stories: Array.from({ length: 84 }, (_, index) => index + 1),
  scenarios: ids('T', 20),
};
const seen = new Set();
for (const ticket of tickets) {
  assert.equal(typeof ticket.key, 'string');
  assert.ok(!seen.has(ticket.key), `Duplicate ticket ${ticket.key}`);
  assert.equal(new Set(ticket.blockedBy).size, ticket.blockedBy.length, `Duplicate blockers: ${ticket.key}`);
  for (const blocker of ticket.blockedBy) assert.ok(seen.has(blocker), `Blocker must precede ${ticket.key}: ${blocker}`);
  for (const [field, expected] of Object.entries(required)) {
    assert.ok(Array.isArray(ticket[field]), `Missing ${field}: ${ticket.key}`);
    assert.equal(new Set(ticket[field]).size, ticket[field].length, `Duplicate ${field}: ${ticket.key}`);
    assert.ok(ticket[field].every(id => expected.includes(id)), `Unknown ${field}: ${ticket.key}`);
  }
  seen.add(ticket.key);
}
// Neither the historical prototype nor the aggregate acceptance ticket can hide a gap.
const implementation = tickets.filter(ticket => !['runtime', 'release-acceptance'].includes(ticket.key));
for (const [field, expected] of Object.entries(required)) {
  const covered = new Set(implementation.flatMap(ticket => ticket[field]));
  assert.deepEqual(expected.filter(id => !covered.has(id)), [], `Uncovered ${field}`);
}
console.log(`Coverage valid: ${tickets.length} slices; 52 capabilities, 84 stories, 20 scenarios; acyclic ordered dependencies.`);
if (!values.github) process.exit(0);

const ghJson = args => JSON.parse(execFileSync('gh', args, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 16 * 1024 * 1024,
}));
const pages = endpoint => ghJson(['api', endpoint, '--paginate', '--slurp']).flat();
const issues = pages(`repos/${repo}/issues?state=all&per_page=100`).filter(issue => !issue.pull_request);
const byKey = new Map();
for (const ticket of tickets) {
  const marker = `<!-- delivery:${ticket.key} -->`;
  const matches = issues.filter(issue => issue.body?.includes(marker));
  assert.equal(matches.length, 1, `Expected one GitHub issue for ${ticket.key}`);
  const issue = matches[0];
  assert.equal(issue.title, ticket.title, `Title drift: #${issue.number}`);
  const coverage = /## Coverage\s+([\s\S]*?)\n## /.exec(issue.body)?.[1];
  assert.ok(coverage, `Missing coverage section: #${issue.number}`);
  const actual = {
    capabilities: coverage.match(/\b[PI]\d{2}\b/g) ?? [],
    stories: (coverage.match(/\bUS\d{2}\b/g) ?? []).map(id => Number(id.slice(2))),
    scenarios: coverage.match(/\bT\d{2}\b/g) ?? [],
  };
  for (const field of Object.keys(required)) {
    assert.deepEqual([...actual[field]].sort(), [...ticket[field]].sort(), `${field} drift: #${issue.number}`);
  }
  byKey.set(ticket.key, issue);
}
const children = pages(`repos/${repo}/issues/1/sub_issues?per_page=100`);
let edges = 0;
const ready = [];
for (const ticket of tickets) {
  const issue = byKey.get(ticket.key);
  assert.ok(children.some(child => child.number === issue.number), `Missing parent #1 relationship: #${issue.number}`);
  const blockers = pages(`repos/${repo}/issues/${issue.number}/dependencies/blocked_by?per_page=100`);
  const expected = ticket.blockedBy.map(key => byKey.get(key).number).sort((a, b) => a - b);
  assert.deepEqual(blockers.map(blocker => blocker.number).sort((a, b) => a - b), expected, `Native blocker drift: #${issue.number}`);
  edges += blockers.length;
  const openBlockers = blockers.filter(blocker => blocker.state === 'open').map(blocker => blocker.number);
  if (issue.state === 'open' && openBlockers.length === 0) ready.push(issue.number);
  console.log(`#${issue.number} ${issue.state}; blockers=[${expected}]; open=[${openBlockers}]; ${ticket.key}`);
}
// The execution table is a convenience index, validated against the existing ticket graph.
const plan = await readFile(new URL('../docs/delivery/full-development.md', import.meta.url), 'utf8');
const rows = [...plan.matchAll(/^\| #(\d+) \|[^|]+\|([^|]+)\|/gm)];
const planned = tickets.filter(ticket => !['runtime', 'zcode-design', 'native-ui-gate'].includes(ticket.key));
assert.deepEqual(rows.map(row => Number(row[1])).sort((a, b) => a - b),
  planned.map(ticket => byKey.get(ticket.key).number).sort((a, b) => a - b), 'Execution table has missing/duplicate issues');
for (const row of rows) {
  const ticket = planned.find(item => byKey.get(item.key).number === Number(row[1]));
  const actual = (row[2].match(/#\d+/g) ?? []).map(id => Number(id.slice(1))).sort((a, b) => a - b);
  assert.deepEqual(actual, ticket.blockedBy.map(key => byKey.get(key).number).sort((a, b) => a - b), `Table blocker drift: #${row[1]}`);
}
console.log(`GitHub verified: ${tickets.length} managed child issues, ${edges} native blocking edges, ${rows.length} execution rows.`);
console.log(`Open implementation frontier: ${ready.sort((a, b) => a - b).map(number => `#${number}`).join(', ') || '(none)'}`);
