# Agent Handoff：完成 Pi Agent GUI 剩余全部范围

## 可直接交给下一开发 Agent 的指令

你现在接手 `C:\Users\niilo\Desktop\pi-agent-gui`。请连续完成 Pi Agent GUI 当前保留范围内的所有剩余开发、排错、审查、回归和 Windows 打包，直到产品形成一条完整、连贯、可统一验收的用户流程。不要在每个功能或 Issue 后要求用户分批试用；用户明确要求等所有功能打通后再进行一次实际测试。

### 最终目标

以 ZCode 原生桌面工程和现有 RPC 主会话架构为底座，让固定版 Pi 成为消息、工具、历史、运行、队列、重试、压缩、模型与扩展状态的唯一事实来源。完成 `#3–#14、#25–#28` 的保留范围，交付一个实际启动并由代理完成本地验证的 Windows 版本，最后提供一份统一的用户验收步骤并停在“等待用户最终验收”。

### 开始前必须执行

1. 完整读取：
   - `AGENTS.md`
   - `CONTRIBUTING.md`
   - `docs/product-goal.md`
   - `docs/adr/0001-native-zcode-base.md`
   - `docs/adr/0002-pi-capability-scope.md`
   - `docs/delivery/pi-first-scope.md`
   - `docs/delivery/next-context.md`
   - `docs/delivery/full-development.md`
   - `docs/delivery/tickets.json`
   - `docs/delivery/coverage.md`
   - `docs/delivery/reuse-inventory.md`
   - `docs/delivery/native-ui-parity.md`
   - `docs/delivery/pi-capability-preview-2026-09-27.md`
   - `docs/references/upstream-and-ui.md`
2. 读取 GitHub #1、#34、当前实施票的最新正文、评论、父规格和阻塞任务。GitHub 最新内容优先于旧交接。
3. 检查并记录：`git status -sb`、当前 HEAD、远程差异、worktree、stash、未提交和未跟踪文件。
4. 以步骤 3 的实时 Git/GitHub 结果和 [继续开发断点](next-context.md) 为准。本文初写时的 `HEAD=331a9b168073ed4178746f498b0a84cbbab4b1d2` 仅是历史快照，**不得 reset 回此版本**；工作分支为 `issue-34-native-pi-rpc`，PR #39 保持 Draft，#34 保持 OPEN。
5. 必须保留 `%SystemDrive%/`、`用` 和 `stash@{0}: scope-doc-copies-before-main-integration-2026-09-27`。禁止 `reset --hard`、`clean`、强推、删除恢复材料或批量暂存未知文件。

### 用户最新验收策略

- 不要现在要求用户逐项测试；先统一开发完成。
- 代理仍须持续执行所有自身可完成的自动测试、受控真实 Pi 测试、GUI→Host→Pi 链路、包内运行和进程清理验证。
- 缺少真实账号、OAuth 人工步骤、GGUF/router 或安装权限时，记录为明确阻塞，继续其余开发；不得用 mock、受控 provider 或源码测试冒充在线/安装器通过。
- 不得伪造 #34 人工验收，不得提前关闭 Issue、合并 Draft PR 或正式发布。
- 技术上可继续后续保留票，但在 #34 最终用户验收前，不把依赖票标成已完成人工验收。

### 初写时已完成的历史快照，避免重复

- `04de955`：压缩失败与恢复状态保存。
- `ddbf196`：旧 #34 handoff 标为历史。
- `f41457e`：整合 Pi-first main 基线。
- `06c0f88`：图片 RPC、steer/follow-up、完整停止、模型/thinking/usage、compact、阻塞扩展 UI。
- `0b71ff0`：Pi 拥有草稿模型 readiness。
- `f9b24c4`：Pi 模型与资源命令 catalog 刷新。
- `2856e28`、`8d42fb9`：Composer 资源 Pi-scoped，移除子 Agent 建议。
- `331a9b1`：任务账本已同步。
- 当时的 Pi 测试 116/116、typecheck、定向 lint、delivery checks、desktop build 和旧 Windows 包内启动曾通过；这些结果不代表后续源码的最终 Windows 包或安装器验收。最新结果见 [能力账本](coverage.md) 与 [继续开发断点](next-context.md)。

### 剩余实施顺序

按依赖连续推进，优先完成真实用户路径，不要只补账本：

1. **#3、#4、#5**
   - 原生选择/粘贴/拖入图片，预览与真实 MIME/字节送入 Pi。
   - 模型搜索/选择/循环、thinking 等级、重试与自动/手动压缩的完整 GUI 状态。
   - 双队列真实顺序；附件保真的取回、编辑、重排、立即发送和消费竞态。
   - Stop 覆盖模型、bash、retry、compaction、扩展等待且不续跑。
   - 带/不带模型上下文 shell。
   - 两项目/两会话隔离；草稿、附件、布局和历史重启恢复。
2. **#6、#7、#8、#14**
   - 固定版本、版本化的公开 Pi 扩展 bridge：tree navigation、bookmark/label、reload、generation/关联 ID。
   - 原生 Pi provider 认证中心：动态 provider、API key、OAuth browser/device/manual、取消、刷新、登出；不得读取或记录密钥。
   - 逐类验证 select/confirm/input/editor、notify/status/widget、custom、header/footer/editor factory、主题和 renderer；只实现必要 GUI 等价交互，复杂 TUI 明确限制。
   - 原生文件树、引用、文本/图片/Markdown/工具产物预览和必要编辑保存。
3. **#9、#10、#11**
   - CLI↔GUI 历史续接、真实 entry/tree/fork/clone/edit/retry、目录/筛选/重命名/保护删除。
   - HTML/JSONL 导入导出、复制回复、用户主动分享及预览。
   - Pi 设置来源与作用域、未知字段保留、并发修改/坏 JSON、provider/model 配置和启动 flags。
   - llama.cpp router 列表、SSE/轮询、下载/加载/卸载/取消及 Pi 实际推理接入；无真实服务时保留最终阻塞证据。
4. **#12、#13、#25**
   - Skills、模板、上下文、扩展包的发现、调用、编辑/管理和 reload；来源与 trust 使用 Pi 语义。
   - 扩展状态、widget、动态工具、生命周期与错误映射；取消/reload 不投递旧会话。
   - 完成兼容矩阵和代表扩展样例，隐藏无反馈或超范围入口。
5. **#26、#27**
   - 中文 IME、快捷键、焦点、滚动、长历史/大工具输出和错误可发现性。
   - 保存恢复、Pi/GUI/扩展版本诊断、隐私安全的 bug-report 预览。
   - unpacked、NSIS 安装、覆盖升级、卸载和重启恢复；不要破坏用户真实配置。
6. **#28**
   - 对每个保留 capability/scenario 建立实现与证据映射。
   - 完成 Standards/Spec 审查并修复发现。
   - 区分受控模型、固定真实 Pi、在线 provider、包内运行、安装器和用户验收。
   - 生成最终统一试用包和一次性用户验收清单。

### 严格范围

- `#15–#24` 保持 `not_planned/wontfix`，不得恢复。
- 不另造 MCP、Plan、子 Agent、工作流或调度系统。
- 保留 ZCode 原生组件、布局、状态和操作路径；Pi 特有功能放入合适的原生菜单、设置、输入区或 Side Pane。
- 继承但超范围且会误导的入口应隐藏或明确不可用，不能连接旧 Agent 引擎。
- Pi 是唯一执行者；禁止前端第二队列、假模型状态、假成功或 legacy fallback。
- 迁入旧分支代码前按 `reuse-inventory.md` 逐项审查，不整批 cherry-pick 旧原型。
- 同一目录只能有一个源码写入者；并行实施必须使用隔离 worktree，主代理负责审查和整合。
- 不恢复或等待远程 CI。

### 每批完成要求

- 运行与改动相关的单元、合同、真实 Pi 和桌面链路测试。
- 至少保持：`pnpm run typecheck`、定向 oxlint、Pi 测试、delivery plan 及 `--github` 一致。
- 涉及 GUI/RPC/停止/历史/队列/扩展/恢复时，通过“原生 GUI → 桌面宿主 → 固定真实 Pi → 可观察结果”验证。
- 涉及打包时验证包内固定 Pi，而非仅源码运行。
- 做聚焦提交并推送当前分支；更新 Draft PR、对应 Issue 技术进度和任务账本。
- 不将代理测试写成人工验收，不关闭仍需用户确认的票。

### 最终交付格式

完成所有可实施工作后，只向用户请求一次统一测试，并提供：

1. 最终 unpacked/安装包的精确路径和源码 HEAD/PR。
2. 5–15 分钟可完成的连贯试用流程，而不是按 Issue 碎片化步骤。
3. 每个保留 Issue/capability 的完成状态与证据链接。
4. 自动测试、真实 Pi、在线 provider、包内运行、安装器的独立结果。
5. 仅剩必须由用户完成的账号、设备或主观界面验收项。
6. 已知限制和回退/恢复方式。

然后停在“等待用户最终验收”；未经用户明确确认，不合并、关闭人工验收任务或正式发布。

## 继续执行入口

先读 [继续开发断点](next-context.md) 顶部的最新时间戳记录并核对实时 Git/GitHub，再从其中未完成的代码、回归和隔离 Windows 打包继续。#3/#4/#5 图片、队列和恢复的早期缺口已有后续实现及实测；不能以本文初写时的“第一项行动”重复开工，也不能把局部通过当作最终包验收。
