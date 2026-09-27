# 当前入口：继续完成剩余 Pi-first 范围，统一后再请用户验收

更新时间：2026-09-28。开始前读取 [产品目标](../product-goal.md)、[ADR 0001](../adr/0001-native-zcode-base.md)、[Pi-first 范围](pi-first-scope.md)、[完整开发计划](full-development.md)、[任务账本](tickets.json)、[复用清单](reuse-inventory.md) 和 [本次预览证据](pi-capability-preview-2026-09-27.md)，再核对 GitHub 最新 Issue/PR 与本地 Git 状态。

## 用户最新决定

- 用户不希望在功能尚未贯通时分批进行人工试用或逐票验收。
- 继续实施所有保留范围，完成统一、连贯的产品后，再提供一份完整测试清单并请求一次用户实际验收。
- 开发期间仍必须执行代理可完成的本地自动测试、受控真实 Pi、桌面宿主、包内启动和回归验证；“暂缓用户测试”不等于暂缓工程验证。
- 不得因用户暂缓验收而伪造 #34 或后续 Issue 的人工通过、关闭 Issue、合并 Draft PR 或正式发布。
- 缺少在线账号、OAuth 人工回调、真实 llama.cpp/GGUF 或安装权限时，明确记录待最终验收项，但继续所有不依赖这些条件的开发。

## 2026-09-28 00:05 继续开发断点（优先于下方历史快照）

- 主目录 `issue-34-native-pi-rpc` HEAD `7fe92bb` 已普通推送到 origin，Draft PR #39 保持 OPEN/Draft，#34 及能力 Issue 均未代签验收。`b41a48c` 是 #4 手动压缩 Stop；`7fe92bb` 是 #26 内层长工具输出滚动修复。#4 原生 GUI `D:/Temp/pi-manual-compact-main-20260927/pi-manual-compact-gui-report.json`、#26 隔离最终源码 GUI `D:/Temp/pi-long-scroll-gui-20260927-e/pi-long-scroll-gui-report.json` 均 PASS，Pi 0.87.0、离线受控模型与进程清理分开记录。#26 cherry-pick 后主目录滚动定向测试 2/2 PASS；完整主分支 Pi 顺序、typecheck/lint/delivery 尚需在更多整合后重跑。
- 主目录当前未提交：`scripts/native-smoke/pi-model.mjs` 增加可控首 N 次 503，仅供 #4 retry Stop GUI；未跟踪 `packages/services/test/pi-retry-stop-fixed.test.ts`、`scripts/pi-retry-stop-gui-smoke.mjs` 是待运行的真实 Pi/GUI 回归脚本。脚本语法及 diff --check 已通过，固定 Pi 与 GUI 因桌面时隙尚未运行。`docs/delivery/next-context.md` 是本次账本改动。主目录另外仅有受保护的 `%SystemDrive%/`、`用`、`packages/desktop/dist-pi-incremental/` 未跟踪，`stash@{0}` 未触碰；旧 `packages/desktop/dist/win-unpacked` 用户进程仍不可结束/覆盖。
- #9 fork/clone 隔离树 `D:/Temp/pi-agent-gui-fork-clone-20260927`：固定 Pi 合同 1/1、build:bootstrap、typecheck、lint 已 PASS；原生 GUI 已证实真实 fork 与不改源 JSONL，随后发现切子会话时 Pi 返回的原输入被草稿恢复覆盖，代理已写红测并修复中。当前桌面时隙由 #9 独占。#14 `D:/Temp/pi-agent-gui-files-20260927` 已证实文件引用/预览 GUI，但又红测发现引用 snapshot 尾注泄入会话标题并修复、增加缺失引用反馈；完整固定 Pi/exact-source GUI 待 #9 释放桌面后重跑，再给主目录 #4 retry Stop GUI。#26 焦点/快捷键下一切片仍在隔离树，先红测发现模态弹窗时 Ctrl+M 穿透，尚未完成 GUI。
- 三个代理只在各自隔离 worktree 写源码，主目录仅根代理写。后续审查聚焦 SHA 后逐项整合；继续 #3/#4/#9–#14/#25–#28 和 #27 隔离打包/安装，最后只给一次统一用户试用，不因任一票或缺账号停下。

## 2026-09-28 00:22 主目录最新断点（优先于下方 00:05 快照）

- 主目录 HEAD `82eb531`，已普通推送到 origin；Draft PR #39 仍 OPEN/Draft，Issues 保持 OPEN。近期新增：#26 模态快捷键 `29d6e9c`（主分支 UI tsconfig 定向 1/1 PASS）、#9 真实 fork/clone `a528e4f` + 子草稿修复 `c1a45a1`（主分支草稿 5/5 PASS，隔离 GUI `D:/Temp/pi-fork-clone-gui-20260928-c/pi-fork-clone-gui-report.json` PASS）、#4 自动 retry Stop 合同 `9086a34`（固定 Pi 1/1 PASS，主分支桌面 build PASS，GUI `D:/Temp/pi-retry-stop-main-20260928-a/pi-retry-stop-gui-report.json` PASS）、#14 文件引用/预览与拒绝草稿回滚 `82eb531`（隔离固定 Pi 1/1、最终 GUI `D:/Temp/pi-file-reference-gui-20260928-h/pi-file-reference-gui-report.json` PASS，主分支纯测试 8/8 PASS）。离线受控模型不是在线 provider；包内/安装/用户验收仍独立待做。
- `82eb531` cherry-pick 与 #9 的 `pi-native-v4-service.ts` catch 分支唯一冲突已人工合并：未知投递优先失败闭锁，其次保留文件引用结构化 reasonCode。整合后主分支完整 Pi 顺序、typecheck、lint、delivery 本地/测试/--github 和集成 GUI 尚未重跑，必须在最终包前做。
- 主目录当前未提交仅 `docs/delivery/{coverage,next-context}.md` 技术账本；受保护未跟踪 `%SystemDrive%/`、`用`、`packages/desktop/dist-pi-incremental/`、`stash@{0}` 原样保留，用户使用中的 `packages/desktop/dist/win-unpacked` 仍不可覆盖/结束。#26 下一弹窗焦点红测在隔离树独占 GUI；#9 导入/导出/用户主动分享在其隔离树做静态实现；#27 已从 `9086a34` 建新隔离树 `D:/Temp/pi-agent-gui-diagnostics-20260928` 做诊断/恢复，不占 GUI。完成各聚焦 SHA 后主目录审查整合。

## 2026-09-27 23:45 主目录继续开发断点（以下历史快照以此为准）

- 当前主目录 `issue-34-native-pi-rpc` 在此记录时 HEAD `b41a48c`；前一提交 `6dc84e7` 已普通推送至远程并更新 Draft PR #39，新提交尚待本批普通推送；PR 仍 Draft/Open，#34 仍 Open。再次接手先读实际 Git/远程，不把本行当永远不变的 HEAD。
- #4 真实 shell 主提交 `324a344` 与 GUI `D:/Temp/pi-shell-main-first-20260927/pi-shell-gui-report.json` 已通过：固定 Pi 0.87.0 的带/不带上下文差异、长命令 Stop、无进程残留。#13 `2485cf7`、#25 `7b5c8ce`、#9 冷会话删除 `a33a4a0` + `4d54ba4`、#26 IME `6dc84e7` 已整合。#9 最终隔离源码 GUI `D:/Temp/pi-session-delete-gui6-20260927/pi-session-delete-gui-report.json`、#26 最终隔离源码 GUI `D:/Temp/pi-ime-gui-20260927-d/pi-ime-gui-report.json` 均绿；主分支合并后 GUI 与最终包仍需重跑。
- #4 手动压缩 Stop 切片已在 `b41a48c` 聚焦提交；固定 Pi 延迟摘要取消与早到 Stop 的两项测试 2/2 PASS，services tsc、相关 lint、脚本语法检查 PASS；主分支桌面 production build 与压缩原生 GUI `D:/Temp/pi-manual-compact-main-20260927/pi-manual-compact-gui-report.json` PASS：Pi 0.87.0 摘要请求被 Stop 取消、前两轮历史保留、无后续重试或进程残留。主目录剩余未提交为 `packages/ui/src/TaskList.tsx` 删除一条 cherry-pick 遗留未使用 import，以及本 `next-context.md` 更新。旧的全 Pi 160/160 是这些整合前的证据，新全量回归尚未完成。
- 未跟踪 `%SystemDrive%/`、`用`、`packages/desktop/dist-pi-incremental/` 与 `stash@{0}` 必须原样保护；用户运行中的旧 `packages/desktop/dist/win-unpacked` 不得覆盖或结束。新 Windows 包仅用隔离输出目录。并行 #14 在 `D:/Temp/pi-agent-gui-files-20260927`，#26 后续滚动在 `D:/Temp/pi-agent-gui-ime-scroll-20260927`，#9 fork/clone 在 `D:/Temp/pi-agent-gui-fork-clone-20260927`，各自单写者；待聚焦 SHA 与 GUI 证据后由主目录逐项整合。
- Windows 进程工具偶发外部 `^C`（exit `-1073741510`）中断并行 typecheck/build/GUI；这不是代码断言失败。使用独占桌面时段、短 `yield_time_ms` + 轮询重跑；记录最终完整 PASS。当前不应把中断的全量 Pi 顺序测试计为通过。
- #14 隔离 GUI `D:/Temp/pi-file-reference-gui-20260927-e/pi-file-reference-gui-report.json` 验证文件引用、原字节、预览、重启与进程清理；随后发现侧栏标题泄露 Pi 文件 snapshot 尾注，隔离代理已用固定 Pi 红测复现并修复，尚需绿测、exact-source GUI 与提交，故 #14 暂不整合。#26 长输出滚动红绿测试和静态构建通过，GUI 正在隔离时隙；#9 fork/clone 固定 Pi 合同初绿，GUI 待时隙。
- 下一动作：`b41a48c` 与小型 UI 清理及本账本普通推送；审查/整合 #14/#26 后续/#9 fork/clone，跑主目录固定 Pi 顺序/typecheck/lint/delivery、本地 GUI、隔离 unpacked/NSIS 与包内 GUI。持续推进 #3/#4/#9–#14/#25–#28；只在全部可实施工作后交一次统一用户试用清单。

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

## 2026-09-27 21:19 继续开发断点（优先于下方历史快照）

- 主目录分支仍为 `issue-34-native-pi-rpc`，此断点 HEAD `197e853`，相对远程 ahead 12，尚未普通推送本批；`git status -sb` 中 `scripts/pi-resources-gui-smoke.mjs` 和本次交付文档有未提交改动，另有受保护的未跟踪 `%SystemDrive%/`、`用`、`packages/desktop/dist-pi-incremental/`。下一次操作先重新核对实际状态。`stash@{0}` 与用户运行的旧 unpacked 继续保护。
- #11 Pi 模型直接从目标固定 Pi 会话 `get_available_models` 投影到原生模型菜单，选择后的 `set_model` 仍由 Pi 判定；router 加载/卸载后刷新目录，切换模型后刷新当前 thinking 档位。主分支提交 `736ea53`；`D:/Temp/pi-llama-main-postresources-20260927/pi-llama-gui-report.json` 原生 GUI 的加载、Pi 推理、卸载各 1 次，`pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`。使用本地 HTTP/SSE router 合同；没有真实 GGUF 或在线 provider 证据。
- #5 草稿生命周期/单侧文字写失败/首次发送 scope 迁移合入 `b25afc5`、`0b237ee`；#9 Pi JSONL 重命名与原生搜索合入 `e729e5c`、`760232f`、`6532beb`，隔离原生 GUI 分别见 `D:/Temp/pi-session-rename-gui3-20260927/` 与 `D:/Temp/pi-session-search-gui2-20260927/`。#9 真实删除切片另在 `D:/Temp/pi-agent-gui-session-delete-20260927` 隔离 worktree 实施，主分支未包含。
- #12 固定 Pi 资源/包及公开 bridge 已合入 `1398a6a`，资源内容默认不进入树投影的隐私修复 `197e853` 已合入。冲突逐处保留了 #11 模型/router 操作及 #12 资源操作。主分支 `D:/Temp/pi-resources-main-integrated-green2-20260927/pi-resources-gui-report.json`：原生 GUI 模板编辑、重载 generation、停启、本地包安装/过滤/卸载全通过，`pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`。第一次 GUI `pi-resources-main-integrated-20260927` 仅测试脚本过早读取异步 generation 而红；修正等待后重跑绿，脚本修正仍待提交。
- 主分支本轮 `pnpm run typecheck` PASS；`pnpm run lint` 0 error / 70 既有 warning；固定 Pi 顺序测试 160/160 PASS（`D:/Temp/pi-integrated-sequential-20260927.log`）；#7/#11/#12 定向 7/7 PASS；#5 单侧存储测试指定 UI tsconfig 后 4/4 PASS；桌面 `build:no-runtime-assets` PASS；交付计划本地、7 项测试和 `--github` PASS。#5 完整原生 GUI `D:/Temp/pi-main-full-postresources-20260927/pi-native-gui-report.json` PASS：选择/粘贴/拖入、未发送原字节重启恢复、两项目同名图互不串、两会话与布局恢复、Pi 真实发送、Stop；`pageErrors=[]`、全部退出 `graceful=true`、`forced=[]`、`survivors=[]`。初次用根 tsconfig 跑 `composerDraftStoreFailure` 失败于 `@/logger.js` 路径别名；指定 `--tsconfig packages/ui/tsconfig.json` 后绿，不是产品故障。
- #7/#8 主分支独立原生 GUI `D:/Temp/pi-auth-main-integrated-20260927/pi-auth-extension-gui-report.json` 通过 API key 保存/隐藏/登出及 select/confirm/input/editor，页面错误与进程残留为零；#10 主分支 `D:/Temp/pi-settings-main-integrated-20260927/pi-settings-gui-report.json` 通过，仍非在线账号/OAuth 人工回调。#13 在 `D:/Temp/pi-agent-gui-extension-lifecycle-20260927`、#25 在 `D:/Temp/pi-agent-gui-extension-compat-20260927` 隔离 worktree，尚未合入。后续必须逐批审查、合入、测试、原生 GUI，并运行新隔离 Windows unpacked/NSIS 包及安装/升级/卸载。#34 和所有待人工验收 Issue 保持 OPEN，PR #39 保持 Draft。

## 2026-09-27 20:22 继续开发断点（优先于下方 19:59 快照）

- 主目录 #5/#4 增量 `87a25b5`（快速关窗可见文本快照及 GUI 回归脚本）、`995077a`（队列烟测更新）、文档 `660999f` 已普通推送；其后 #10 整合至 `b576b25`，当前文档改动尚待提交与普通推送。接手须核对实际 HEAD/远程。仅保护的未跟踪 `%SystemDrive%/`、`用`、`packages/desktop/dist-pi-incremental/` 应继续原样保留。
- `node scripts/pi-native-gui-smoke.mjs --output D:/Temp/pi-agent-integrated-postsnapshot-20260927` 已在当前源码生产入口完整通过：`pi-native-gui-report.json` 的 `error=null`、根草稿恢复和原字节发送均为 true、两项目同名图 `restoredAndSentDistinctBytes=true`、`pageErrors=[]`；三轮 `graceful=true`、`forced=[]`、`survivors=[]`，私有 Pi 包清理通过。此证据包括 #4 队列、#14 文件保存冲突与布局恢复；受控模型不等于在线 provider，尚非最终 Windows 包。
- #7/#8 隔离分支 `D:/Temp/pi-agent-gui-auth-ui-20260927` 有 `06c1aaf` + `57a81de`。第一次认证 GUI 的合成 API key 真正保存后显示 `committed-sync-failed`；固定 Pi 红测定位到服务书签保留已关闭会话，认证同步误读该会话。修复后真实 Pi 2/2 通过，活跃会话桥缺失仍失败闭锁；**尚需隔离 GUI 重跑，之后才可主目录整合**。#8 扩展输入 GUI 尚未走完，因为此前被认证步骤阻断。
- #10 的隔离 GUI 前三次中第三次虽通过设置页操作，末尾固定 Pi 新会话发送 `createSession:pi.commandFailed`；原因是旧测试 fixture 的 `PI_PACKAGE_DIR` 多嵌套一级、Pi 缺 `dist/modes/interactive/theme/dark.json`。主目录 `87a25b5` 已修包路径，红绿测试后第四次 `D:/Temp/pi-settings-gui4-20260927/pi-settings-gui-report.json` **整次 PASS**：未知字段保存、外部冲突保留草稿、未信任项目提示、固定 Pi 经 loopback provider 推理完成，`pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`。隔离提交 `bb3cc83`、`a52651a`、`ee45dcb` 已分别作为主分支 `9fc89ef`、`bd5d373`、`b576b25` 整合；`af4c578` 是已有 lockfile 修复副本，不要再 cherry-pick。整合后定向设置测试 10/10、Pi 包路径测试 1/1 PASS；主分支集成 GUI 尚待跑。
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
