# Upstream Source Tracking

本项目以 ZCode 原生开源工程为底座，在 Agent 服务边界适配 Pi Coding Agent。

## ZCode 原生工程来源

- **仓库**: https://github.com/zai-org/ZCode
- **固定提交**: `872ad960de7ec172591f7e1952f7849229f94521`
- **提交消息**: "feat: open source"
- **提交日期**: 2026-09-21（固定 Git 对象核实）
- **许可证**: Apache License 2.0
- **导入日期**: 2026-09-22
- **导入分支**: `issue-32-native-zcode-import`

## 导入的完整结构

以下目录和文件从固定提交完整导入：

### 核心工程
- `packages/` - 完整 workspace 包：ui, services, desktop, rpc, provider, shared 等
- `apps/` - ZCode CLI 和应用入口
- `scripts/` - 构建、开发和发布脚本
- `public/` - 公共资源、Logo 和图标
- `config/` - 工程配置
- `third-party/` - 第三方组件和声明
- `patches/` - pnpm patch 文件

### 构建和依赖
- `package.json` - 根 package.json，定义 workspace 和脚本
- `pnpm-workspace.yaml` - pnpm workspace 配置
- `pnpm-lock.yaml` - 锁定的依赖版本
- `tsconfig.base.json` - TypeScript 基础配置
- `.npmrc` - npm 配置
- `mise.toml` - 工具版本锁定

### 开发工具配置
- `.oxlintrc.json` - Oxlint 配置
- `.oxfmtrc.json` - Oxfmt 配置
- `.prettierignore` - Prettier 忽略规则
- `knip.json` - Knip 配置
- `architecture-policy.yaml` - 架构策略

### 许可证和声明
- `LICENSE` - Apache 2.0 许可证全文
- `NOTICE.md` - ZCode 功能说明与第三方组件声明
- `THIRD-PARTY-NOTICES.md` - 完整第三方许可证列表

### #32 来源修复（2026-09-22）

- 补回 `third-party/inventory.json` 引用、初次导入遗漏的 220 个 `.agents/skills/` 文件：agent-browser、ai-elements、dogfood、electron、react-best-practices。来源仍为上述固定 ZCode Git 对象；这是上游来源材料，项目工作约定仍以本仓库根 `AGENTS.md`、`CONTRIBUTING.md` 和交付规格为准。
- 恢复上游对原始许可和聚合声明的 `-text` 属性；两份 native-search 许可保留原始 CRLF，其他许可不批量改写。普通文本固定 LF，让 copied-source 字节哈希在 Windows 新检出中可重现。
- 按当前实际源文件和与冻结锁文件匹配的安装图重新生成清单。固定上游原清单已落后于其自身 `package.json`、`packages/ui/src/lib/builtinSkillI18n.ts`；保留源文件，重生成对应哈希及原生成器产生的 19 项 `reviewRequired`，不清空这些未完成项。
- 验证命令、范围及集成后的重生成步骤见 [#32 CI/来源报告](docs/delivery/issue-32-ci-provenance.md) 和 [第三方材料说明](third-party/README.md)。

### 上游文档（保留作为参考）
- `README.md` → `docs/upstream/zcode-README.md`
- `README.en.md` → `docs/upstream/zcode-README.en.md`
- `DESIGN.md` → `docs/upstream/zcode-DESIGN.md`
- `CONTEXT.md` → `docs/upstream/zcode-CONTEXT.md`
- `AGENTS.md` → `docs/upstream/zcode-AGENTS.md`

## 本项目保留的文档

以下文件为本项目开发规格和文档，保留在项目根目录：

- `README.md` - Pi Agent IDE 项目说明
- `CONTEXT.md` - Pi Agent IDE 领域词汇
- `AGENTS.md` - Pi Agent IDE 的 Agent 技能约定
- `CONTRIBUTING.md` - 开发流程
- `docs/` - 完整项目文档、ADR、产品目标和交付计划
- `.github/` - GitHub workflows 和项目配置

## 品牌和产品适配

### 产品名称替换

| 原名称 | 新名称 | 位置 |
| --- | --- | --- |
| ZCode | Pi Agent IDE | package.json, 窗口标题, 关于对话框 |
| zcode (命令) | pi-agent-ide | CLI 入口（如适用） |

### 厂商入口处理

按 `docs/product-goal.md` 确认的边界：

- **移除**: Z.AI/BigModel 产品账户、Coding Plan、充值、团队、闲时票据、厂商云服务
- **保留**: Pi 支持的 provider 认证、通用 MCP、本地服务、通用分享/诊断/更新能力

具体入口和代码位置记录在 `docs/delivery/native-ui-parity.md`。

## 修改记录

所有对原生源码的修改均在 Git 提交中记录，提交信息包含：

1. 修改类型（brand:, feat:, fix:, docs:）
2. 修改原因和关联 Issue
3. 受影响的文件和功能

## 版权归属

- ZCode 原生工程第一方代码：© Z.AI / ZCode 团队，Apache-2.0
- Pi Agent IDE 适配代码：© 本项目，Apache-2.0（如适用）
- 第三方依赖：见 `THIRD-PARTY-NOTICES.md` 和各依赖包的许可证

## 后续更新

本项目不跟踪 ZCode upstream 的后续更新。固定在 `872ad960de` 提交作为稳定基线，后续演进在本项目独立进行。需要合并上游变更时，建立新的评估和导入计划。
