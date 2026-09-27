# Pi Agent GUI

把 **Pi Coding Agent 的能力映射到 GUI**，补齐使用 Pi 必需的本地桌面体验。继续以固定 **ZCode 原生开源工程** 为底座，复用原生组件、布局与交互。

用户已于 2026-09-27 收缩范围：Pi 能力 + 必要桌面体验；详细定义见 [当前范围](docs/delivery/pi-first-scope.md)。#33 原生界面关卡已通过，#34 Pi 适配仍等待用户验收。

## 来源和许可

本项目基于 [ZCode](https://github.com/zai-org/ZCode) 原生开源工程（提交 `872ad960de7ec172591f7e1952f7849229f94521`）构建，采用 Apache-2.0 许可证。详细来源追踪见 [UPSTREAM.md](UPSTREAM.md)。

- ZCode 原生工程第一方代码：© Z.AI / ZCode 团队，Apache-2.0
- Pi Agent IDE 适配代码：© 本项目，Apache-2.0
- 第三方依赖：见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)

## 项目规格和文档

- [产品目标与已确认边界](docs/product-goal.md)
- [新开发计划](docs/delivery/native-rebase-plan.md)
- [新上下文执行指令](docs/delivery/next-context.md)
- **[当前任务与依赖清单](docs/delivery/full-development.md)**：#34 关卡、15 张功能票与最终验收；已收缩额外 IDE/远程要求
- [实际原生界面用户确认记录（#33已通过）](docs/delivery/native-ui-confirmation.md)
- [原生界面/交互验收](docs/delivery/native-ui-parity.md)
- [旧分支与成果复用清单](docs/delivery/reuse-inventory.md)
- [主规格 #1：Pi Agent IDE 完整首版](https://github.com/axgiroud312-byte/pi-agent-gui/issues/1)
- [GitHub Issues](https://github.com/axgiroud312-byte/pi-agent-gui/issues)

## 首版产品范围

- **Pi 能力映射**：对话、图片、工具、模型、认证、thinking、双队列、停止、重试、压缩、历史、树/分支、Skills、模板、扩展、配置及固定版本的其他原生功能。
- **必要桌面体验**：本地项目选择、原生输入框、文件引用与预览、会话切换、设置、可靠启动和保存恢复。
- **范围边界**：WSL/SSH、完整 LSP/Git/GitHub、通用多终端/开发服务平台、内置 Plan/子 Agent/MCP/调度不作为首版必做。Pi 在线模型/OAuth 和扩展兼容仍保留；复杂 TUI 明示限制。

当前能力与验收状态见 [覆盖账本](docs/delivery/coverage.md)，退出范围的历史见 [快照](docs/delivery/archive/scope-before-2026-09-27/README.md)。

## 实现基线

| 领域 | 方案 |
| --- | --- |
| 桌面与前端 | 固定 ZCode 原生 Electron 工程、React 组件、Lexical 输入框、时间线、布局状态与服务接口 |
| Agent 适配（#34） | Pi 0.87.0 JSONL RPC；服务适配映射原生命令/订阅，每活动会话独立 Pi 运行隔离 |
| 本地 IDE 服务 | 复用原生文件、引用/预览、设置和平台服务，补齐使用 Pi 必需的部分 |
| Pi 特有能力 | 原生菜单、设置、详情与 Side Pane 中最小增补；保持 Pi 真实语义 |
| 首版发行 | 可启动 Windows 桌面与本地 Pi CLI 历史互通；远程工作区、Web/独立 CLI 产品不作为首版要求 |
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

原生底座PR #37已合并（`59362a3`），#32/#36完成；用户于2026-09-23确认实际界面，#33已关闭。Pi 接入 #34 已有 Draft PR #39；最新本地修复与试用包仍未提交，当前停在用户验收。后续范围和任务已重写，本次文档更新不代表产品实现完成或 #34 已合并。

- [本轮验收与限制](docs/delivery/issue-32-acceptance.md)
- [26对实际原版/产品截图](docs/delivery/issue-32-parity/index.html)
- 构建后隔离预览：`node scripts/start-native-preview.mjs`。
- 复现产品原生GUI smoke：`node scripts/native-desktop-smoke.mjs`，使用受控本地模型端点，不代表Pi或真实供应商验收。

旧原型代码备份在 `.backup-old-prototype/`，可复用的 Pi 模块和测试记录在独立 worktree 中。详见 [覆盖账本](docs/delivery/coverage.md)。

## 贡献和开发流程

见当前 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [领域词汇](CONTEXT.md)。远程 CI 已取消，按改动范围完成相关本地验证。

## 旧原型备份

原 npm 基础原型（v0.1.0-dev.1）的源码备份在 `.backup-old-prototype/` 目录，包括：

- 旧 src/、package.json、vite.config.ts
- 旧 scripts/、tests/、playwright.config.ts
- 这些文件用于研究和模块迁移，不直接作为新产品底座

相关验证和 Pi RPC 实现见保留的 worktree 分支，按 [reuse-inventory.md](docs/delivery/reuse-inventory.md) 后续迁入。
