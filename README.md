# Pi Agent GUI

为 **Pi Coding Agent** 打造本地优先的桌面图形界面，使用 `pi --mode rpc` 的 JSONL 协议驱动 Agent。

交互参考 Claude Code Desktop、Codex App 和 ZCode：以工作区、会话、流式对话、工具执行和代码改动查看为核心。前端优先复用成熟的开源基础组件与 Agent 组件。

## 当前进度

当前处于 **规格阶段**，已建立 GitHub Issue 驱动的开发约定。本仓库目前提供需求与开发文档，可运行的 GUI 将通过后续实施 Issue 交付。

- [GitHub Issues：规格与任务的权威来源](https://github.com/axgiroud312-byte/pi-agent-gui/issues)
- [可由 Agent 继续处理的 Issue](https://github.com/axgiroud312-byte/pi-agent-gui/issues?q=is%3Aissue%20is%3Aopen%20label%3Aready-for-agent)
- [开发流程](CONTRIBUTING.md)
- [领域词汇](CONTEXT.md)
- [上游接口、交互和组件参考](docs/references/upstream-and-ui.md)

## 实现基线

| 领域 | 方案 |
| --- | --- |
| 桌面端 | Windows 优先；Electron + React + TypeScript |
| Agent 驱动 | 独立 Pi 子进程，stdin/stdout JSONL RPC |
| 通用组件 | shadcn/ui、Radix、Tailwind CSS、Lucide |
| Agent 组件 | assistant-ui，使用外部状态适配器承接 Pi 会话投影 |
| 工作区体验 | 项目与会话侧栏、中央对话、可收起的改动详情区 |
| 测试 | 在 Pi 子进程边界替换测试进程，验收完整 GUI 操作链路 |

上游基准为已发布的 `@earendil-works/pi-coding-agent@0.87.0`，实现时固定依赖和协议样例。旧仓库 `badlogic/pi-mono` 已跳转到 [earendil-works/pi](https://github.com/earendil-works/pi)。

## Matt 工作流

1. **`to-spec`**：把目标与已确认的测试边界发布为 `ready-for-agent` 规格 Issue。
2. **`to-tickets`**：将规格拆成可独立验收的纵向切片 Issue，并声明阻塞依赖。
3. **`implement`**：按无阻塞的实施 Issue 开发，提交用户可观察的验收证据。
4. **`code-review`**：对照规格与仓库约定审查对应变更，通过后关闭实施 Issue。

Matt 的 tracker、标签和领域文档约定位于 [docs/agents](docs/agents)，可直接编辑。
