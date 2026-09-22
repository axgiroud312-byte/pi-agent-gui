# Issue #32 导入计划

执行日期：2026-09-22  
分支：`issue-32-native-zcode-import`  
固定来源：`zai-org/ZCode@872ad960de7ec172591f7e1952f7849229f94521`

## 导入策略

采用**选择性导入 + 项目文档保留**策略：

1. 保留当前项目的 Git 历史、docs/、AGENTS.md、CONTEXT.md、CONTRIBUTING.md、README.md
2. 从 ZCode 固定提交导入完整工程结构：packages/、apps/、scripts/、public/、config/ 等
3. 采用 ZCode 的根 package.json、pnpm-lock.yaml、pnpm-workspace.yaml、tsconfig.base.json
4. 保留 ZCode 的 LICENSE、NOTICE.md、THIRD-PARTY-NOTICES.md，添加来源说明
5. 记录所有导入文件的来源提交和许可证

## 品牌适配计划

### 需要替换的品牌元素

- 产品名称：ZCode → Pi Agent IDE
- 窗口标题、关于对话框、启动画面
- Logo 和图标（保留原图标作为参考，标注来源）
- package.json 中的名称和描述

### 需要移除的厂商入口（按 product-goal.md）

- Z.AI/BigModel 产品账户入口
- Coding Plan/充值/团队/闲时票据
- 厂商云分享/反馈/更新服务（保留功能位置，替换为本项目服务）
- 厂商 MCP/包分发账号入口

### 需要保留的通用功能

- Pi 支持的 provider 认证（API-key、OAuth）
- 通用 MCP 配置和连接
- 本地文件、Git、终端、预览服务
- 通用分享、诊断、更新能力（使用本项目实现）

## 执行步骤

### 第一阶段：基础导入

1. 从临时克隆复制完整 ZCode 工程结构
2. 保留项目特有文档和开发规格
3. 建立来源追踪文件 `UPSTREAM.md`
4. 更新 LICENSE 和 NOTICE

### 第二阶段：构建验证

1. 按 ZCode README 安装依赖：`pnpm bootstrap`
2. 尝试启动桌面版：`pnpm dev:desktop`
3. 记录 Windows 环境的实际问题和必要调整
4. 建立可运行的开发环境

### 第三阶段：品牌和入口处理

1. 替换产品名称和标识
2. 识别并标记厂商专属入口
3. 保持原生 UI 结构，仅调整必要文本和配置
4. 记录每项变更的理由和位置

### 第四阶段：对照和验收

1. 在隔离数据目录运行原版 ZCode
2. 运行产品副本，验证原生界面可操作
3. 采集 1280×800 和 1920×1080、明暗主题的成对截图
4. 记录操作路径和差异清单
5. 提交证据到 #33

## 风险和限制

- ZCode 锁定 Node 24.14.0、pnpm 10.33.2，当前系统 Node 版本需核对
- 原生构建可能依赖特定平台工具或网络资源
- 厂商服务端点可能需要认证或不可访问
- 完整功能验证需要真实模型和执行环境

## 不在本次范围

- Pi RPC 后端替换（属于 #34）
- 旧功能分支的代码迁移（按 reuse-inventory.md 后续处理）
- 完整的 E2E 测试覆盖（先建立基线）
