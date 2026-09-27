# 当前入口：继续完成剩余 Pi-first 范围，统一后再请用户验收

更新时间：2026-09-27。开始前读取 [产品目标](../product-goal.md)、[ADR 0001](../adr/0001-native-zcode-base.md)、[Pi-first 范围](pi-first-scope.md)、[完整开发计划](full-development.md)、[任务账本](tickets.json)、[复用清单](reuse-inventory.md) 和 [本次预览证据](pi-capability-preview-2026-09-27.md)，再核对 GitHub 最新 Issue/PR 与本地 Git 状态。

## 用户最新决定

- 用户不希望在功能尚未贯通时分批进行人工试用或逐票验收。
- 继续实施所有保留范围，完成统一、连贯的产品后，再提供一份完整测试清单并请求一次用户实际验收。
- 开发期间仍必须执行代理可完成的本地自动测试、受控真实 Pi、桌面宿主、包内启动和回归验证；“暂缓用户测试”不等于暂缓工程验证。
- 不得因用户暂缓验收而伪造 #34 或后续 Issue 的人工通过、关闭 Issue、合并 Draft PR 或正式发布。
- 缺少在线账号、OAuth 人工回调、真实 llama.cpp/GGUF 或安装权限时，明确记录待最终验收项，但继续所有不依赖这些条件的开发。

## 当前 Git 与交付状态

- 工作目录：`C:\Users\niilo\Desktop\pi-agent-gui`
- 分支：`issue-34-native-pi-rpc`
- 本轮未发送图片草稿源码提交：`77481f1`；文档 `4d115f0`；GitHub 校验重试修复 `de7b789`（初始 HEAD 为 `c483200`；旧图片/队列增量 `1337c33` 仅是更早历史）。接手时仍以 `git log -1`、`git status -sb` 和远程为准，不要 reset 到旧交接哈希。
- 远程：Draft PR #39 分支，核对 `origin/issue-34-native-pi-rpc` 的最新推送。
- Draft PR：[PR #39](https://github.com/axgiroud312-byte/pi-agent-gui/pull/39)，保持 OPEN / Draft。
- #34 保持 OPEN，等待最终统一用户验收；这不再阻止技术上继续后续保留范围，但不得把依赖票标记为完成。
- `origin/main@9db2da4` 的 Pi-first 范围基线已通过合并提交 `f41457e` 集成。
- 必须保留未跟踪 `%SystemDrive%/`、`用`，以及 `stash@{0}: scope-doc-copies-before-main-integration-2026-09-27`；禁止 reset/clean/强推或批量暂存未知文件。
- `packages/desktop/dist-pi-incremental/` 是锁住 app.asar 的失败中间物，`packages/desktop/dist/win-unpacked` 正由用户独立进程使用；本轮都未触碰。新包必须使用另一隔离目录。D: 上另有并行开发隔离 worktree，不能与主目录混写。

## 2026-09-27 持续开发快照（#5 第一纵向批次）

- 起始差距见 [remaining-gap-audit-2026-09-27.md](remaining-gap-audit-2026-09-27.md)。GitHub #1/#34/#3/#4/#5 与依赖票按最新正文评论核对；PR #39 仍 Draft，#34 OPEN，旧“#34 后暂停”文字不再适用。
- `77481f1` 修复已确认的未发送图片重启丢失：profile IndexedDB 存原始字节/哈希，localStorage 只存 scope 顺序索引；保存完成前同步阻止 Enter/Send；保存失败或单张损坏显示可移除的失败 chip；原生文件选择时先取不可变快照。Pi 仍是已发送消息与运行的权威，草稿存储不充当队列。
- 红测：原会话图片重启后丢失；延迟读图时 Enter 使纯文字独自发出；20 MiB 图片 base64 被 16 MiB JSONL 上限拒绝；两张 13 MiB 图越过单条总量限制。绿测：`D:/Temp/pi-agent-draft-corrupt-green2-20260927/pi-native-gui-report.json`，生产入口 Windows GUI + 固定 Pi + 受控本地模型，三次完整进程退出/重启；会话与新任务图文恢复、源图片修改后发出原字节、损坏一张保留另一张、无自动重发/页面错误/强制退出/残留。完整 Pi 顺序测试 120/120 PASS；typecheck PASS；lint 0 error/70 既有 warning；桌面 production build PASS；本地 delivery plan 与校验器 7 项测试 PASS。
- `node scripts/check-delivery-plan.mjs --github` 本轮先两次在 GitHub dependencies API 请求中收到 `EOF`（分别 #33、#32）；`de7b789` 为单次 API 传输 EOF 加有界重试与红绿测试后，已重跑 PASS：parent #1、30 child issues、45 blocking edges。校验器单测 7/7 PASS。
- 该提交仅完成 #5 首个故障及部分回归。仍需两项目两会话同名图片、粘贴/拖入、文字单侧存储失败、会话删除/项目移除后的图片生命周期、全局容量边界、首次发送期间新附件的 scope 迁移与打包 GUI 复测；#3/#4 的其它条件仍开放。旧 `D:/Temp/pi-agent-gui-preview-20260927-b/` 不含此提交，不能当最终包。
- 隔离并行：`D:/Temp/pi-agent-gui-queue-audit-20260927` 正做 #4 固定 Pi 兼容队列；`D:/Temp/pi-agent-gui-auth-audit-20260927` 正做 #6 同会话公开 bridge；`D:/Temp/pi-agent-gui-files-audit-20260927` 正做 #14 文件纵向批次。均不得直接写主目录；根代理整合、回归、提交和推送。
- #5 技术进度已写入 Issue 评论；Draft PR #39 已更新并保持 Draft。下一步继续 #5 剩余回归与修复，同时整合隔离 #4/#6/#14 的可验证提交，再按依赖推进其余票。不要请求分批用户试用。

## 已完成并验证

- #34 压缩错误保存、恢复续跑和证据语义收口：`04de955`、`ddbf196`。
- 图片 RPC、steer/follow-up、完整停止、模型/thinking/usage、compact、扩展阻塞对话：`06c0f88`。
- Pi 拥有草稿模型 readiness：`0b71ff0`。
- Pi 模型和资源命令 catalog 刷新：`f9b24c4`。
- Composer 资源面保持 Pi 范围并移除子 Agent 建议：`2856e28`、`8d42fb9`。
- 技术预览与 Standards/Spec 记录：`docs/delivery/pi-capability-preview-2026-09-27.md`。
- 最新 `node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 packages/services/test/pi-*.test.ts`：120/120 PASS（含新增图片聚合与 JSONL 20 MiB 传输回归）；并发全套测试曾在拥塞时超时，维持顺序验收。
- `pnpm run typecheck`、定向 oxlint：PASS。
- delivery plan、本地 6 项测试及 `--github`：PASS，17 active / 10 retired。
- 最新 desktop production build、Windows electron-builder、runtime dependency audit、170.6 MiB size audit：PASS；源码入口与隔离 unpacked GUI 图片/队列/Stop/历史恢复均已通过。
- 最终包内启动/恢复：PASS；无继承的 no-model 门禁、Skill catalog 错误或 Composer 子 Agent 区域。
- 本轮增量包（**不是最终统一试用包**）：`D:\Temp\pi-agent-gui-preview-20260927-b\win-unpacked\Pi Agent IDE Preview.exe`；NSIS：同目录 `Pi Agent IDE Preview-3.14.0-win-x64_TEST.exe`，尚未安装验证。原 `packages/desktop/dist/win-unpacked` 被用户独立运行的实例占用，**不要停止该进程或覆盖其目录**。C: 上的 `packages/desktop/dist-pi-incremental/` 是本轮失败的隔离打包中间物，未暂存；D: 的隔离包成功。
- 全仓 `pnpm run build` 仍被嵌套 CLI debug 包的 esbuild host `0.28.2` / binary `0.25.12` 不匹配阻塞；桌面目标构建通过。

## 剩余范围

详细验收以 GitHub 最新正文为准，不能用以下摘要替代：

1. **#3/#4/#5**：图片选择经 GUI/固定 Pi 到模型、历史预览及未发送草稿重启已有局部实测；详见上节与 coverage。Pi 0.87 原队列事件/clear_queue **仅返回文本**，运行中图片入队仍拒绝并保留草稿，文本排队/Stop 取回只读可见。接着补两项目两会话、粘贴/拖入、草稿容量/生命周期/并发、在线模型证据、自动压缩/重试、队列附件无损取回/编辑/重排、上下文 shell 和布局恢复。不得将 fail-closed 限制算作 #4 完成。
2. **#6/#7/#8/#14**：版本化公开扩展 tree/bookmark/reload bridge；真实 Pi API key/OAuth 认证中心；扩展 UI 类别矩阵与 notify/status/widget；文件引用、预览、必要编辑保存完整验收。
3. **#9/#10/#11**：Pi 历史目录、分支/fork/clone、导入导出/主动分享；Pi 设置与自定义 provider 配置；llama.cpp router 管理。
4. **#12/#13/#25**：Skills/模板/上下文/扩展包管理与重载；扩展对话、状态、工具和生命周期；必要 GUI 等价交互与可见兼容限制。
5. **#26/#27**：中文 IME、键盘、焦点、滚动、长会话；Windows 保存恢复、诊断、安装/升级/卸载。
6. **#28**：所有保留能力的统一 Standards/Spec、真实链路、包内运行和最终本地验收，随后才交给用户实际测试。

#15–#24 仍为 `not_planned/wontfix`，不得恢复。不得新建 MCP、Plan、子 Agent 或调度系统；继承界面中超出范围且会误导用户的入口应隐藏或明确不可用，而不是连接旧执行引擎。

## 接手后第一步

1. 读取 GitHub #1、#34、当前批次 Issue 正文与评论，以及父规格和阻塞关系。
2. 检查 `git status -sb`、worktree、stash、当前 HEAD 和远程差异，保存新的恢复清单。
3. 从 [增量覆盖与限制](coverage.md) 和上方当前断点开始；未发送附件的首个重启丢失故障已经红绿实测，继续剩余边界和后续保留能力。不要重复 #34 基础调查，也不要把旧预览包当作最终交付。
4. 每批做聚焦提交和推送，更新 Draft PR/任务账本；不关闭需人工验收的 Issue。
5. 连续推进直到剩余范围全部实现或只剩确实需要用户账号/设备操作的阻塞，然后生成统一试用包、完整测试步骤和阻塞清单，停在一次最终用户验收。
