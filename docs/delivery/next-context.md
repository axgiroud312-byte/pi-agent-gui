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
- 2026-09-27 19:59（Asia/Shanghai）已推送 HEAD `46c3e73`；初始 HEAD `c483200`，旧图片/队列增量 `1337c33` 仅是更早历史。接手仍须以 `git log -1`、`git status -sb` 和远程为准，不要 reset 到旧交接哈希。
- 远程：Draft PR #39 分支，核对 `origin/issue-34-native-pi-rpc` 的最新推送。
- Draft PR：[PR #39](https://github.com/axgiroud312-byte/pi-agent-gui/pull/39)，保持 OPEN / Draft。
- #34 保持 OPEN，等待最终统一用户验收；这不再阻止技术上继续后续保留范围，但不得把依赖票标记为完成。
- `origin/main@9db2da4` 的 Pi-first 范围基线已通过合并提交 `f41457e` 集成。
- 必须保留未跟踪 `%SystemDrive%/`、`用`，以及 `stash@{0}: scope-doc-copies-before-main-integration-2026-09-27`；禁止 reset/clean/强推或批量暂存未知文件。
- `packages/desktop/dist-pi-incremental/` 是锁住 app.asar 的失败中间物，`packages/desktop/dist/win-unpacked` 正由用户独立进程使用；本轮都未触碰。新包必须使用另一隔离目录。D: 上另有并行开发隔离 worktree，不能与主目录混写。

## 2026-09-27 20:22 继续开发断点（优先于下方 19:59 快照）

- 主目录最新代码提交 `87a25b5`（#5 快速关窗可见文本快照及 GUI 回归脚本）和 `995077a`（#4 队列烟测更新）；本节写入时尚待文档提交与普通推送，接手须核对实际 HEAD/远程。仅保护的未跟踪 `%SystemDrive%/`、`用`、`packages/desktop/dist-pi-incremental/` 应继续原样保留。
- `node scripts/pi-native-gui-smoke.mjs --output D:/Temp/pi-agent-integrated-postsnapshot-20260927` 已在当前源码生产入口完整通过：`pi-native-gui-report.json` 的 `error=null`、根草稿恢复和原字节发送均为 true、两项目同名图 `restoredAndSentDistinctBytes=true`、`pageErrors=[]`；三轮 `graceful=true`、`forced=[]`、`survivors=[]`，私有 Pi 包清理通过。此证据包括 #4 队列、#14 文件保存冲突与布局恢复；受控模型不等于在线 provider，尚非最终 Windows 包。
- #7/#8 隔离分支 `D:/Temp/pi-agent-gui-auth-ui-20260927` 有 `06c1aaf` + `57a81de`。第一次认证 GUI 的合成 API key 真正保存后显示 `committed-sync-failed`；固定 Pi 红测定位到服务书签保留已关闭会话，认证同步误读该会话。修复后真实 Pi 2/2 通过，活跃会话桥缺失仍失败闭锁；**尚需隔离 GUI 重跑，之后才可主目录整合**。#8 扩展输入 GUI 尚未走完，因为此前被认证步骤阻断。
- #10 隔离分支 `D:/Temp/pi-agent-gui-settings-20260927` 提交顺序为 `bb3cc83`、`a52651a`，`af4c578` 是主目录已有 lockfile 修复副本，不再 cherry-pick。GUI 第三次报告 `D:/Temp/pi-settings-gui3-20260927/pi-settings-gui-report.json`：设置页真实读取/保存未知字段、外部并发修改冲突保留草稿、未信任项目提示通过，进程 `graceful=true`、无强杀/残留/页面异常；末尾固定 Pi 新会话发送 `createSession:pi.commandFailed`，整次仍失败，隔离代理继续查启动原因，GUI 脚本待提交。
- #11 隔离分支 `D:/Temp/pi-agent-gui-router-20260927` 已提交 `032240d`，固定 Pi + HTTP/SSE mock router 顺序 15/15、类型检查、lint、交付计划和 GitHub 校验通过；**尚需 cherry-pick 及独占原生 GUI**。本机没有发现 `llama-server`/GGUF，真实模型仍未验。#12 已在新的隔离 worktree 开始；#5 草稿生命周期也在独立 worktree 开始，均不得写主目录。
- 下一步：先更新 #5 技术评论与 Draft PR、推送当前主分支；桌面时段先给 #7/#8 修后 GUI，再给 #10 修后 GUI，随后 #11。通过的隔离提交逐批审查并整合；主分支完整 Pi 顺序测试、typecheck、lint、delivery 本地/测试/`--github`、包内 GUI 仍需在后续集成后重跑。继续 #3/#4/#5/#9–#14/#25–#28，不请求分批人工试用。

## 2026-09-27 19:59 集成断点（覆盖下方旧队列只读叙述）

- 主分支已整合 #6 `66e1763`、#14 `8910b33`、#4 固定 Pi 双队列 `af924d4`/`9a317c9`/`c9d4123`/`daf9860`、队列 GUI 测试 `4aac4b2`、Pi patch 锁文件 `0b6d3a1`、#9 CLI 历史发现 `46c3e73`，并已普通推送到 Draft PR #39。所有任务和 PR 保持 OPEN/Draft，未代签用户验收。
- #5 集成 GUI `D:/Temp/pi-agent-integrated-green8-20260927/pi-native-gui-report.json` 为绿：选择/粘贴/拖入，两个项目同名未发送图片跨重启后分别把正确原字节送入固定 Pi；两会话、文件草稿和布局恢复也通过。失败命令与定位：`green4` 在快速关窗后 Root 图片/文本偶发未恢复；`green5` 第二项目文字未持久化、图已恢复（测试脚本焦点/时序）；`green6` 文件编辑保存异步检查过早；`green7` 预览已开启时再次点同一文件把预览关掉。已修测试脚本焦点、保存等待、预览开关逻辑，`green8` 全程 PASS。另将 `ConversationComposer` 关窗快照改为直接读取可见 Lexical Markdown，**当前生产构建中的 #5 修复尚需重跑集成 GUI**；不要将绿色 `green8` 误报为该新增改动的回归。
- #4 原生 GUI `D:/Temp/pi-queue-gui-main-20260927/pi-queue-gui-report.json` PASS：同文不同图 Pi ID、两条 lane 的取回/编辑/重排/立即发送、Stop 保留、resume 真正执行、重启不重放而保留恢复副本；两轮 `graceful=true`、`forced=[]`、`survivors=[]`、`pageErrors=[]`。固定 Pi 0.87.0 内同进程公开扩展补齐 ID/revision/image 权威队列；旧版 `queue_update`/`clear_queue` 只返回文本的限制仍属历史协议事实，不再代表当前 GUI 能力。完整 #4 shell/retry/compaction/扩展 Stop 矩阵仍未做完。
- #9 隔离 GUI `D:/Temp/pi-cli-history-gui3-20260927/pi-cli-history-gui-report.json` PASS CLI→GUI→CLI 同一 Pi JSONL；主分支整合后 GUI 尚待再跑。#14 的保存冲突及重启草稿已随 `green8` 实测；#6 公开 bridge 的独立 Pi/GUI 通过，主分支专项 GUI 待跑。
- 当前主目录**未提交**只包含 `packages/ui/src/v4/ConversationComposer.tsx`、`scripts/native-smoke/pi-{image,package,queue}.mjs`、`scripts/pi-native-gui-smoke.mjs`；保护的未跟踪 `%SystemDrive%/`、`用`、`packages/desktop/dist-pi-incremental/` 未触碰。最近类型检查、lint（0 error / 70 既有 warning）、`pnpm run build:bootstrap`、#4/#9 定向测试 5/5 PASS；完整 Pi 顺序与 delivery GitHub 校验待后续整合后再跑。
- 并行隔离：`D:/Temp/pi-agent-gui-auth-ui-20260927` 的 #7/#8 `06c1aaf` 已提交、正在独占桌面 GUI；`D:/Temp/pi-agent-gui-settings-20260927` 的 #10 正待 GUI；#11 router 在另一个隔离 worktree 实施。它们都不直接写主目录。#7/#8 GUI 结束后，先审查并 cherry-pick，安排 #10 GUI，然后继续 #3/#5/#9 等剩余批次。不要停在任一 Issue 请求用户试用。

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

1. **#3/#4/#5**：选择/粘贴/拖入图片、两项目同名图及两会话的固定 Pi GUI 回归见上方新证据。#4 通过 Pi 同进程公开扩展得到带图文的真实双队列，取回/编辑/重排/立即发送/Stop/恢复已做一组原生 GUI 实测；仍须补其它运行状态 Stop、带/不带上下文 shell、retry/compaction、草稿存储生命周期/并发、在线模型、当前源码包内回归。原始 Pi RPC 仅返文本是协议边界，不再作为当前 GUI 的能力结论。
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
