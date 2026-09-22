# Pi Agent GUI

## Current delivery direction

- 开始实施或恢复上下文前，先读 `docs/product-goal.md`、`docs/adr/0001-native-zcode-base.md` 和 `docs/delivery/next-context.md`。以 ZCode 原生工程为底座，在 Agent 服务边界适配 Pi。
- 领取任务前核对 `docs/delivery/native-rebase-plan.md` 的原生界面用户确认关卡。关卡没有明确确认时，只推进原生导入与对照，完成后暂停。
- 迁移或整合旧代码前读取 `docs/delivery/reuse-inventory.md`；界面改动按 `docs/delivery/native-ui-parity.md` 验收。

## Agent skills

### Issue tracker

使用 `axgiroud312-byte/pi-agent-gui` 的 GitHub Issues。创建、读取、拆票和更新任务前，阅读 `docs/agents/issue-tracker.md`。

### Triage labels

使用 Matt 默认五标签。分流或更改任务就绪状态前，阅读 `docs/agents/triage-labels.md`。

### Domain docs

采用 single-context。探索代码或调整架构前，按 `docs/agents/domain.md` 读取领域文档。

## Task context

- 开始实施时读取对应 Issue 的正文、评论、父规格和阻塞任务。以 GitHub 上的最新规格与验收条件为准。
- 修改 RPC、会话生命周期或队列处理时，先阅读 `docs/references/upstream-and-ui.md` 中的 Pi 协议来源，再核对固定版本的类型与行为。
- 选择或复用 UI 代码时，先阅读同一参考文档的原生 ZCode 工程部分；默认保留原生组件、状态与操作路径，在引入实际代码的提交中记录来源、版本及许可证。
- 实施与审查按 `CONTRIBUTING.md` 提交验收证据；构建和测试命令以实施后仓库实际提供的脚本为准。
