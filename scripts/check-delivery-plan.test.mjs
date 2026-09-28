import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ghJsonWithRetry, renderIssueBody, validatePlan, validateRemoteIssue } from './check-delivery-plan.mjs';

const scope = JSON.parse(await readFile(new URL('../docs/delivery/scope.json', import.meta.url), 'utf8'));
const tickets = JSON.parse(await readFile(new URL('../docs/delivery/tickets.json', import.meta.url), 'utf8'));
const plan = await readFile(new URL('../docs/delivery/full-development.md', import.meta.url), 'utf8');
test('current scope has implementation coverage and consistent execution table', () => validatePlan(scope, tickets, plan));
test('final acceptance cannot conceal a missing implementation capability', () => {
  const broken = structuredClone(tickets);
  for (const ticket of broken) if (ticket.key !== 'release-acceptance') ticket.capabilities = ticket.capabilities.filter(id => id !== 'P20');
  assert.throws(() => validatePlan(scope, broken, plan), /Uncovered capabilities/);
});
test('retired tickets cannot contribute coverage or block retained work', () => {
  const broken = structuredClone(tickets);
  broken.find(ticket => ticket.key === 'remote').capabilities = ['D01'];
  assert.throws(() => validatePlan(scope, broken, plan), /Inactive coverage/);
  broken.find(ticket => ticket.key === 'remote').capabilities = [];
  broken.find(ticket => ticket.key === 'packaging').blockedBy.push('remote');
  assert.throws(() => validatePlan(scope, broken, plan), /Retired blocker/);
});
test('final acceptance cannot skip an implementation dependency', () => {
  const broken = structuredClone(tickets);
  broken.find(ticket => ticket.key === 'release-acceptance').blockedBy = broken.find(ticket => ticket.key === 'release-acceptance').blockedBy.filter(key => key !== 'llama');
  assert.throws(() => validatePlan(scope, broken, plan), /misses an implementation dependency/);
});
test('execution table cannot drift from the dependency contract', () => {
  assert.throws(() => validatePlan(scope, tickets, plan.replace('| #33 |', '| #32 |')), /Table blocker drift/);
});
test('retirement is never accepted as feature completion', () => {
  const ticket = tickets.find(item => item.key === 'remote');
  const issue = { number: ticket.number, title: ticket.title, body: renderIssueBody(scope, ticket, tickets), state: 'closed', state_reason: 'completed', labels: [{ name: 'wontfix' }] };
  assert.throws(() => validateRemoteIssue(scope, ticket, tickets, issue), /falsely completed/);
  issue.state_reason = 'not_planned';
  validateRemoteIssue(scope, ticket, tickets, issue);
  issue.labels.push({ name: 'ready-for-agent' });
  assert.throws(() => validateRemoteIssue(scope, ticket, tickets, issue), /still ready/);
});
test('completed tickets retain coverage and require a completed closed issue', () => {
  const updated = structuredClone(tickets);
  const ticket = updated.find(item => item.key === 'conversation');
  ticket.status = 'completed';
  validatePlan(scope, updated, plan);
  const issue = {
    number: ticket.number,
    title: ticket.title,
    body: renderIssueBody(scope, ticket, updated),
    state: 'closed',
    state_reason: 'completed',
    labels: [],
  };
  validateRemoteIssue(scope, ticket, updated, issue);
  issue.state = 'open';
  assert.throws(() => validateRemoteIssue(scope, ticket, updated, issue), /Completed issue open/);
  issue.state = 'closed';
  issue.labels.push({ name: 'ready-for-agent' });
  assert.throws(() => validateRemoteIssue(scope, ticket, updated, issue), /Completed issue still ready/);
});
test('GitHub transport EOF is retried, while a permanent API error is not hidden', () => {
  let calls = 0;
  const oneTransientFailure = () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('GitHub EOF'), { stderr: 'Get GitHub: EOF' });
    return '[{"number":1}]';
  };
  assert.deepEqual(ghJsonWithRetry(['api', 'example'], oneTransientFailure), [{ number: 1 }]);
  assert.equal(calls, 2);
  calls = 0;
  assert.throws(() => ghJsonWithRetry(['api', 'example'], () => {
    calls += 1;
    throw new Error('HTTP 401');
  }), /401/);
  assert.equal(calls, 1);
});
