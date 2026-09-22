# Issue #32 实施进度

执行日期：2026-09-22  
分支：`issue-32-native-zcode-import`  
提交：5b65e39

## 已完成

### 1. 完整导入 ZCode 原生工程

✅ 从固定提交 `872ad960de7ec172591f7e1952f7849229f94521` 导入：
- 完整 workspace 包结构：packages/, apps/, scripts/, public/, config/
- 根配置文件：package.json, pnpm-workspace.yaml, pnpm-lock.yaml, tsconfig.base.json
- 许可证和声明：LICENSE, NOTICE.md, THIRD-PARTY-NOTICES.md
- ZCode 上游文档保存在 docs/upstream/

✅ 保留项目资产：
- 项目规格文档：docs/pi-agent-ide-*.md
- 旧原型代码备份：.backup-old-prototype/
- 开发规格和计划：docs/delivery/, docs/adr/, docs/agents/
- 来源追踪：UPSTREAM.md

✅ 依赖和资源准备：
- pnpm 10.33.2 安装成功
- `pnpm install` 完成（ssh2 可选原生模块失败，不影响核心功能）
- `pnpm prepare:desktop-runtime` 成功：
  - 远程资源和 mock CDN 准备完成
  - Agent bundle (zcode.cjs) 构建完成
  - 官方插件 browser-use-plugin, node-repl-host 准备完成
  - Windows 原生搜索工具 (ugrep, ripgrep) 提取完成

### 2. 部分构建成功

✅ 成功构建的包：
- packages/rpc, packages/provider, packages/provider-node
- packages/model-option-map, packages/formal-proof
- packages/zcode-server-cli, packages/server
- packages/desktop 的 host, scheduler, preload 入口

❌ 构建失败：
- packages/web - vite build 崩溃 (exit 3221225477)
- packages/desktop renderer - vite build 崩溃 (exit 3221225477)

## 当前问题

### Vite 构建崩溃

退出码 3221225477 (0xC0000005) 表示 Windows 访问冲突。可能原因：
1. Vite/esbuild 在 Windows 上的内存访问问题
2. 大型 React 项目转换时的资源耗尽
3. Node.js 24.14.0 与 Vite 8.0.8 的兼容性问题

### 潜在解决方案

1. **开发模式启动**：`pnpm dev:desktop` 不需要完整 production build
2. **增加 Node 内存**：`NODE_OPTIONS=--max-old-space-size=8192`
3. **降级 Vite**：如果 8.0.8 不稳定
4. **逐步构建**：先构建 renderer 再构建 desktop

## 下一步计划

### 方案 A：开发模式验证（推荐）

1. 尝试 `pnpm dev:desktop` 启动开发环境
2. 验证原生界面可以加载和操作
3. 采集开发模式下的界面截图
4. 记录必要的品牌和入口调整

### 方案 B：修复 production build

1. 增加 Node.js 内存限制
2. 检查 Vite 配置和依赖版本
3. 尝试分步构建 renderer 和 desktop
4. 如果成功，继续完整验收

### 方案 C：混合验证

1. 在开发模式建立基本对照
2. 并行调查 production build 问题
3. 完整验收包含两种模式的证据

## 当前工作目录状态

```
C:\Users\niilo\Desktop\pi-agent-gui
├── packages/ (完整 ZCode workspace)
├── apps/ (zcode-cli Agent 运行时)
├── scripts/ (ZCode 构建脚本)
├── public/ (Logo 和资源)
├── .backup-old-prototype/ (旧 npm 原型)
├── docs/
│   ├── upstream/ (ZCode 上游文档)
│   ├── delivery/ (实施计划和验收)
│   ├── pi-agent-ide-*.md (项目规格)
│   └── ...
├── node_modules/ (1881 个包)
├── pnpm-lock.yaml
├── package.json (ZCode workspace root)
├── LICENSE (Apache-2.0)
├── NOTICE.md (完整功能和第三方声明)
├── UPSTREAM.md (来源追踪)
└── bootstrap.log (初始化日志)
```

## 验收待办

- [ ] 开发或生产模式成功启动
- [ ] 原生窗口和工作台布局可见
- [ ] 基本交互可操作（选择工作区、创建会话、输入框）
- [ ] 品牌替换（ZCode → Pi Agent IDE）
- [ ] 厂商入口识别和标记
- [ ] 原版 ZCode 对照运行
- [ ] 成对截图采集（1280×800, 1920×1080, 明暗主题）
- [ ] 差异清单记录
- [ ] 提交证据到 #33
