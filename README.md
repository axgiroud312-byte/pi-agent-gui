# Pi Agent IDE

以 **ZCode 原生开源工程** 为底座，保留原生界面布局和用户交互，将 Agent 内核适配为 **Pi Coding Agent**，交付本地优先的 Windows 通用 Agent IDE。

**当前路线：先原生 ZCode 跑通并建立对照 → 用户确认界面 → Pi RPC 后端替换 → 全量能力验收。** 默认保留原生组件、状态、布局和操作路径；仅移植颜色/圆角或重建一个类似界面不满足目标。

## 来源和许可

本项目基于 [ZCode](https://github.com/zai-org/ZCode) 原生开源工程（提交 `872ad960de7ec172591f7e1952f7849229f94521`）构建，采用 Apache-2.0 许可证。详细来源追踪见 [UPSTREAM.md](UPSTREAM.md)。

- ZCode 原生工程第一方代码：© Z.AI / ZCode 团队，Apache-2.0
- Pi Agent IDE 适配代码：© 本项目，Apache-2.0
- 第三方依赖：见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)

## 项目规格和文档

- [产品目标与已确认边界](docs/product-goal.md)
- [新开发计划](docs/delivery/native-rebase-plan.md)
- [新上下文执行指令](docs/delivery/next-context.md)
- [原生界面/交互验收](docs/delivery/native-ui-parity.md)
- [旧分支与成果复用清单](docs/delivery/reuse-inventory.md)
- [主规格 #1：Pi Agent IDE 完整首版](https://github.com/axgiroud312-byte/pi-agent-gui/issues/1)
- [GitHub Issues](https://github.com/axgiroud312-byte/pi-agent-gui/issues)

## 首版产品范围

- **IDE 工作台**：多工作区、并行会话、可拖动分栏、文件树、代码编辑、全局搜索、代码导航与诊断。
- **执行环境**：本地、WSL、SSH 工作区，独立会话运行时，真实集成终端、后台任务、浏览器与应用预览。
- **开发闭环**：Git 状态、Diff、分支、worktree、提交与同步、冲突处理，以及 GitHub Issue / PR / 检查结果。
- **Pi 全能力**：模型与提供商认证、thinking、流式消息、工具、双队列、停止、自动重试、压缩、会话树、fork / clone、导入导出和分享。
- **开放扩展**：Skills、提示模板、上下文指令、主题、包管理、自定义工具与 provider、扩展 UI；预置 Plan、任务与子 Agent、MCP 接入。
- **产品化**：全局与工作区配置、快捷键、用量与运行诊断、通知、恢复、安装和更新。

基础 RPC 未覆盖的 Pi 功能通过公开扩展 API、宿主服务及必要的版本化兼容层补齐。每项能力需要可操作的入口与验收证据。

## 实现基线

| 领域 | 方案 |
| --- | --- |
| 桌面与前端 | 固定 ZCode 原生 Electron 工程、React 组件、Lexical 输入框、时间线、布局状态与服务接口 |
| Agent 驱动 | Pi 0.87.0 JSONL RPC；服务适配映射原生命令/订阅，每活动会话独立 Pi 运行隔离 |
| 本地 IDE 服务 | 优先复用原生文件、Git、终端、预览和平台服务，补齐主规格差额 |
| Pi 特有能力 | 原生菜单、设置、详情与 Side Pane 中最小增补；保持 Pi 真实语义 |
| 首版发行 | Windows 桌面，包含 WSL/SSH 与 Pi CLI 互通；Web/独立 CLI 不作为首版产品 |
| 测试 | 原版/产品逐屏逐操作对照，加原生 GUI → 服务适配 → Pi RPC/宿主真实链路 |

## 开发和运行

### 初始化

准备 Git、**Node.js 24.14.0** 和 **pnpm 10.33.2**，版本以 [mise.toml](mise.toml) 为准。

```bash
pnpm bootstrap
```

`pnpm bootstrap` 安装 workspace 依赖、准备桌面本地运行资源，再执行 `build:bootstrap`。

根据需要选择其他初始化或构建入口：

| 命令 | 用途 |
| --- | --- |
| `pnpm install` | 安装依赖 |
| `pnpm prepare:desktop-runtime` | 准备桌面运行资源 |
| `pnpm build` | 递归执行各 workspace 包的构建脚本 |

### 运行桌面应用

```bash
pnpm dev:desktop
```

开发模式启动 Electron 桌面应用。更多命令见根 `package.json` 的 scripts。

### 架构和包结构

本项目是 pnpm workspace monorepo：

- `packages/ui` - 共享 React UI 组件
- `packages/services` - 服务层和状态管理
- `packages/desktop` - Electron 桌面应用
- `packages/rpc` - RPC 协议和类型
- `packages/provider` - 模型 provider 接口
- `apps/zcode-cli` - Agent CLI 运行时

详细架构见 ZCode 上游文档：[docs/upstream/zcode-README.md](docs/upstream/zcode-README.md)

## 当前进度

当前进入**原生 ZCode 底座导入阶段**（Issue #32）。完整原生工程已导入，下一步：

1. 执行 `pnpm bootstrap` 安装依赖
2. 验证 `pnpm dev:desktop` 可启动
3. 替换产品品牌和处理厂商入口
4. 建立原版/产品对照截图和操作记录
5. 提交证据到 #33 等待用户确认

旧原型代码备份在 `.backup-old-prototype/`，可复用的 Pi 模块和测试记录在独立 worktree 中。详见 [覆盖账本](docs/delivery/coverage.md)。

## 贡献和开发流程

见 [CONTRIBUTING.md](docs/pi-agent-ide-CONTRIBUTING.md) 和 [领域词汇](docs/pi-agent-ide-CONTEXT.md)。

## 旧原型备份

原 npm 基础原型（v0.1.0-dev.1）的源码备份在 `.backup-old-prototype/` 目录，包括：

- 旧 src/、package.json、vite.config.ts
- 旧 scripts/、tests/、playwright.config.ts
- 这些文件用于研究和模块迁移，不直接作为新产品底座

相关验证和 Pi RPC 实现见保留的 worktree 分支，按 [reuse-inventory.md](docs/delivery/reuse-inventory.md) 后续迁入。
