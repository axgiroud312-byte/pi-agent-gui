# Pi Agent GUI

以 **ZCode 原生开源工程** 为底座，保留原生界面布局和用户交互，将 Agent 内核适配为 **Pi Coding Agent**，交付本地优先的 Windows 通用 Agent IDE。

**当前路线：先原生 ZCode 跑通并建立对照 → 用户确认界面 → Pi RPC 后端替换 → 全量能力验收。** 默认保留原生组件、状态、布局和操作路径；仅移植颜色/圆角或重建一个类似界面不满足目标。

- [产品目标与已确认边界](docs/product-goal.md)
- [新开发计划](docs/delivery/native-rebase-plan.md)
- [新上下文执行指令](docs/delivery/next-context.md)
- [原生界面/交互验收](docs/delivery/native-ui-parity.md)
- [旧分支与成果复用清单](docs/delivery/reuse-inventory.md)

## 首版产品范围

- **IDE 工作台**：多工作区、并行会话、可拖动分栏、文件树、代码编辑、全局搜索、代码导航与诊断。
- **执行环境**：本地、WSL、SSH 工作区，独立会话运行时，真实集成终端、后台任务、浏览器与应用预览。
- **开发闭环**：Git 状态、Diff、分支、worktree、提交与同步、冲突处理，以及 GitHub Issue / PR / 检查结果。
- **Pi 全能力**：模型与提供商认证、thinking、流式消息、工具、双队列、停止、自动重试、压缩、会话树、fork / clone、导入导出和分享。
- **开放扩展**：Skills、提示模板、上下文指令、主题、包管理、自定义工具与 provider、扩展 UI；预置 Plan、任务与子 Agent、MCP 接入。
- **产品化**：全局与工作区配置、快捷键、用量与运行诊断、通知、恢复、安装和更新。

基础 RPC 未覆盖的 Pi 功能通过公开扩展 API、宿主服务及必要的版本化兼容层补齐。每项能力需要可操作的入口与验收证据。

## 当前进度

当前进入**原生 ZCode 底座重建阶段**。#2/#30 经 PR #31 交付了旧自建桌面/RPC 基础，其他工作树保存了可复用 Pi/宿主功能。它们不是原生 ZCode 迁移的完成证明；原生源码导入、运行对照与用户界面关卡尚未完成。详见 [覆盖账本](docs/delivery/coverage.md)。

- [主规格 #1：Pi Agent IDE 完整首版](https://github.com/axgiroud312-byte/pi-agent-gui/issues/1) — 84 条用户故事、34 组 Pi 能力、18 组 IDE 能力与 20 组验收场景。
- [GitHub Issues：规格与任务的权威来源](https://github.com/axgiroud312-byte/pi-agent-gui/issues)
- [可由 Agent 继续处理的 Issue](https://github.com/axgiroud312-byte/pi-agent-gui/issues?q=is%3Aissue%20is%3Aopen%20label%3Aready-for-agent)
- [开发流程](CONTRIBUTING.md)
- [领域词汇](CONTEXT.md)
- [上游接口、交互和组件参考](docs/references/upstream-and-ui.md)

## 实现基线

| 领域 | 方案 |
| --- | --- |
| 桌面与前端 | 固定 ZCode 原生 Electron 工程、React 组件、Lexical 输入框、时间线、布局状态与服务接口 |
| Agent 驱动 | Pi 0.87.0 JSONL RPC；服务适配映射原生命令/订阅，每活动会话独立 Pi 运行隔离 |
| 本地 IDE 服务 | 优先复用原生文件、Git、终端、预览和平台服务，补齐主规格差额 |
| Pi 特有能力 | 原生菜单、设置、详情与 Side Pane 中最小增补；保持 Pi 真实语义 |
| 首版发行 | Windows 桌面，包含 WSL/SSH 与 Pi CLI 互通；Web/独立 CLI 不作为首版产品 |
| 测试 | 原版/产品逐屏逐操作对照，加原生 GUI → 服务适配 → Pi RPC/宿主真实链路 |

ZCode 基准：[`872ad960de7ec172591f7e1952f7849229f94521`](https://github.com/zai-org/ZCode/tree/872ad960de7ec172591f7e1952f7849229f94521)，第一方代码 Apache-2.0；保留许可和第三方声明。Pi 基准：`@earendil-works/pi-coding-agent@0.87.0`，MIT。技术选择调整见 [ADR 0001](docs/adr/0001-native-zcode-base.md)。

## 当前代码的启动状态

以下命令仅运行现存的**旧基础原型**，用于复现历史协议/宿主验证，不是新目标的 ZCode 原生产品。需要 Node.js `>=22.19.0`（历史验证使用 24.14.0）。原生底座导入后会按实际脚本更新这里。

```powershell
npm ci
npm run build
npm start
```

开发界面热更新使用 `npm run dev`；修改桌面宿主后重启开发命令。Electron 首次启动会下载其固定二进制；使用环境代理时可先执行 `npm run install:electron`。

1. 输入绝对目录路径或选择文件夹，点击“打开工作区”。普通文件夹也可使用。
2. 默认使用安装包随附的 Pi 0.87.0；“启动配置”也可设置 Pi 可执行文件，或 Node 可执行文件与包含 Pi CLI 入口的 JSON 参数数组。RPC 模式参数由宿主添加。
3. 可选配置目录对应 `PI_CODING_AGENT_DIR`，留空沿用 Pi 默认位置。模型认证由 Pi 管理，环境变量和原有 Pi 登录可继续使用。
4. 点击“新建会话”，输入文本。Enter / Ctrl+Enter 发送，Shift+Enter 换行，中文输入法候选确认不会发送。
5. 遇到认证失败，在恢复入口打开 Pi 登录终端，输入 `/login` 完成登录，再新建会话。协议或进程失败会保留诊断，不自动重放输入。

宿主配置保存在 Electron userData 下的 `workbench.json`；可用 `--user-data-dir=<绝对路径>` 指定独立工作台配置。Pi 原生会话保存在其自身配置/会话目录，二者分开管理。

## 旧原型检查与开发安装包

```powershell
npm run check
npm run package:win
npm run test:package
```

- `check`：类型、静态检查、合同/宿主边界测试、真实 Pi 无凭据协议测试、构建与 Electron E2E。
- `test:e2e`：外部 RPC 子进程替身驱动完整 GUI，不调用真实模型；截图及结果在 `test-results/e2e/`。
- `test:contract`：实际 npm Pi CLI 合同，凭据隔离；结果在 `test-results/contract/`。
- `test:package`：Windows 打包应用启动其随附真实 Pi，验证原生会话与缺少认证的恢复状态；结果在 `test-results/package/`。
- NSIS 安装包：`release/Pi-Agent-IDE-0.1.0-dev.1-x64.exe`；未打包目录：`release/win-unpacked/`。

旧开发包不代表原生界面已验收。新产品的真实模型、全量扩展兼容、Windows 安装升级回退和外部环境仍由 #28 与对应实施票验收。开源来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## Matt 工作流

1. **`to-spec`**：把完整首版目标、能力矩阵与已确认的测试边界发布为 `ready-for-agent` 规格 Issue。
2. **`to-tickets`**：将规格拆成可独立验收的纵向切片 Issue，并声明阻塞依赖。
3. **`implement`**：按无阻塞的实施 Issue 开发，提交用户可观察的验收证据。
4. **`code-review`**：对照规格与仓库约定审查对应变更，通过后关闭实施 Issue。

Matt 的 tracker、标签和领域文档约定位于 [docs/agents](docs/agents)，可直接编辑。
