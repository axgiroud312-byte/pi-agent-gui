# Pi 设置纵向切片证据（#10）

此切片基于 `4aac4b2`，隔离 worktree 为 `D:\Temp\pi-agent-gui-settings-20260927`。锁文件修复 `af4c578` 是主目录 `0b6d3a1` 的重复 cherry-pick；整合时只需本切片的实现提交。

## 已实现

- 原生设置页的模型配置区域显示 Pi 用户与项目 `settings.json` 原文、路径、有效值及来源、项目是否被 Pi 信任、离线标志和实际历史目录。运行中会话的模型仍由会话控件显示；编辑结果供新会话使用。
- 保存只写选中的作用域，采用原始字节 SHA-256 版本比较。外部修改或 Pi 的 `.lock` 存在时拒绝保存并保留草稿；JSON 非对象、坏 JSON、无效 UTF-8 与超过 1 MiB 的输入拒绝覆盖。成功保存使用同目录临时文件加替换并清理临时文件。
- 未知字段和未修改的嵌套字段保留。有效值及信任解析由固定 Pi 0.87.0 `SettingsManager`、`ProjectTrustStore` 提供。
- 新会话 JSONL 路径按 Pi 的 `--session-dir`、`PI_CODING_AGENT_SESSION_DIR`、用户/项目 `sessionDir` 顺序解析。Pi 在信任检查前读取项目 `sessionDir`，界面单独提示这一例外。
- 设置编辑器用请求序号、作用域/工作区及草稿编辑版本保护异步读取；旧请求不会在切换工作区、切换作用域或输入期间覆盖当前草稿。

## 复现与回归

- 首个测试在实现前失败：缺失 `pi-settings-documents.js`；服务边界测试在实现前失败：`readPiSettings is not a function`；历史目录测试在修复前明确显示默认目录而非项目配置目录。
- `node node_modules/tsx/dist/cli.mjs --test packages/services/test/pi-settings-documents.test.ts`：8/8 通过。覆盖来源、未知字段、信任、外部改动、无效 JSON/UTF-8、锁和临时文件、真实 Host 接口及固定 Pi RPC 新会话读取保存的默认模型。
- 与会话监管、目录和原生 v4 回归串行运行：12/12 通过。
- `pnpm run typecheck`、定向 oxlint、`git diff --check` 通过。固定 Pi 进程正常退出；Windows `taskkill /T` 报出退出后的进程树诊断，检查所列 PID 无残留。
- 延迟 Promise 乱序测试 `node node_modules/tsx/dist/cli.mjs --test packages/ui/test/piSettingsReadGuard.test.ts`：2/2 通过，覆盖旧工作区/作用域响应晚到及编辑期间响应晚到。生产设置组件使用同一请求防护器。

## 尚未覆盖的 #10 验收边界

- 自定义 provider 的 `models.json` 与认证、API headers、动态目录等需结合 #7/#8 验证；该编辑器仅处理 `settings.json`。
- 当前会话模型、thinking 与默认值的联动表单、运行中设置重载、trust 决策写入、在线 provider/OAuth、NSIS/包内运行尚未由此切片证明。
- 已存在的坏 JSON 只能在外部修复后重载；本页故意不提供静默替换。未受 Pi `.lock` 协议约束的外部编辑器仍可能在最终版本比较之后同时写入，这是普通文件编辑的固有限制。
- 原生 GUI 冒烟 `node scripts/pi-settings-gui-smoke.mjs --output D:\Temp\pi-settings-gui4-20260927`：exit 0；报告 `D:\Temp\pi-settings-gui4-20260927\pi-settings-gui-report.json`。页面无异常；Pi 用户文件保存未知字段、外部修改冲突保留草稿、项目未信任提示及固定 Pi 0.87.0 RPC 经受控 loopback 模型返回 `PI_TEXT_COMPLETE` 全部可见。进程清理 `graceful=true`、`forced=[]`、`survivors=[]`。截图为同目录 `pi-settings-project.png` 和 `pi-settings-conflict.png`。
- 隔离 worktree 缺少 Electron 安装文件和 ZCode 存储准备 bundle，冒烟时只读调用主目录已安装 Electron，并把主目录已有的 ZCode 存储准备 bundle 复制到隔离目录；Pi 模型和进程仍由隔离 profile 的固定 0.87.0 启动。前两次 GUI 分别因这两项 fixture 依赖未就绪退出。第三次 GUI 的 Pi 进程因 `PI_PACKAGE_DIR` 多复制一层而缺 `dist/modes/interactive/theme/dark.json`；同 fixture 的直接启动 stderr 定位该路径。共享 fixture 修复已在主目录 `87a25b5`，此分支只交付新红测，整合时不要重复提交 fixture 修复。
- `node --test scripts/native-smoke/pi-package.test.mjs` 在旧 fixture 上因主题文件 ENOENT 失败，修复目录根后 1/1 通过。此测试依赖主目录 `87a25b5` 的已有修复。
