// Read-only plan/GitHub audit. Importing this module makes no network calls.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const repo = 'axgiroud312-byte/pi-agent-gui';
const url = `https://github.com/${repo}`;
const doc = name => `${url}/blob/main/docs/delivery/${name}`;
const sorted = values => [...values].sort();
const unique = (values, label) => assert.equal(new Set(values).size, values.length, `Duplicate ${label}`);

export function validatePlan(scope, tickets, plan) {
  assert.ok(scope.revision);
  const required = Object.fromEntries(['capabilities', 'scenarios'].map(field => [field, scope[field].map(item => item.id)]));
  for (const [field, ids] of Object.entries(required)) {
    assert.ok(ids.length > 0, `Empty ${field}`);
    unique(ids, field);
    assert.ok(scope[field].every(item => item.name), `Unnamed ${field}`);
  }
  unique(tickets.map(ticket => ticket.number), 'issue numbers');
  const seen = new Map();
  for (const ticket of tickets) {
    assert.ok(Number.isInteger(ticket.number) && ticket.number > 1, `Invalid issue: ${ticket.key}`);
    assert.ok(ticket.key && !seen.has(ticket.key), `Duplicate/missing key: ${ticket.key}`);
    assert.ok(ticket.title, `Missing title: ${ticket.key}`);
    assert.ok(['active', 'historical', 'retired'].includes(ticket.status), `Invalid status: ${ticket.key}`);
    unique(ticket.blockedBy, `blockers: ${ticket.key}`);
    for (const blocker of ticket.blockedBy) {
      assert.ok(seen.has(blocker), `Blocker must precede ${ticket.key}: ${blocker}`);
      assert.notEqual(seen.get(blocker).status, 'retired', `Retired blocker: ${ticket.key}`);
    }
    for (const [field, expected] of Object.entries(required)) {
      assert.ok(Array.isArray(ticket[field]), `Missing ${field}: ${ticket.key}`);
      unique(ticket[field], `${field}: ${ticket.key}`);
      assert.ok(ticket[field].every(id => expected.includes(id)), `Unknown ${field}: ${ticket.key}`);
      if (ticket.status !== 'active') assert.equal(ticket[field].length, 0, `Inactive coverage: ${ticket.key}`);
    }
    if (ticket.status === 'retired') {
      assert.ok(ticket.reason, `Missing retirement reason: ${ticket.key}`);
      assert.equal(ticket.blockedBy.length, 0, `Retired issue still blocked: ${ticket.key}`);
    }
    if (ticket.status === 'active') {
      assert.ok(ticket.outcome, `Missing outcome: ${ticket.key}`);
      for (const field of ['decisions', 'acceptance', 'tests']) assert.ok(Array.isArray(ticket[field]) && ticket[field].length && ticket[field].every(value => typeof value === 'string' && value.trim()), `Missing ${field}: ${ticket.key}`);
    }
    seen.set(ticket.key, ticket);
  }
  const active = tickets.filter(ticket => ticket.status === 'active');
  const implementation = active.filter(ticket => ticket.key !== 'release-acceptance');
  for (const [field, expected] of Object.entries(required)) {
    const covered = new Set(implementation.flatMap(ticket => ticket[field]));
    assert.deepEqual(expected.filter(id => !covered.has(id)), [], `Uncovered ${field}`);
  }
  const final = seen.get('release-acceptance');
  assert.equal(final?.status, 'active', 'Missing final acceptance');
  for (const field of Object.keys(required)) assert.deepEqual(sorted(final[field]), sorted(required[field]), `Final ${field} drift`);
  const ancestors = new Set();
  const visit = key => {
    for (const blocker of seen.get(key).blockedBy) if (!ancestors.has(blocker)) { ancestors.add(blocker); visit(blocker); }
  };
  visit(final.key);
  assert.deepEqual(implementation.filter(ticket => !ancestors.has(ticket.key)).map(ticket => ticket.key), [], 'Final acceptance misses an implementation dependency');
  const rows = [...plan.matchAll(/^\| #(\d+) \|[^|]+\|([^|]+)\|/gm)];
  assert.deepEqual(sorted(rows.map(row => Number(row[1]))), sorted(active.map(ticket => ticket.number)), 'Execution table has missing/duplicate issues');
  for (const row of rows) {
    const ticket = active.find(item => item.number === Number(row[1]));
    const actual = (row[2].match(/#\d+/g) ?? []).map(id => Number(id.slice(1)));
    assert.deepEqual(sorted(actual), sorted(ticket.blockedBy.map(key => seen.get(key).number)), `Table blocker drift: #${ticket.number}`);
  }
  return { active, required };
}

const bullets = values => values.map(value => `- ${value}`).join('\n');
export function renderIssueBody(scope, ticket, tickets) {
  assert.notEqual(ticket.status, 'historical', 'Historical issue bodies are preserved');
  const marker = `<!-- delivery:${ticket.key} -->\n<!-- scope:${scope.revision} -->`;
  const history = `[修改前正文及依赖快照](${doc('archive/scope-before-2026-09-27/issues.json')})`;
  if (ticket.status === 'retired') return `${marker}\n\n## 2026-09-27 范围调整：不计划实施\n\n${ticket.reason}\n\n用户已明确确认产品范围为 **Pi 自己的能力映射到 GUI + 使用 Pi 必要的本地桌面体验**，继续复用 ZCode 原生组件与交互。旧完整 IDE/远程清单不再作为首版合同。\n\n本票以 \`not_planned\` 关闭并标记 \`wontfix\`，不是功能已交付。代码、分支、原评论和历史证据保留；解除其原生阻塞关系，避免继续阻塞保留范围。必要部分的承接见上文。\n\n${history} · [当前任务清单](${doc('full-development.md')}) · [父规格 #1](${url}/issues/1)\n\n远程 CI 已取消。此次仅同步范围，不启动新功能，也不合并或关闭 #34。\n`;
  const blockers = ticket.blockedBy.map(key => `#${tickets.find(item => item.key === key).number}`);
  return `${marker}\n\nParent: #1\nBlocked by: ${blockers.join(', ') || '(none)'}\n\n## 范围更新（2026-09-27）\n\n按用户确认的 [Pi 能力与必要桌面体验](${doc('pi-first-scope.md')}) 重写。本正文覆盖旧评论中的完整 IDE、远程开发、四会话强制指标和远程 CI 要求；旧评论与实现资产保留为历史，不自动视为新原生链路交付。${ticket.key === 'native-agent' ? '\n\n#34 保持 OPEN / PR #39 Draft；最新本地修复和试用包未提交，本次停在用户验收，不自动合并或继续功能。' : ''}\n\n## 用户可见结果\n\n${ticket.outcome}\n\n## Coverage\n\n- Capabilities: ${ticket.capabilities.join(', ')}\n- Scenarios: ${ticket.scenarios.join(', ')}\n\n## 实现决定\n\n${bullets(ticket.decisions)}\n\n## 验收条件\n\n${ticket.acceptance.map(value => `- [ ] ${value}`).join('\n')}\n\n## 本地验证\n\n${bullets(ticket.tests)}\n\n- 相关本地验证及 Standards/Spec 审查按 [CONTRIBUTING](${url}/blob/main/CONTRIBUTING.md) 执行，**不要求远程 CI**。\n- 在线模型、受控模型、真实 Pi、包内运行、安装器和用户验收分别记录，不能互相替代。\n- 本次是规格/任务同步；验收条件未因改写正文而完成。保留未提交工作，领取前核对原生依赖与用户关卡。\n\n## 追溯\n\n${history} · [能力账本](${doc('coverage.md')}) · [任务清单](${doc('full-development.md')}) · [固定 Pi 与 UI 来源](${url}/blob/main/docs/references/upstream-and-ui.md)\n`;
}

export function renderParentBody(scope, tickets) {
  const active = tickets.filter(ticket => ticket.status === 'active');
  const retired = tickets.filter(ticket => ticket.status === 'retired');
  return `<!-- scope:${scope.revision} -->\n\n# Pi 能力映射与必要桌面体验\n\n2026-09-27 用户明确确认本范围，覆盖此前本票及旧评论的 84 故事 / 52 能力 / 20 场景、完整通用 IDE 和远程开发全量要求。\n\n| 层次 | 当前要求 |\n| --- | --- |\n| Pi 自己的能力映射到 GUI | 对话、图片、工具、模型、认证、thinking、队列、停止、重试、压缩、会话历史、分支、Skills、模板、扩展和配置等。以固定 Pi 0.87.0 的公开能力为依据。 |\n| 使用 Pi 必要的桌面体验 | 本地项目选择、输入框、文件引用与预览、会话切换、必要设置、可靠启动和保存恢复；继续复用 ZCode 原生组件与交互。 |\n\n## 架构与范围边界\n\n- Pi 独占消息、工具、历史、运行、队列、重试/压缩事实；主会话继续 JSONL RPC，不退回旧 Agent，不自建模型循环。\n- 保留原生布局、组件、交互、焦点/滚动和必要 UI 状态；在 Agent 服务边界映射。基础 RPC 没有命令的 Pi 原生能力可通过公开 API/扩展桥/必要宿主支持。\n- 在线 provider、API key/OAuth、Pi 原生 llama.cpp、包管理与主动分享保留；WSL/SSH 远程工作区退出。外部写入仍需用户主动操作。\n- 支持扩展加载与必要 GUI 交互；复杂 TUI 按公开接口逐类说明等价、限制或不支持，不承诺第三方零适配。扩展兼容不要求另造 Plan/MCP/子 Agent/调度系统。\n- 不要求完整 LSP/Git/GitHub、通用多终端/后台命令、开发服务平台或云更新产品；必要 shell/启动与文件预览已有保留票承接。\n\n## 当前实施清单\n\n#32 原生底座与 #33 用户界面确认已完成。#34 保持 OPEN / PR #39 Draft，最新本地修复与试用成果未提交；当前停在用户验收。此次只更新文档与任务，不自动合并 #34 或开始后续功能。\n\n${active.map(ticket => `- [ ] #${ticket.number} ${ticket.title}`).join('\n')}\n\n## 退出首版范围（并非已交付）\n\n${retired.map(ticket => `- #${ticket.number}：${ticket.reason}`).join('\n')}\n\n以上旧票以 not_planned/wontfix 退出，保留历史、代码、分支及评论。它们不再阻塞保留范围，也不计入完成能力。\n\n## 当前能力与验收合同\n\n当前 P01–P34 追踪 Pi 映射（定义已按本次边界修订）；D01–D06 追踪必要桌面体验。V01–V12 是本地/真实 Pi/相关在线能力验收场景。旧 I/US/T 清单不再作为完成条件。\n\n- [逐项能力与场景账本](${doc('coverage.md')})\n- [机器范围定义](${doc('scope.json')}) / [实施决定与验收条件](${doc('tickets.json')})\n- [任务清单及原生依赖](${doc('full-development.md')})\n- [旧正文和依赖历史](${doc('archive/scope-before-2026-09-27/README.md')})\n\n## 完成条件\n\n1. 当前范围各项都有原生 GUI→宿主→固定 Pi 的真实交付和验收证据；复杂 TUI 边界明示，未验证不能记为通过。\n2. 在线认证/推理、llama、包与扩展、主动分享、Windows 包和安装器按实际范围分别验收；离线/可控模型不替代在线事实。\n3. 原生交互保留且差异登记，Standards/Spec 审查和相关本地验证通过。**远程 CI 已取消**，旧 CI 要求作历史记录。\n4. 最终版本可启动、可试用、可可靠保存恢复，文档、许可证、兼容版本与产物对应；#28 核对通过并交用户验收后才可能关闭本父规格。\n\n[产品目标](${url}/blob/main/docs/product-goal.md) · [范围详情](${doc('pi-first-scope.md')}) · [接手入口](${doc('next-context.md')}) · [本地验证规则](${url}/blob/main/CONTRIBUTING.md)\n`;
}

export function validateRemoteIssue(scope, ticket, tickets, issue) {
  assert.equal(issue.title, ticket.title, `Title drift: #${ticket.number}`);
  assert.equal(issue.number, ticket.number);
  if (ticket.status === 'historical') {
    assert.equal(issue.state, 'closed', `Historical issue reopened: #${ticket.number}`);
    return;
  }
  assert.equal(issue.body.replace(/\r\n/g, '\n').trim(), renderIssueBody(scope, ticket, tickets).trim(), `Body drift: #${ticket.number}`);
  if (ticket.status === 'retired') {
    assert.equal(issue.state, 'closed', `Retired issue open: #${ticket.number}`);
    assert.equal(issue.state_reason, 'not_planned', `Retired issue falsely completed: #${ticket.number}`);
    assert.ok(issue.labels.some(label => label.name === 'wontfix'), `Missing wontfix: #${ticket.number}`);
    assert.ok(!issue.labels.some(label => ['ready-for-agent', 'ready-for-human'].includes(label.name)), `Retired issue still ready: #${ticket.number}`);
  } else assert.ok(!issue.labels.some(label => label.name === 'wontfix'), `Active issue has wontfix: #${ticket.number}`);
}

async function main() {
  const { values } = parseArgs({ options: { github: { type: 'boolean', default: false } } });
  const scope = JSON.parse(await readFile(new URL('../docs/delivery/scope.json', import.meta.url), 'utf8'));
  const tickets = JSON.parse(await readFile(new URL('../docs/delivery/tickets.json', import.meta.url), 'utf8'));
  const plan = await readFile(new URL('../docs/delivery/full-development.md', import.meta.url), 'utf8');
  const { active, required } = validatePlan(scope, tickets, plan);
  console.log(`Plan valid: ${active.length} active, ${tickets.filter(ticket => ticket.status === 'retired').length} retired; ${required.capabilities.length} capabilities, ${required.scenarios.length} scenarios.`);
  if (!values.github) return;
  const ghJson = args => JSON.parse(execFileSync('gh', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 16 * 1024 * 1024,
  }));
  const pages = endpoint => ghJson(['api', endpoint, '--paginate', '--slurp']).flat();
  const issues = pages(`repos/${repo}/issues?state=all&per_page=100`).filter(issue => !issue.pull_request);
  const parent = issues.find(issue => issue.number === 1);
  assert.equal(parent.body.replace(/\r\n/g, '\n').trim(), renderParentBody(scope, tickets).trim(), 'Parent #1 scope drift');
  const children = pages(`repos/${repo}/issues/1/sub_issues?per_page=100`);
  let edges = 0;
  const frontier = [];
  for (const ticket of tickets) {
    const issue = issues.find(item => item.number === ticket.number);
    assert.ok(issue, `Missing issue #${ticket.number}`);
    const marker = `<!-- delivery:${ticket.key} -->`;
    assert.equal(issues.filter(item => item.body?.includes(marker)).length, 1, `Duplicate/missing marker: ${ticket.key}`);
    assert.ok(issue.body.includes(marker), `Marker on wrong issue: ${ticket.key}`);
    validateRemoteIssue(scope, ticket, tickets, issue);
    assert.ok(children.some(child => child.number === issue.number), `Missing parent #1: #${issue.number}`);
    const blockers = pages(`repos/${repo}/issues/${issue.number}/dependencies/blocked_by?per_page=100`);
    const expected = ticket.blockedBy.map(key => tickets.find(item => item.key === key).number);
    assert.deepEqual(sorted(blockers.map(blocker => blocker.number)), sorted(expected), `Native blocker drift: #${issue.number}`);
    edges += blockers.length;
    if (ticket.status === 'active' && issue.state === 'open' && blockers.every(blocker => blocker.state === 'closed')) frontier.push(issue.number);
  }
  console.log(`GitHub verified: parent #1, ${tickets.length} child issues, ${edges} blocking edges, current bodies and retired not_planned states.`);
  console.log(`Unblocked active issues: ${frontier.sort((a,b) => a-b).map(number => `#${number}`).join(', ') || '(none)'}. This does not authorize implementation or bypass user acceptance.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
