# Pi Agent GUI

为 **Pi Coding Agent** 打造本地优先、功能完整的 **通用 Agent IDE**，使用 `pi --mode rpc` 的 JSONL 协议驱动 Agent。

交互参考 Claude Code Desktop、Codex App 和 ZCode。首版覆盖完整开发工作台及固定版本 Pi 的全部产品能力；通过分阶段、分 Issue 实现，最终以完整功能矩阵验收。前端优先复用成熟的开源基础组件、Agent 组件与可复用项目代码。

## 首版产品范围

- **IDE 工作台**：多工作区、并行会话、可拖动分栏、文件树、代码编辑、全局搜索、代码导航与诊断。
- **执行环境**：本地、WSL、SSH 工作区，独立会话运行时，真实集成终端、后台任务、浏览器与应用预览。
- **开发闭环**：Git 状态、Diff、分支、worktree、提交与同步、冲突处理，以及 GitHub Issue / PR / 检查结果。
- **Pi 全能力**：模型与提供商认证、thinking、流式消息、工具、双队列、停止、自动重试、压缩、会话树、fork / clone、导入导出和分享。
- **开放扩展**：Skills、提示模板、上下文指令、主题、包管理、自定义工具与 provider、扩展 UI；预置 Plan、任务与子 Agent、MCP 接入。
- **产品化**：全局与工作区配置、快捷键、用量与运行诊断、通知、恢复、安装和更新。

基础 RPC 未覆盖的 Pi 功能通过公开扩展 API、宿主服务及必要的版本化兼容层补齐。每项能力需要可操作的入口与验收证据。

## 当前进度

完整首版正在按 [覆盖账本](docs/delivery/coverage.md) 实施。目前已有可运行的桌面基础切片：本地工作区、独立 Pi RPC 会话、文本流式输出、运行/重试/失败状态、启动配置与诊断。其余能力继续由 #3–#28 跟踪；当前开发构建不是完整首版。

- [主规格 #1：Pi Agent IDE 完整首版](https://github.com/axgiroud312-byte/pi-agent-gui/issues/1) — 84 条用户故事、34 组 Pi 能力、18 组 IDE 能力与 20 组验收场景。
- [GitHub Issues：规格与任务的权威来源](https://github.com/axgiroud312-byte/pi-agent-gui/issues)
- [可由 Agent 继续处理的 Issue](https://github.com/axgiroud312-byte/pi-agent-gui/issues?q=is%3Aissue%20is%3Aopen%20label%3Aready-for-agent)
- [开发流程](CONTRIBUTING.md)
- [领域词汇](CONTEXT.md)
- [上游接口、交互和组件参考](docs/references/upstream-and-ui.md)

## 实现基线

| 领域 | 方案 |
| --- | --- |
| 桌面端 | Windows 为主要验收平台；Electron + React + TypeScript |
| Agent 驱动 | 每个活动会话独立 Pi 子进程，stdin/stdout JSONL RPC；扩展能力桥接 |
| 通用组件 | shadcn/ui、Radix、Tailwind CSS、Lucide |
| Agent 组件 | assistant-ui，使用外部状态适配器承接 Pi 会话投影 |
| 编辑器与终端 | Monaco Editor / Diff、xterm.js + node-pty |
| 工作区体验 | 项目与会话导航、并行对话、编辑 / Diff / 预览面板、终端与任务区 |
| 测试 | 在 Pi 子进程边界替换测试进程，验收完整 GUI 操作链路 |

上游基准为已发布的 `@earendil-works/pi-coding-agent@0.87.0`，实现时固定依赖和协议样例。旧仓库 `badlogic/pi-mono` 已跳转到 [earendil-works/pi](https://github.com/earendil-works/pi)。

## 本地启动

需要 Node.js `>=22.19.0`（开发验证使用 24.14.0）、npm 和 Git；主要验收平台是 Windows。

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

## 检查与开发安装包

```powershell
npm run check
npm run package:win
npm run test:package
```

- `check`：类型、静态检查、35 项合同/宿主边界测试、真实 Pi 无凭据协议测试、构建与 Electron E2E。
- `test:e2e`：外部 RPC 子进程替身驱动完整 GUI，不调用真实模型；截图及结果在 `test-results/e2e/`。
- `test:contract`：实际 npm Pi CLI 合同，凭据隔离；结果在 `test-results/contract/`。
- `test:package`：Windows 打包应用启动其随附真实 Pi，验证原生会话与缺少认证的恢复状态；结果在 `test-results/package/`。
- NSIS 安装包：`release/Pi-Agent-IDE-0.1.0-dev.1-x64.exe`；未打包目录：`release/win-unpacked/`。

真实模型、全量扩展兼容、Windows 安装升级回退和外部环境验收分别在 #28 与对应实施票登记，离线通过不代替这些验收。开源来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## Matt 工作流

1. **`to-spec`**：把完整首版目标、能力矩阵与已确认的测试边界发布为 `ready-for-agent` 规格 Issue。
2. **`to-tickets`**：将规格拆成可独立验收的纵向切片 Issue，并声明阻塞依赖。
3. **`implement`**：按无阻塞的实施 Issue 开发，提交用户可观察的验收证据。
4. **`code-review`**：对照规格与仓库约定审查对应变更，通过后关闭实施 Issue。

Matt 的 tracker、标签和领域文档约定位于 [docs/agents](docs/agents)，可直接编辑。
