# 上游接口与 UI 参考

核实日期：2026-09-22。这里记录可追溯的来源与复用方向；产品验收条件以 GitHub 规格 Issue 为准。

## Pi Coding Agent

- 当前仓库：[earendil-works/pi](https://github.com/earendil-works/pi)，原 `badlogic/pi-mono` 会跳转到该仓库。
- 许可证：MIT。
- 已核实 npm 发布版本：`@earendil-works/pi-coding-agent@0.87.0`，Node.js 要求 `>=22.19.0`。
- 固定 release tag：`v0.87.0`，提交 `16787ad5b2dc748047f314ca1bfe7708f30f54f3`。
- 调研时 main：`1a584a7a56eb5e7b4ff8ccbd46430f1533282eed`；实施基线以固定 release 为准。

### 协议依据

| 来源 | 用途 |
| --- | --- |
| [固定版本 RPC 文档](https://github.com/earendil-works/pi/blob/16787ad5b2dc748047f314ca1bfe7708f30f54f3/packages/coding-agent/docs/rpc.md) | 命令、响应、事件及扩展 UI |
| [RPC 类型](https://github.com/earendil-works/pi/blob/16787ad5b2dc748047f314ca1bfe7708f30f54f3/packages/coding-agent/src/modes/rpc/rpc-types.ts) | 实际字段和命令联合类型 |
| [JSON 事件投影](https://github.com/earendil-works/pi/blob/16787ad5b2dc748047f314ca1bfe7708f30f54f3/packages/coding-agent/src/modes/json-event.ts) | 流式事件省略累计 message/partial，工具调用起始携带 ID |
| [RPC 客户端](https://github.com/earendil-works/pi/blob/16787ad5b2dc748047f314ca1bfe7708f30f54f3/packages/coding-agent/src/modes/rpc/rpc-client.ts) | 子进程管理及请求关联参考 |
| [Windows 配置](https://github.com/earendil-works/pi/blob/16787ad5b2dc748047f314ca1bfe7708f30f54f3/packages/coding-agent/docs/windows.md) | 默认 Git Bash、可选 PowerShell 工具 |
| [完整产品与 CLI 清单](https://github.com/earendil-works/pi/blob/16787ad5b2dc748047f314ca1bfe7708f30f54f3/packages/coding-agent/README.md) | 全能力覆盖基线，包含基础 RPC 以外的产品功能 |
| [会话能力](https://github.com/earendil-works/pi/blob/16787ad5b2dc748047f314ca1bfe7708f30f54f3/packages/coding-agent/docs/sessions.md) | 树导航、书签、分支摘要、导出与问题报告 |
| [完整设置](https://github.com/earendil-works/pi/blob/16787ad5b2dc748047f314ca1bfe7708f30f54f3/packages/coding-agent/docs/settings.md) | 全局 / 项目覆盖、缓存、传输、重试、工具与资源 |
| [扩展 API](https://github.com/earendil-works/pi/blob/16787ad5b2dc748047f314ca1bfe7708f30f54f3/packages/coding-agent/docs/extensions.md) | 树导航、动态工具、资源重载、自定义 provider 与 UI |
| [包管理](https://github.com/earendil-works/pi/blob/16787ad5b2dc748047f314ca1bfe7708f30f54f3/packages/coding-agent/docs/packages.md) | npm / Git / 本地来源、作用域、版本固定和资源过滤 |
| [自定义 provider](https://github.com/earendil-works/pi/blob/16787ad5b2dc748047f314ca1bfe7708f30f54f3/packages/coding-agent/docs/custom-provider.md) | 自定义协议、动态目录和 OAuth |
| [llama.cpp](https://github.com/earendil-works/pi/blob/16787ad5b2dc748047f314ca1bfe7708f30f54f3/packages/coding-agent/docs/llama-cpp.md) | 本地 router 接入、模型下载 / 加载 / 卸载 |

需保留的语义：

- RPC 是 stdin/stdout 上的 JSONL 协议，不是 JSON-RPC 2.0、HTTP 或 WebSocket 服务。stderr 单独收集。
- 按 LF 分帧，允许 CRLF；U+2028/U+2029 是字符串内容。UTF-8 字符可以跨数据块。
- `prompt` 成功只代表已接受、排队或由扩展处理。运行是否完全结束使用 `agent_settled`；`agent_end` 只代表一次底层 Agent run 结束。
- `message_update` 按 `contentIndex` 提供增量；`message_end.message` 是最终权威消息。`tool_execution_update.partialResult` 是累计结果，更新展示时替换而不是重复追加。
- `abort` 不清空排队消息。完整停止需要先 `clear_queue`，再 `abort`；同时处理正在等待的扩展交互。
- `get_commands` 包含扩展命令、提示模板和 skills；TUI 内建命令不能自动映射成可调用的 RPC 命令。
- 协议没有 `list_sessions`、Git diff、OAuth 登录或通用工具审批命令。会话目录索引与只读 Git 信息属于宿主职责。
- 文档示例与类型可能存在细节差异，例如命令来源示例使用 `path/location`，固定版本类型使用 `sourceInfo`。实现与 fixture 应以固定版本实际输出和类型核对，保留可选字段的兼容处理。

### 完整 IDE 所需的额外桥接

- `ExtensionCommandContext.navigateTree()` 能跳转会话树并生成分支摘要；`pi.setLabel()` 能设置书签。基础 RPC 的 `get_tree` 仅提供读取能力。
- `ctx.reload()` 提供重载入口；会话替换会使旧的 session-bound 上下文失效，桥接必须在替换后重新绑定。
- `pi.getAllTools()`、`getActiveTools()`、`setActiveTools()` 覆盖动态工具和选择；`getSystemPromptOptions()` 提供上下文与 system prompt 输入来源。
- Provider 认证和模型配置需要管理面适配；模型调用仍由 Pi 执行。支持全局、工作区和执行环境的真实配置作用域。
- RPC 模式中的 `custom()`、自定义 header / footer / editor 和部分主题方法存在明确降级。通用 IDE 的兼容实现需要独立验收，不能把基础 RPC 接通记为所有扩展 UI 已支持。
- Pi README 明确将子 Agent、Plan、MCP、任务等交给扩展。IDE 可通过预置 Pi 扩展提供这些能力；命名和状态需要区分内建能力、预置扩展和第三方扩展。
- 项目信任是当前 Pi 的既有语义：RPC 不会自行弹出 TUI 信任提示，未信任时可能忽略项目资源。GUI 需呈现 Pi 的实际决策和资源加载结果，保持用户配置。

### 测试先例

新仓库尚无测试套件，可借鉴上游测试目标而非照搬其内部 mock 结构：

- [JSONL framing](https://github.com/earendil-works/pi/blob/16787ad5b2dc748047f314ca1bfe7708f30f54f3/packages/coding-agent/test/rpc-jsonl.test.ts)：LF、CRLF、Unicode 分隔符和末尾无换行。
- [Prompt response semantics](https://github.com/earendil-works/pi/blob/16787ad5b2dc748047f314ca1bfe7708f30f54f3/packages/coding-agent/test/rpc-prompt-response-semantics.test.ts)：接受与失败只产生一次命令响应、运行中排队及清空队列。
- [Child process failures](https://github.com/earendil-works/pi/blob/16787ad5b2dc748047f314ca1bfe7708f30f54f3/packages/coding-agent/test/rpc-client-process-exit.test.ts)：进程退出使在途请求失败。

## 产品交互参考

| 产品 | 可核实来源 | 本项目采用的交互方向 |
| --- | --- | --- |
| Claude Code Desktop | [官方 Desktop 文档](https://code.claude.com/docs/en/desktop) | 工作区选择、会话侧栏、固定输入区、工具详情折叠、改动审阅、运行中补充指令 |
| Codex App | [官方功能页](https://developers.openai.com/codex/app/features) | 项目与聊天组织、任务状态、输入附件和渐进展示 |
| ZCode | [README](https://github.com/zai-org/ZCode/blob/872ad960de7ec172591f7e1952f7849229f94521/README.en.md)、[设计系统](https://github.com/zai-org/ZCode/blob/872ad960de7ec172591f7e1952f7849229f94521/DESIGN.md) | 紧凑桌面工作区、独立面板、语义色、可读的工具时间线与键盘操作 |

Claude Code 仓库的 [LICENSE.md](https://github.com/anthropics/claude-code/blob/main/LICENSE.md) 声明 all rights reserved，并引用商业条款；本项目对其采用产品交互参考。`openai/codex` 的 [README](https://github.com/openai/codex/blob/main/README.md) 与目录展示的是开源 CLI、核心、SDK 等，许可证为 Apache-2.0；这不构成桌面 App UI 源码已开放的依据。

## 可复用组件与代码

### 默认组件层

| 项目 | 许可 | 用途 / 适配边界 |
| --- | --- | --- |
| [shadcn/ui](https://github.com/shadcn-ui/ui) | MIT | 侧栏、按钮、菜单、Dialog、Tabs、Tooltip 等通用交互；保持可访问性与一致主题 |
| [assistant-ui](https://github.com/assistant-ui/assistant-ui) | MIT | Thread、Composer、消息和工具展示的基础；由本项目持有 Pi 状态 |
| [Monaco Editor](https://github.com/microsoft/monaco-editor) | MIT | 多文件编辑、Diff、代码导航和语言服务接入 |
| [xterm.js](https://github.com/xtermjs/xterm.js) | MIT | 交互终端、选择复制与终端兼容展示 |
| [node-pty](https://github.com/microsoft/node-pty) | MIT 许可文本，保留多方声明 | 本地 PTY 与 Windows ConPTY；需要随 Electron 验证原生打包 |
| [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels) | MIT | 可调整大小的工作台面板 |

assistant-ui 的 [ExternalStoreRuntime](https://www.assistant-ui.com/docs/runtimes/custom/external-store) 支持外部 store 和能力回调，无需改用其模型后端。使用显式适配将 Pi 消息、工具结果和运行状态投影给组件。Pi 已拥有服务端队列；组件的本地队列不能成为第二套自动调度器。没有实现 Pi 对应能力时不提供编辑、重新生成等回调。

调研提交：shadcn/ui `98a1fe67b439324ddc857f47fbdce056600a4329`；assistant-ui `e525f14b0bd7acbd1f3b4d268aa21d175afa9a94`。实施时锁定实际兼容的已发布依赖版本，不能把调研 main 提交误当成发布版本。

### ZCode 作为源代码参考

仓库 [zai-org/ZCode](https://github.com/zai-org/ZCode) 的第一方代码为 Apache-2.0；固定调研提交 `872ad960de7ec172591f7e1952f7849229f94521`。其 README 明确包含 Electron、Web、共享 React UI 与 Agent runtime。

可优先研究以下局部组件：

- [通用 UI](https://github.com/zai-org/ZCode/tree/872ad960de7ec172591f7e1952f7849229f94521/packages/ui/src/components/ui)
- [Agent 组件](https://github.com/zai-org/ZCode/tree/872ad960de7ec172591f7e1952f7849229f94521/packages/ui/src/components/ai-elements)：工具、reasoning、附件、输入区、队列和 context 展示。
- [会话工作区](https://github.com/zai-org/ZCode/tree/872ad960de7ec172591f7e1952f7849229f94521/packages/ui/src/v4)：时间线、会话输入区、状态面板、队列面板及分栏。
- [消息组件](https://github.com/zai-org/ZCode/blob/872ad960de7ec172591f7e1952f7849229f94521/packages/ui/src/components/ai-elements/message.tsx)：流式与完成态 Markdown、代码块、文件链接和工具栏处理。

ZCode UI 依赖自身 services、store、provider、platform 和 i18n。优先抽取独立、适合 Pi 的展示层；单独评估局部代码复用成本，避免直接带入整套后端与账户业务。引用实际代码时核对 [LICENSE](https://github.com/zai-org/ZCode/blob/872ad960de7ec172591f7e1952f7849229f94521/LICENSE)、[NOTICE](https://github.com/zai-org/ZCode/blob/872ad960de7ec172591f7e1952f7849229f94521/NOTICE.md) 及对应第三方声明。

本次交付为规格与来源整理，尚未引入上述项目的生产代码。
