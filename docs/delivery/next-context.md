# 当前入口：继续完成剩余 Pi-first 范围，统一后再请用户验收

更新时间：2026-09-28。开始前读取 [产品目标](../product-goal.md)、[ADR 0001](../adr/0001-native-zcode-base.md)、[Pi-first 范围](pi-first-scope.md)、[完整开发计划](full-development.md)、[任务账本](tickets.json)、[复用清单](reuse-inventory.md) 和 [本次预览证据](pi-capability-preview-2026-09-27.md)，再核对 GitHub 最新 Issue/PR 与本地 Git 状态。

## 用户最新决定

- 用户不希望在功能尚未贯通时分批进行人工试用或逐票验收。
- 继续实施所有保留范围，完成统一、连贯的产品后，再提供一份完整测试清单并请求一次用户实际验收。
- 开发期间仍必须执行代理可完成的本地自动测试、受控真实 Pi、桌面宿主、包内启动和回归验证；“暂缓用户测试”不等于暂缓工程验证。
- 不得因用户暂缓验收而伪造 #34 或后续 Issue 的人工通过、关闭 Issue、合并 Draft PR 或正式发布。
- 缺少在线账号、OAuth 人工回调、真实 llama.cpp/GGUF 或安装权限时，明确记录待最终验收项，但继续所有不依赖这些条件的开发。

## 2026-09-28 07:24 继续开发断点（下方 07:06 等均为历史快照）

- 主目录 `issue-34-native-pi-rpc` 当前代码 HEAD `aa14fe4` 已普通推送；本文件、`coverage.md`、`native-ui-parity.md` 正在更新，实际 Git 状态优先。PR #39 Draft、需用户最终验收的 Issues OPEN；受保护未跟踪 `%SystemDrive%/`、`用`、锁住的 `packages/desktop/dist-pi-incremental/`、`stash@{0}`、用户旧 `packages/desktop/dist/win-unpacked` 均保持原状。
- 主树模型循环/首条扩展 Stop/首图 JSONL 的合并回归源码 GUI：`D:/Temp/pi-model-cycle-main-bd06de3-20260928/pi-model-cycle-gui-report.json`、`D:/Temp/pi-firstinput-stop-main-bd06de3-20260928/pi-extension-stop-gui-report.json`、`D:/Temp/pi-firstimage-jsonl-main-bd06de3-20260928/pi-extension-stop-gui-report.json`，全部固定 Pi 0.87.0、pageErrors=[]、graceful=true、forced=[]、survivors=[]；Pi first→second 下一真实请求、首条 Stop/重启不重播、首图模型与 Pi JSONL PNG SHA/MIME 同值分别通过。主树 `build:no-runtime-assets`、模型循环 2/2、首条 Stop 相关 40/40、typecheck 通过。
- #6/#12 `aeee0d4` Resources 和 `aa14fe4` Tree 会话归属修复已普通推送。先在隔离 GUI 红测 B 带出 A 未保存资源文本/旧书签闪现，再在固定 Pi GUI 绿测。主树定向固定 Pi/guard 9/9、typecheck、production build，以及 `D:/Temp/pi-resources-main-aa14fe4-20260928/pi-resources-gui-report.json` 的 `leakedEditor=0`/`leakedDraft=false`、`D:/Temp/pi-tree-main-aa14fe4-20260928/pi-tree-gui-report.json` 的 `sawOldSession=false` 通过；两者旧功能仍绿，页面错误/强杀/残留为零。新原生差异与 coverage 正在记账。
- 新 Standards/Spec 确定缺口：#11/P20 router cancel 遇 unload HTTP 503 会让原 load waitFor 继续至 10 分钟超时，且 GUI 旧 view 可能误导；独立代理已用 loopback 红测 9/10→修后 10/10，正在补固定 Pi GUI 503→刷新/重试与明确远端未知，未整合。#10/P31/P32/P34 用户可见 Pi 离线/版本检查启动偏好被 `appSettingsSchema` 丢弃、Host 没映射 Pi flags；另一隔离代理已红测，正在做固定 Pi 支持的最小映射和生效范围，未整合。#14/D04 编辑器保存 Promise 期间可继续输入 B，旧保存 ACK 无条件覆盖 B 并清持久草稿，切文件也可跨写；P0 丢草稿，第三隔离代理刚接手先写红测再修，未整合。**不要因为此前 D04 普通保存/冲突 GUI 绿而宣称保存竞态完成。**
- 最终仍须在这些修复后跑主树固定 Pi **全顺序**、typecheck、lint、production build、delivery 本地/7 测试/`--github` 与 Standards/Spec 复审；全新隔离 3.14.1 unpacked/NSIS、包内 GUI/进程清理、受控 3.14.0→3.14.1 升级/卸载均尚未做。隔离安装基线只读预检 `D:/Temp/pi-agent-gui-install-preflight-20260928.ps1` 已证 3.14.0、146 项无 reparse、owner 当前用户、注册路径匹配、Preview/安装目录进程 0；正式操作前必须带最终安装包再预检。真实 GGUF/router、现场 OAuth/动态 provider GUI 登录、物理 IME、实际 Gist、用户统一验收分别留界；仅全部可实施工作完成后给一次 5–15 分钟试用。

## 2026-09-28 07:06 继续开发断点（下方 06:54 等均为历史快照）

- 主目录 `issue-34-native-pi-rpc` 当前代码 HEAD `a0c7d0a` 已普通推送；本文件与 `coverage.md` 正在更新。主树仅受保护的未跟踪 `%SystemDrive%/`、`用`、锁住 `packages/desktop/dist-pi-incremental/` 应保留；`stash@{0}` 与用户旧 `packages/desktop/dist/win-unpacked` 不触碰。PR #39 仍 Draft，需用户最终验收的 Issues 仍 OPEN。
- #11 `ceb21e8` 修复同一 router 弹窗从会话 A 切到 B 的迟到 `/models` 覆盖：隔离真实 GUI `.../router-red3` 复现 A_STALE 错写，`D:/Temp/pi-agent-gui-router-session-isolation-20260928/test-results/router-green1/pi-llama-gui-report.json` 中 B 保持 B_CURRENT，固定 Pi 0.87.0+受控 loopback router 加载/推理/卸载 1/1/1，页面错误/强杀/残留为零。主树 guard 2/2、typecheck，通过普通推送；#11 技术评论已更新。真实 GGUF/llama.cpp 仍缺。
- #3/#4/#13/#25 `a0c7d0a` 将无预热首发从被扩展输入阻塞的 `createSession(firstInput)` 改为固定 Pi 空 session ACK→同一意图 `sendText`，使首条弹窗能订阅/Stop；失败/未知投递保留原指针与草稿，门禁禁止再次建 Pi session 自动重发。`D:/Temp/pi-extension-firstinput-final-20260928/pi-extension-stop-gui-report.json` 的原生 GUI 证实首条弹窗 Stop 后 composer 为空、下一精确模型消息在同一 Pi JSONL、重启不重播，两次清洁退出；主树相关 40/40、typecheck 通过。已有会话四类 Stop 见下方 06:54。`dbcc690` 的 `D:/Temp/pi-extension-firstimage-jsonl-final-20260928/pi-extension-stop-gui-report.json` 已增强并实际跑过首图 Pi JSONL 与模型请求原 PNG SHA/MIME 同值，页面错误/强杀/残留为零。
- #3 `b8a9861` 的 `cycle_model` 固定 Pi 双模型/单模型 `noop` 合同及原生 GUI 已先红后绿：`D:/Temp/pi-model-cycle-gui-red-20260928/pi-model-cycle-gui-report.json` 因缺入口失败；`D:/Temp/pi-model-cycle-gui-green-20260928/pi-model-cycle-gui-report.json` 证实菜单走 Pi RPC、first→second，下一真实 SSE 请求用 second，原生搜索/thinking/用量仍可用，页面错误/强杀/残留为零。主树 cherry 冲突已手工保留首条 Stop 的 pending ID，cycle target/ref 也绑定该 ID；固定 Pi 2/2、typecheck、脚本语法通过并普通推送。#6/#12 资源/树代理补入 `3de8356` Host 修复后真正红测：B 带出 A 的未保存资源文本，B 树短暂闪现 A 书签；正做会话归属修复。首条 PNG JSONL 增强 GUI 已绿，报告见上一条。
- 最终整合后必须跑主树固定 Pi **全顺序**、typecheck、lint、production build、delivery 本地/7 测试/`--github`、Standards/Spec 审查；之后全新隔离 3.14.1 unpacked/NSIS、包内 GUI/进程清理、受控 3.14.0→3.14.1 升级/卸载。现均未完成，不得把源码 GUI/旧基线冒充。现场 OAuth/动态 provider GUI 登录、真实 GGUF/router、物理 IME、实际 Gist 与用户统一验收独立列界。只在全部可实施工作后给一次 5–15 分钟试用。

## 2026-09-28 06:54 继续开发断点（下方 06:15 等均为历史快照）

- 主目录 `issue-34-native-pi-rpc` 当前源码 HEAD `3de8356` 已普通推送到 origin，PR #39 仍 Draft，需用户验收的 Issue 仍 OPEN。本文件及 `coverage.md`、`native-ui-parity.md` 正在更新，提交前以 `git status` 为准；受保护未跟踪 `%SystemDrive%/`、`用`、锁住的 `packages/desktop/dist-pi-incremental/`，以及 `stash@{0}` 与用户仍在使用的旧 `packages/desktop/dist/win-unpacked` 均不可清理或覆盖。
- #4 `d8d61db` 的 `D:/Temp/pi-queue-handled-gui-20260928-c/pi-extension-input-transform-gui-report.json` 证实 handled PNG 保留 MIME/SHA、立即处理、两条 Pi 队列为 0、下一请求与 Stop 正常；#3/#4/#13/#25 `61f83b3` 的固定 Pi 10/10 和 `D:/Temp/pi-extension-stop-gui-green5-20260928/pi-extension-stop-gui-report.json` 证实已有会话 select/confirm/input/editor 各自 Stop、后续推理、重启同 Pi JSONL 无重播、无页面错误/强杀/残留。首条 `createSession(firstInput)` 扩展等待在 `D:/Temp/pi-extension-firstinput-red-20260928/pi-extension-stop-gui-report.json` 仍红，隔离代理正在用空 Pi session ACK 后同一发送意图的修复做固定 Pi/GUI 红绿；**不将已有会话结果冒充首条通过**。
- #9/#10 `8761dc4`、`7fe7724`、`972f06c`、`7848bcf` 的自定义 `sessionDir` 固定 Pi 优先级、重启原 JSONL 原字节前缀与再次模型推理合同通过。Host production bundle 曾把 `storage-startup` 子路径外部化，隔离产物红测发生 `ERR_MODULE_NOT_FOUND`；`3de8356` 显式 bundling 后主树 `build:no-runtime-assets` 和产物测试 1/1 通过。完整原生 GUI `D:/Temp/pi-custom-session-dir-gui-20260928-g/pi-custom-session-dir-gui-report.json` 绿：CLI 冷/热会话发现、项目自定义路径的新 Pi JSONL、公开 CLI 同 ID、重启同文件续写、页面错误/强杀/残留为零。
- #26/#27 `d17c6ca` 把不支持的主动分享提示改成产品名，UI 测试先红后绿 1/1，typecheck/lint 通过。隔离代理另在 `D:/Temp/pi-agent-gui-model-cycle-20260928` 做 #3 Pi 权威 `cycle_model` 的固定 Pi/GUI 红绿；`D:/Temp/pi-agent-gui-router-session-isolation-20260928` 做 #11 router 异步 A→B 会话跨写以及 #6/#12 resources/tree 同类隔离，二者尚未整合。GUI 桌面测试依次占槽，不能并行操作共享桌面。
- 当前主树最终固定 Pi **全顺序**、typecheck、lint、production build、delivery 本地/7 测试/`--github`、Standards/Spec 最终审查仍须在新代码整合后重跑。最终源码对应的全新隔离 3.14.1 unpacked/NSIS 包、包内 GUI/进程清理、实际受控 3.14.0→3.14.1 升级/卸载也尚未做；旧基线与源码 GUI 不能代替。真实 GGUF/router、现场 OAuth/动态 provider 登录、物理 IME、真实 Gist、人工统一验收分别记录边界。下一步先收三条隔离修复的固定 Pi/GUI/审查证据，聚焦整合并推送，再做最终主树回归与打包安装；仅最后给一次 5–15 分钟用户试用。

## 2026-09-28 06:15 继续开发断点（下方 05:38 等均为历史快照）

- 主目录 `issue-34-native-pi-rpc` 当前 HEAD `7160d0f`，普通远程推送仍到 `af4749d`，随后应推送本批。PR #39 Draft、需人工验收的 Issue OPEN。主树无已知跟踪文件改动；未跟踪 `%SystemDrive%/`、`用`、锁定的 `packages/desktop/dist-pi-incremental/`、`stash@{0}` 和用户旧 `packages/desktop/dist/win-unpacked` 原样保护。实际 Git 状态优先于本行。
- #7 `1250163`、`87b77df`、`93aea27` 已整合：同一 Pi RPC 子进程只读动态 provider 元数据，动作前精确原始 ID 重查，忙/不可用/截断 fail-closed，设置页返回时重读真实目录。主分支认证固定 Pi 11/11、typecheck、源码 build、`D:/Temp/pi-auth-extension-main-93aea27-20260928/pi-auth-extension-gui-report.json` 原生 GUI PASS。已有 OAuth 的实际在线 `openai-codex/gpt-5.5` GUI `D:/Temp/pi-online-provider-main-93aea27-20260928/pi-online-provider-gui-report.json` PASS，隔离凭据副本删除；现场登录/人工回调及动态扩展 provider GUI 登录仍未证/无公开接口。#7 技术评论已更新。
- #13 P23 `50f3a52` 同名 `read` 扩展结果修复已整合：固定 Pi/投影 11/11、UI 4/4、typecheck，主分支 GUI `D:/Temp/pi-read-override-main-93aea27-20260928/pi-read-override-gui-report.json` 证明扩展工具真实执行、内建文件未读、原生结果折叠可展开，页面/进程清理正常；#13 技术评论已更新。#27 `8b47391` 精确修补 NSIS 无 PowerShell 时的同名进程回退和单进程计数/路径边界，主树真实 makensis 合同 14/14；正式最终包/升级/卸载还未运行。
- 独立 Standards 审查发现 #4 `sendQueuedNow` 遇 Pi 已处理的扩展输入时误留 pendingIntent；`a36584a` 已主树 fixed Pi 队列 3/3 验证 Pi 权威取走、重启可继续。又发现 `follow_up`/`steer` 被 Pi input handler 立即处理会返回成功但无 queue item ID；`7160d0f` 明确 ACK `delivery=startNow`、renderer 终态收口，固定 Pi queue/guide/PNG 原始 SHA 与重启合同、主树队列 3/3/UI 1/1 PASS。两者源码原生 GUI 仍等隔离桌面时段，不将合同测试冒充 GUI。
- `docs/delivery/coverage.md` 已有 P01–P34、D01–D06、V01–V12 的 52 行工程快照，用户验收列仍待签；`docs/product-goal.md`、`pi-first-scope.md`、`native-rebase-plan.md` 的旧 #34 后暂停文字已改为本次连续实施授权。#9/#10 自定义 Pi sessionDir 固定 Pi 合同绿，原生 GUI 第三次复跑中；#3/#4/#13 扩展等待 Stop 在隔离树已红绿 4/4 并发现模态弹窗缺 Stop 入口；两批待 GUI/提交/主树整合，任何失败按真实结果处理。
- 下一步：三隔离任务 GUI/提交/整合与主树相应复验，完成 coverage 最新增量/原生差异和本文件、Issue/PR 技术进度；最终主树固定 Pi **顺序全套**、typecheck、lint、build、delivery 本地/7 测试/`--github`；再用全新 `D:/Temp` 隔离目录打最终 3.14.1 unpacked+NSIS、跑 unpacked 与已安装包 GUI 和进程清理，预检诊断 3.14.0 基线后实际覆盖升级/卸载。真实 GGUF/router、现场 OAuth、物理 IME、真实 Gist 与用户最终验收分别记边界。完成全部可实施工作后仅给一次 5–15 分钟统一试用，不代签/关闭/合并/发布。

## 2026-09-28 05:38 继续开发断点（下方 05:00 等为历史快照）

- 主目录分支 `issue-34-native-pi-rpc`，实际 HEAD `1af76e7` 已普通推送；PR #39 Draft、需人工验收的 Issue OPEN。主树无已知跟踪文件改动；未跟踪 `%SystemDrive%/`、`用`、锁住的 `packages/desktop/dist-pi-incremental/`、`stash@{0}` 和用户旧 `packages/desktop/dist/win-unpacked` 仍须保护。接手先以实时 Git 状态为准。
- #3/#9 P14 `4d2b80b` 主树固定 Pi/纯合同 4/4、typecheck、源码 build、原生 GUI `D:/Temp/pi-context-inspector-main-4d2b80b-20260928/pi-context-gui-report.json` PASS；原始历史、当前有效消息、context edits、压缩前空摘要明确区分，页面错误/强杀/残留为零。`get_messages` 是 Pi 当前会话投影，不等于逐次 provider 请求快照。Issue #3/#9 已作技术评论并普通推送。
- #13 P24 `2d01dc7` 与可靠书签 `1af76e7`、#12 P29 `72eae71` 已主树合入、普通推送。固定 Pi 补丁 `pnpm install --offline --frozen-lockfile --ignore-scripts` 重装验证，实包 0.87.0 的 `rpc-mode.js` 含 Pi 权威 `disposition/effectiveTextHash`。主树定向 Pi 11/11 加 admission/输入 20/20、typecheck、完整源码 build PASS。#13 GUI `D:/Temp/pi-input-transform-main-72eae71-20260928/pi-extension-input-transform-gui-report.json`：handled 无模型且继续可发、两会话不同 PNG 原字节与变换文字分别入 Pi JSONL/模型、reload 生效；#12 GUI `D:/Temp/pi-npm-package-update-main-72eae71-20260928/pi-npm-package-update-gui-report.json`：本机 npm registry 1.0.0→1.1.0、实际模板推理、重复更新无重载、卸载。均 `pageErrors=[]`、正常退出、无强杀/残留。#12/#13 技术评论已更新。Git ref 更新未跑：固定 Pi 更新自管 clone 会用用户禁用的 `reset --hard`/`clean`；本机 registry 不冒充公共 npm/在线账号。
- #7 动态扩展 provider 安全只读目录已在隔离提交 `11bf361` + `d8e1885`：同一 Pi RPC 子进程公开 ModelRegistry 元数据，不重复执行扩展 factory；登录动作强制重查，忙/不可用/截断拒绝；固定 Pi 14/14、typecheck/lint/build 通过。隔离 GUI 的认证/动态目录均通过，但最新完整脚本后段 `/pi-ui-sequence` 在 Pi control inspect 中存在、Lexical slash 菜单却显示无匹配并禁用发送，**完整 GUI 仍红**，代理定位中；不可报 #7 全绿。固定 Pi 0.87.0 无扩展动态 provider GUI 登录/登出公开接口，Pi CLI `/login` 为明确边界。
- #13 代理在隔离树继续 P23 同名 `read` 工具覆盖固定 Pi/GUI 代表样例；真实 Pi 红绿已证明覆盖工具实际执行且内建 read 未读取哨兵，待提交/GUI。#27 安装器只读预审发现 electron-builder 同名进程 `taskkill /IM` 回退可能结束旧用户 unpacked；隔离代理正在用红绿 makensis 合同补精确构建期拒绝/路径边界，绝不运行正式安装器或触碰旧目录。诊断 3.14.0 安装基线仍在 `D:/Temp/pi-agent-gui-installer-20260928-a/diagnostic-install-3`，升级前重查无 junction/同名进程；最终源码包、包内 GUI、升级与卸载尚未做。
- 下一步：审查并 cherry-pick #7 两提交及其 GUI 诊断修复、#13 P23、#27 安装器安全补丁；主树固定 Pi 全顺序、typecheck、lint、delivery local/7 tests/`--github` 与相应原生 GUI；最终 Standards/Spec、coverage P01–P34/D01–D06/V01–V12 逐行审查；**新隔离输出目录**完整 Windows unpacked+NSIS、包内 GUI、预检后的诊断基线覆盖升级/卸载；更新 Issue/PR、推送后只请求一次 5–15 分钟统一用户验收。旧全套 223/228 已由聚焦修复和隔离 224/224 加主树删除 4/4 补足，最终主树整套仍须重跑。

## 2026-09-28 05:00 继续开发断点（下方 04:25 等均为历史快照）

- 主目录 `issue-34-native-pi-rpc` 截至代码 HEAD `d625cba`，普通推送已到 `e83956d`；本文件及 `coverage.md` 正在更新，随后应聚焦提交并普通推送。主目录只应有这两份跟踪文档的本次改动和受保护未跟踪 `%SystemDrive%/`、`用`、锁住的 `packages/desktop/dist-pi-incremental/`；`stash@{0}` 与用户独立运行的旧 `packages/desktop/dist/win-unpacked` 绝不清理、覆盖或结束。PR #39 Draft、需人工验收的 Issue OPEN。
- #9 `d92ef45` CLI JSONL 热发现和 `1b73705` Pi `--no-session` 临时会话已合入、推送并在主分支真实原生 GUI PASS：`D:/Temp/pi-cli-live-history-main-1b73705-20260928/pi-session-search-gui-report.json`（运行中 CLI 两份新增历史，模型请求 0）与 `D:/Temp/pi-temporary-session-main-1b73705-20260928/pi-temporary-session-gui-report.json`（一轮真实 Pi 回复、JSONL 0、重启不恢复）。两者 `pageErrors=[]`、正常退出、无强杀/残留；定向固定 Pi/Host 5/5、typecheck、完整源码 build PASS。#9 技术评论已更新，PR #39 正文至 `1b73705`。临时会话未发送草稿仍按原规则保存，无法使用依赖 JSONL 的续接/fork/clone/导出/分享。
- #26 `6450e23`、`d625cba` 增补长历史 Chromium 实际键盘到帧测量和两 Pi 会话交错。最终主分支 GUI `D:/Temp/pi-long-scroll-two-sessions-main-e83956d-20260928/pi-long-scroll-gui-report.json` PASS：24 回合、120 行 bash、24 帧、10 次 keydown→第二帧 p95 10.5ms，首会话 19 帧续流中第二会话独立回答、切回无重放，页面/进程清理干净。`D:/Temp/pi-ime-main-b76d7f8-20260928/pi-ime-gui-report.json` 的两视口/明暗合成 IME 绿；原版 archive 同视口深色滚动对照 `D:/Temp/pi-original-scroll-main-comparison-20260928/original-native-scroll-report.json` 绿。物理输入法/完整同状态视觉和最终包内仍缺。#26 技术评论已更新但早于双会话新增结果。
- #27 `e83956d` 已整合、推送：隔离真实 makensis 红测证实旧升级清单可穿 junction 删除外部哨兵，修复后安装根/直接/嵌套 junction 拒绝且普通文件清理，主分支 NSIS 合同连同 known-folder 补丁 9/9。#27 技术评论已更新。诊断 3.14.0 基线仍实际安装于 `D:/Temp/pi-agent-gui-installer-20260928-a/diagnostic-install-3`，HKCU Preview 3.14.0 注册；**最终源码尚未独立打 3.14.1 包、包内 GUI、覆盖升级或卸载**。不得使用用户旧 dist 目录。
- 独立 P14 #3/#9 有效上下文/原始历史/context edits/摘要检查器在 `D:/Temp/pi-agent-gui-context-inspector-20260928`，隔离固定 Pi 服务/typecheck/build 与 GUI `D:/Temp/pi-context-inspector-gui-20260928-c/pi-context-gui-report.json` 已 PASS，聚焦提交 SHA 待代理回报再 cherry-pick；前两次 GUI 失败均是隔离 runtime asset/测试扩展后缀夹具，不冒充功能故障。#7 动态启动扩展 provider 认证曾发现重复运行扩展 factory 的危险候选，已放弃未提交；代理继续核对同一 Pi 子进程可公开支持的安全边界。独立 Standards 预审指出 #13 P24 input transform 代表扩展与 GUI 缺证、#12 真实 npm/Git 更新仍缺；待反馈后持续推进。
- 固定 Pi 0.87.0 主树顺序全套**首次**为 223/228（日志 `D:/Temp/pi-agent-gui-pi-suite-main-20260928.log`）；5 项定向问题已在 `415003e`/`0e44cad` 修正，独立代理除删除用例外顺序 224/224 PASS，主树删除 4/4 PASS，但整合后**主树最终全套仍未跑**。`node scripts/check-delivery-plan.mjs`、其 7/7 测试与 `--github` 在 `1b73705` 后 PASS；增量后最终重跑。下一步：P14/安全 #7/#13 增量整合与主树 GUI；完整 Pi 顺序/typecheck/lint/build/delivery；隔离最终 Windows unpacked+NSIS、包内 GUI、实际基线→升级→卸载；coverage P01–P34/D01–D06/V01–V12 状态回填和最终 Standards/Spec 复审；Issue/PR 技术进度、普通推送和一次 5–15 分钟统一用户试用。在线账号人工 OAuth、真实 GGUF/router、物理中文 IME 分别标边界，不冒充验收。

## 2026-09-28 04:25 继续开发断点（下方 03:40 等为历史快照）

- 主目录分支 `issue-34-native-pi-rpc`，当前 HEAD `ad4323b`；`415003e` 已普通推送到 origin，之后新提交 `ad4323b` 待下次普通推送。主目录只有本文件待提交；未跟踪 `%SystemDrive%/`、`用`、锁定的 `packages/desktop/dist-pi-incremental/`、`stash@{0}` 和用户正在运行的旧 `packages/desktop/dist/win-unpacked` 原样保护，绝不清理、覆盖或结束用户进程。PR #39 仍 Draft，Issue OPEN。旧 `installer.nsh` 两行 A/B 实验已恢复，未纳入提交。
- #4 已整合 `b4693fc` 私有队列图片缓存保守 GC 和 `0715953` 逐文件删除前再核 Pi revision/运行状态；`415003e` 把旧删除测试改为明确先回收无引用图片、再重建缓存核对确认删除。`pi-queue-media-store.test.ts` 6/6、`pi-session-delete.test.ts` 4/4。主分支源码原生 GUI `D:/Temp/pi-queue-main-415003e-20260928-b/pi-queue-gui-report.json` PASS：双队列、含图片重复文本、重排、Stop、立即发送、撤回编辑、重启恢复、禁止过早删副本、准确图片 SHA 发送、ACK 后仍留备份；`pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`。受控离线模型不算在线 provider。旧测试脚本因新 Pi 首会话选模目录改版，已由 `ad4323b` 更新 23 个脚本，均 `node --check` 通过；包内尚待跑。
- #7 `f44a5d1` 使首会话前的模型选择直接读取同一固定 Pi `ModelRuntime` 目录，认证变化后刷新；固定 Pi 认证测试 9/9、typecheck/定向 lint PASS。在线原生 GUI `D:/Temp/pi-online-provider-gui-main-20260928-d/pi-online-provider-gui-report.json` PASS：用户已有 `openai-codex/gpt-5.5` OAuth 的隔离副本经 Pi 自身本机代理发出真实请求，回复标记在 GUI 可见，Pi JSONL `stop` 且输出 15 tokens，`pageErrors=[]`、进程零残留，finally 删除凭据副本。失败的前三轮 a/b/c 分别是首会话无目录及隔离网络代理未配置，均清理完毕；在线登录/人工回调/登出和动态扩展 provider OAuth **未**据此验收。#3 用量费用未知仍显示 tokens/cache 修复 `06c2365` 已纯测 1/1、typecheck，最终 GUI/包内待证。
- #12 `99dfad0` 的同身份 user/project 包更新防跨作用域保护已主分支固定 Pi 9/9 与源码原生 GUI `D:/Temp/pi-package-scope-main-f5a17e5-20260928-b/pi-package-update-scope-gui-report.json` PASS：两行均警告且更新按钮禁用，未调用更新；真实 npm/Git ref 更新尚未执行。#27 `f5a17e5` 的仓库级 NSIS `multiUser.nsh` 精确补丁已整合，隔离代理 static 5/5、typecheck/lint、3.14.1 unpacked+NSIS 构建通过；原因是 electron-builder 上游对 `SHGetKnownFolderPath` 返回指针的 `System::Call` 解引用在本机 `System.dll` 崩溃。诊断 3.14.0 在隔离目标 `D:/Temp/pi-agent-gui-installer-20260928-a/diagnostic-install-3` 实际安装成功、HKCU Preview 3.14.0 仍登记；最终源码的 3.14.1 包还没有安装、覆盖升级或卸载，旧用户目录不能作为目标。
- 固定 Pi 0.87.0 顺序全套主分支初跑日志 `D:/Temp/pi-agent-gui-pi-suite-main-20260928.log` 为 223/228 PASS。第 5 项 `pi-session-delete` 是新 GC 后旧断言，已在 `415003e` 通过 4/4。另 4 项 `pi-control-bridge`、`pi-durable-admission`、`pi-extension-fail-closed`、`pi-history-edit-retry-fixed` 由独立代理在 `D:/Temp/pi-agent-gui-fixed-pi-regression-20260928` 精准复现、修复和全套顺序复验中，尚未 cherry-pick；不要把 223/228 写成最终通过。主分支 typecheck、源码 `build:no-runtime-assets` PASS，最终全仓 lint、完整 build、delivery plan 本地/测试/`--github` 待新提交后重跑。
- 隔离代理 `D:/Temp/pi-agent-gui-cli-history-20260928` 正补 #9 GUI 运行后新 CLI JSONL 热发现；`D:/Temp/pi-agent-gui-temporary-session-20260928` 正补 #9 GUI 临时 `--no-session`，已固定 Pi 合同 1/1 且无 JSONL，正在跑原生 GUI；两者完成后按 SHA 逐项 cherry-pick。#3/#9 P14 有效上下文/原始历史/context edits 的只读区分尚需实现；#26 长历史输入/滚动延迟与原版同状态对照仍缺。接下来依次整合代理提交、固定 Pi 全顺序/原生 GUI、P14 与其他审查缺口、隔离最终包内 GUI/实际 NSIS 升级卸载、coverage 总表 P01–P34/D01–D06/V01–V12、最终 Standards/Spec 审查、Issue/PR 技术更新和统一 5–15 分钟用户试用。没有用户验收前不关票、不合并 Draft PR、不发布。

## 2026-09-28 03:40 继续开发断点（下方 03:25 等均为历史快照）

- 主目录仍为 `issue-34-native-pi-rpc`；HEAD `d1cd064`，较 origin 领先 12 个聚焦提交。`d581cc1` 是独立 Standards 复审后 #4 红绿修复：Pi 撤回失败 `stale/noop/rejected` ACK 保留唯一原图文副本；多图 IndexedDB 写入前先持久索引，第二张失败时清理可找到第一张；未发送恢复草稿在输入框内时阻止手工删除唯一图片副本。纯合同 14/14、typecheck、lint 0 error/69 既有 warning、delivery local/7 tests/`--github` PASS；`d581cc1` 的主分支完整桌面 build 已通过，但 `d1cd064` 后须重建并跑 `scripts/pi-queue-gui-smoke.mjs` 新增的原生 GUI 过早删除断言。新增在线 GUI 脚本 `scripts/pi-online-provider-gui-smoke.mjs` 尚未跑/提交；仅复制用户现有 `openai-codex` OAuth 到隔离 fixture，`finally` 删除副本，仍须实际确认在线结果与凭据清理。保护项与用户旧 unpacked 目录同前，不清理。
- #12 独立代理已在 `D:/Temp/pi-agent-gui-package-scope-20260928` 以固定 Pi 合同证明同身份双作用域必须在 `manager.update` 前拒绝，离线 Host 合同及纯测/typecheck/lint 通过；隔离 GUI 正跑，commit 尚待 cherry-pick 和主分支回归。不可声称任一作用域已被单独更新。
- 后续 Standards 复审又找到 #4 已恢复图文再次 `sendText` 时的 ACK/落盘竞态：Pi `accepted` 可能只代表内存 queue 或尚未持久化的 JSONL。`d1cd064` 已以红测复现“ACK 不能退休唯一图片副本”，现在明确没有 Pi 持久记录凭据时一直保留备份，手工删除前提示核对历史；纯合同 14/14、typecheck PASS，GUI 新断言待最终 build/运行。复审还发现 `queue-media` 文件在会话存续期间不能逐项回收；隔离代理正在做 cold-session 的安全 GC 红绿，绝不按 Pi 快照消失直接删除仍被 renderer 草稿引用的原图。
- #27 新 A/B 3.14.0 NSIS 打包 `D:/Temp/pi-agent-gui-installer-20260928-a/baseline-artifacts/Pi Agent IDE Preview-3.14.0-win-x64_TEST.exe` 构建/依赖/大小检查成功；在全新 `D:/Temp/pi-agent-gui-installer-20260928-a/baseline-c` 用 `/S /currentuser /LOG=... /D=...` 实际安装仍 exit `-1073741819`，日志只有 `installer-process-started role=outer`。去掉自定义日志的两处 `GetCurrentProcessId` 不是根因。隔离 `installer_audit` 代理现独占基线 worktree 给 electron-builder `.onInit` 加无 `System::Call` 阶段标记并重打诊断包，定位 upstream `System.dll` 崩溃；主目录 `packages/desktop/build/installer.nsh` 的 2 行实验差异仍未提交。无成功安装、覆盖升级或卸载证据。
- 下一步：等两个代理隔离 GUI/诊断报告；整合 #12；主分支固定 Pi 顺序、原生 GUI 队列及在线 provider、最终 typecheck/lint/build/delivery；修复安装器并隔离打 3.14.1 final unpacked+NSIS，包内 GUI、实际 baseline→upgrade→uninstall；最终 Standards/Spec、coverage、Issue/PR、普通推送与统一用户试用。若又中断，继续从此处的未决命令与证据，不回退到历史 HEAD。

## 2026-09-28 03:25 继续开发断点（下方 02:35 等均为历史快照）

- 主目录仍是 `issue-34-native-pi-rpc`；实际 HEAD `18aded7`，较普通推送的 `0ba885e` 领先 10 个聚焦提交。最近整合 #9 历史文件快照重试、#7 认证目录错误恢复、#4 带图队列撤回的 Pi item/index/ref 授权读取与 IndexedDB 持久副本/删除意图/原图 SHA、#9 重复及非当前分支图片 fork 与纯图片草稿、#12 包更新无操作反馈。主目录暂时未提交的已知工作仅 `packages/desktop/build/installer.nsh` 的 NSIS 日志实验和 `scripts/pi-online-provider-gui-smoke.mjs` 的在线 GUI 回归脚本；其余未跟踪 `%SystemDrive%/`、`用`、锁住的 `packages/desktop/dist-pi-incremental/` 与 `stash@{0}` 一律保护，旧 `packages/desktop/dist/win-unpacked` 不覆盖、不结束用户进程。Draft PR #39 与需用户验收的 Issue 保持 OPEN/Draft。
- #4/#9 主分支纯合同 23/23、typecheck、全仓 lint 0 error/69 既有 warning，delivery plan 本地/7 项测试/`--github`（#1、30 child、45 edges）通过。#4 隔离固定 Pi 合同和原生 GUI `D:/Temp/pi-queue-withdrawal-gui-20260928-a/pi-queue-gui-report.json` 通过：Pi 带图队列项撤回→重启→原字节恢复→显式发送→备份退休，三轮无页面错误或残留。主分支整合后固定 Pi 全顺序和 GUI、最终包内仍待跑。#4 后续删除意图与 SHA 合同已在主分支 22/22；确认冷 Pi JSONL 删除后的恢复副本清理由 `PI_SESSION_NOT_FOUND` 精确判别，损坏/目录错误保留副本。
- #9 `D:/Temp/pi-image-only-fork-gui-20260928-a/pi-fork-clone-gui-report.json` 隔离真实 Pi 0.87.0 原生 GUI 通过混合与纯图片 fork、重启、显式发送相同 SHA，进程无残留；固定 Pi 合同 2/2。Pi 0.87.0 在目标父链尚无 assistant 时不会立即写 child JSONL，Host 在调用 fork 前准确拒绝，不伪造子会话。#7 隔离认证 GUI `D:/Temp/pi-auth-recovery-gui-20260928-b/pi-auth-extension-gui-report.json` 通过；真实在线 `openai-codex/gpt-5.5` Pi CLI `--print --no-session --no-tools --no-extensions --no-skills --no-prompt-templates --no-context-files` 最小请求返回 `PI_ONLINE_OK`，但原生 GUI 在线路径尚待运行。真实 GGUF/router、物理 IME、人工 OAuth 回调仍各自独立待证。
- #12 `06bedc0` 已合入；隔离固定 Pi 5/5 和 GUI `D:/Temp/pi-resources-update-gui-20260928-a/pi-resources-gui-report.json` 验证离线/固定 npm 版本不再假报更新。独立只读 Standards 审查又发现同一包同时配置 user/project 时 Pi `DefaultPackageManager.update(source)` 会跨作用域更新；隔离代理 `package_scope_fix` 正做红绿与准确确认/拒绝，不运行会触发固定 Pi 上游 `git reset --hard` / `git clean` 的 Git 更新。
- #27 旧隔离 3.14.0 NSIS `D:/Temp/pi-agent-gui-preview-20260927-b/Pi Agent IDE Preview-3.14.0-win-x64_TEST.exe` 实际 `/S /D=<fresh D:/Temp>` 两次 exit `-1073741819`，Windows Application Error 1000 指 `System.dll` `c0000005` offset `0x1581`，日志只到 `installer-process-started role=outer`，无有效安装/注册。主目录和独立 `D:/Temp/pi-agent-gui-installer-baseline-src-20260928`（HEAD `7751924`、3.14.0）仅去掉 NSIS 安装/卸载日志里的两次 `System::Call GetCurrentProcessId` 作为 A/B 实验；不能先断言根因。基线 `pnpm install --offline --frozen-lockfile --ignore-scripts`、`prepare:runtime-assets`、完整桌面 build PASS；新隔离打包正在 `D:/Temp/pi-agent-gui-installer-20260928-a/baseline-artifacts`，日志 `baseline-bundle.log`。若新 3.14.0 安装通过，最终 3.14.1 再做隔离覆盖升级/卸载；安装前核对 Preview GUID `80bf6343-335e-520b-9a4e-1e9ae3d1d275` 的 HKCU/HKLM 4 键与无旧用户进程。独立 installer_audit 正只读审查。
- 下一步：等基线 bundle 完成后在全新 D:/Temp 目标 A/B 安装；审查 #12 作用域修复并整合；主分支固定 Pi 0.87.0 全顺序、源码原生 GUI、在线 GUI、最终完整 build/typecheck/lint/delivery、隔离 3.14.1 unpacked/NSIS、包内 GUI 与进程清理、实际覆盖升级/卸载；最终 Standards/Spec 复审、coverage P01–P34/D01–D06/V01–V12、Issue 技术评论/PR #39/普通推送和一次 5–15 分钟统一用户试用。任何受控模型/在线 provider/包内/安装/用户验收均单独列结果。

## 2026-09-28 02:35 最新断点（下方 02:26 为历史快照）

- 主目录 `issue-34-native-pi-rpc` HEAD `ad02452`，较已推送的 `75318d5` 领先 12 个提交，均为聚焦源码/账本提交；本次 `coverage.md` 与本文件的新证据尚待提交及普通推送。保护未跟踪 `%SystemDrive%/`、`用`、锁定 `packages/desktop/dist-pi-incremental/`、`stash@{0}` 和用户正在用的旧 `packages/desktop/dist/win-unpacked`；不覆盖、不清理、不强制结束。Draft PR #39 与需用户验收的 Issue 均 OPEN，不合并、不代签。
- #9 `a2be2b9` 已 cherry-pick 成 `ad02452`；`coverage.md` 和 `reuse-inventory.md` 冲突人工保留两侧段落，无遗留 conflict marker，`git diff --check` 通过。主目录固定 Pi/纯合同 `pi-history-edit-retry-fixed.test.ts` + `pi-history-entry.test.ts` 5/5，typecheck、定向 lint 0 error/0 warning、完整 `pnpm --dir packages/desktop build`（日志 `D:/Temp/pi-agent-gui-main-build-ad02452.log`）与 delivery plan 本地校验 PASS。退出时 Pi 固定测试 `taskkill /T` 报非强制 status 128，对应 PID 60352/40296 随后只读复查均不存在；不将其当包内清理证据。
- 主目录完整构建后的固定 Pi 0.87.0 原生 GUI `D:/Temp/pi-history-edit-retry-main-20260928-a/pi-history-edit-retry-gui-report.json` PASS：历史重试在同一 Pi JSONL，旧前缀原字节不变；编辑只回填草稿，显式发送后才有新请求；`pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`。推理是受控 loopback provider，尚非在线 provider 或包内 GUI。
- 并行隔离树：`D:/Temp/pi-agent-gui-history-edit-20260928` 的代理正在修 #4 图片队列撤回编辑的 ACK 切会话/新草稿/重启丢失，并补 #9 文件快照重试合同；`D:/Temp/pi-agent-gui-image-fork-20260928` 的代理修 #9 图片 fork；`D:/Temp/pi-agent-gui-auth-bridge-20260928` 的代理核对并推进 #6–#8 认证/公开桥。各目录单一源码写入者，固定 Pi/GUI 时段必须串行。主目录只有根代理写。
- 下一步：这批先提交账本、普通推送、更新 Draft PR #39 及 #3/#9/#10/#25 技术评论；随后整合 #4/#9 图片 fork/#6–#8 可用提交，顺序跑主目录固定 Pi 与原生 GUI。最终仍需固定 Pi 完整顺序、typecheck/lint、delivery plan 本地/测试/`--github`、Standards/Spec 最终复审、隔离 Windows unpacked + NSIS、包内 GUI/进程清理、实际安装/覆盖升级/卸载和统一用户试用。在线 provider、真实 GGUF/router、物理中文 IME 和人工 OAuth 回调各自单列，不用受控 fixture 冒充。

## 2026-09-28 02:26 最新断点（02:18 与更早章节为历史快照）

- 主分支 `issue-34-native-pi-rpc` 代码 HEAD `2dac7d1`，相比已推送 `75318d5` 领先 10 个源码提交：#25 `1c78fd6`、#10 `ecd801b`、#3 `802c8e2`/`3708feb`/`046da9b`/`5b2891b`/`ac39e4b`/`b6f431c`/`28b4871`、#4/#9 队列缓存删除 `2dac7d1`。本文件与 `coverage.md`、扩展兼容表的文字更正未提交。仅受保护未跟踪 `%SystemDrive%/`、`用`、锁定 `packages/desktop/dist-pi-incremental/`；`stash@{0}` 和用户正在使用的旧 unpacked 未动。PR #39 Draft，Issues OPEN，未代签用户验收。
- #3 隔离固定 Pi 原生 GUI `D:/Temp/pi-model-thinking-gui-20260928-e/pi-model-thinking-gui-report.json` PASS：完整搜索、reasoning 模型选定后 Pi thinking levels `off/minimal/low/medium/high`、Ctrl+T 到 minimal 且下一请求 `reasoning_effort=minimal`，无页面错误/强制清理/残留。主分支服务 22/22、UI 4/4、typecheck、lint 0 error/69 既有 warning及 `pnpm --dir packages/desktop build` PASS。选模后目录未刷新的红测与修复在 `b6f431c`；完整 build 的 bootstrap `piExtensionUi` 初始化修复在 `046da9b`。
- 独立只读 Standards/Spec 审查在 `1c78fd6` 查出 #4 两项确定丢输入风险：撤回编辑先删除 Pi 队列项，ACK 后若切会话/出现新草稿，原图文无法恢复；即使当时恢复，图片只在 Zustand 内存，没有 IndexedDB 持久副本，重启后丢失。#9 编辑/重试代理已接手隔离红绿修复，当前不得称 #4 无损取回完成。另一个发现是 `queue-media` 图片副本无删除清理：主分支 `pi-session-delete.test.ts` 先红后绿，`2dac7d1` 在确认删除冷 Pi JSONL 前清理同 session 的自有缓存，保留其他会话；3/3、定向 lint、typecheck PASS。编辑草稿仍引用的缓存不能在队列项消失时直接清理，后续须结合 #4 持久草稿修复确定 GC 点。
- #9 隔离历史编辑/重试固定 Pi 0.87.0 合同与原生 GUI `D:/Temp/pi-history-edit-retry-gui-20260928-a/pi-history-edit-retry-gui-report.json` 已 PASS：重试原 JSONL 图片，旧分支不改；编辑仅预填，再由用户发送；页面错误/强制清理/残留均空。聚焦提交 `a2be2b9` 尚未 cherry-pick；fork 图片仍显式拒绝，需独立无损实现。独立只读审查还更正 #25 分享文案：旧公共投影拒富结果，而 Pi Gist 会在用户完整预览确认后发布，兼容表文字已修正未提交。
- 下一步：先完成 #4 取回编辑两项红绿与桌面回归，再整合 #9 `a2be2b9` 和后续 #4 提交；主分支跑 #3/#10/#25/#9 GUI、固定 Pi 全套顺序、delivery 校验及最终 Standards/Spec。新隔离 Windows unpacked+NSIS、包内 GUI/退出、实际安装/覆盖升级/卸载、在线 provider、真实 GGUF/router、物理 IME 和用户统一验收仍分别未完成。当前 `D:/Temp` 的隔离证据不能充作最终 HEAD 的包内结果。

## 2026-09-28 02:18 继续开发断点（下方 01:36 为历史快照）

- 主目录 `issue-34-native-pi-rpc` 已普通推送到 `75318d5`；#4/#9/#13/#26/#27 技术评论和 Draft PR #39 正文已按该版本更新。此后聚焦整合 `1c78fd6`（#25 富扩展工具结果）及 `ecd801b`（#10 设置来源与并发冲突），目前较 origin 领先两个源码提交，本节文档正在提交，尚需后续普通推送和 #10/#25 Issue/PR 更新。仅受保护的 `%SystemDrive%/`、`用`、锁定 `packages/desktop/dist-pi-incremental/` 未跟踪；`stash@{0}` 和用户正在运行的旧 `packages/desktop/dist/win-unpacked` 未动。#34、其它需人工验收的 Issue 均 OPEN，PR #39 保持 Draft。
- #25 隔离树 `b99501d` 的固定 Pi 0.87.0 新合同 1/1、代表扩展 4/4 与原生 GUI `D:/Temp/pi-rich-tool-gui-20260928-c/pi-rich-tool-gui-report.json` PASS：Pi 真实工具返回有序图文和 details，模型收到 PNG，GUI DOM 解码图片；`pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`。最终单张截图只拍到展开的详情，不能单独证明三者同屏。主分支 cherry-pick 为 `1c78fd6`，纯投影 9/9、UI 3/3、typecheck、lint 0 error/69 既有 warning、delivery plan 本地 PASS；主分支整合 GUI 和包内仍待跑。
- #10 隔离树 `89e610c` 的定向 13/13、`build:bootstrap` 和原生 GUI `D:/Temp/pi-settings-scope-gui-20260928-b/pi-settings-gui-report.json` PASS：固定 Pi RPC、来源/未知字段/并发冲突/不受信项目均观察到，页面无异常、退出无残留。首轮隔离树缺 Electron binary，经复制现有 gitignored 运行资产后重跑通过；两条非强制 tree-cleanup 日志所指 PID 复查不存在。主分支 cherry-pick `ecd801b`，新增纯测试 3/3、typecheck PASS；主分支整合 GUI 和包内待跑。
- #3 隔离树已定位真实缺陷：选择 reasoning 模型后 Pi JSONL 已切模，但 Host 没有刷新 `readPiModelCatalog`/thinking levels/原生 config，菜单仍只有 `off`。代理先写服务红测，再修复并在当前独占桌面时段用固定 Pi GUI 复验；尚未整合。#9 历史编辑/重试在另一个隔离树做 Pi 公开树与无损图片合同，未整合。另有独立只读 Standards/Spec reviewer 在隔离工作树审查当前增量，不代替最终 HEAD 审查。
- 下一步：等 #3 完成并释放桌面后，顺序整合及复验 #3、#9，再跑当前主分支 #10/#25/#9/#27 的 GUI 与固定 Pi 全套顺序。最终隔离构建 Windows unpacked+NSIS、包内 GUI/进程清理、实际安装覆盖升级卸载、同状态原版对照和 Standards/Spec 复审均未完成。在线 provider、人工 OAuth、实际 GGUF/router、物理 IME 与用户统一验收各自单列，不能互相冒充。`node scripts/check-delivery-plan.mjs --github` 与 7 项测试在 `75318d5` 已 PASS，新增提交后最终仍需重跑。

## 2026-09-28 01:36 继续开发断点（优先于下方历史快照）

- 主目录分支 `issue-34-native-pi-rpc` HEAD `9d664fa`，尚领先 origin 5 个提交：`200a51c` #9 导入导出主动分享、`9bfbaf2`/`8be4045` #27 隐私诊断、`29a1a9d` #13/#26 扩展命令后原生输入恢复、`9d664fa` #4 自动超窗压缩 Stop 测试。Draft PR #39、#34 及需用户验收的 Issue 均保持 OPEN；此轮提交尚需普通推送和技术进度评论。主目录仅 `docs/delivery/coverage.md` 与本文件正在更新；受保护未跟踪 `%SystemDrive%/`、`用`、锁定 `packages/desktop/dist-pi-incremental/`、`stash@{0}`、用户正在使用的旧 `packages/desktop/dist/win-unpacked` 都未动。
- 合并后首次原生 GUI `node scripts/pi-dialog-focus-gui-smoke.mjs --output D:/Temp/pi-dialog-focus-main-integrated-20260928` **红色**：固定 Pi 扩展命令完成后 composer `contenteditable=false`，回退模型按钮，截图出现 `Pi history does not contain a completed assistant turn`。假 Pi 红测 `node node_modules/tsx/dist/cli.mjs --test --test-name-pattern="acknowledged Pi extension command" packages/services/test/pi-admission-reconciliation.test.ts` 复现原生投影 `error`。`29a1a9d` 在确认 Pi `handledCommand` 后清 pending intent 并重投影；同一测试绿，生产源码入口 GUI `D:/Temp/pi-dialog-focus-main-fixed-20260928/pi-dialog-focus-gui-report.json` 绿：弹窗焦点、四类交互、composer 可编辑且获焦、同一 Pi 会话后续模型推理；`pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`。
- #4 `node scripts/pi-auto-compact-stop-gui-smoke.mjs --output D:/Temp/pi-auto-compact-main-20260928` 绿：固定 Pi 0.87.0 第三轮 400 超窗后真实请求 held 摘要，Stop 取消，无迟到 retry，历史保留；`pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`。同轮 admission+auto 顺序测试 18/18、`pnpm run typecheck`、`pnpm run lint`（0 error/69 既有 warning）、`pnpm --dir packages/desktop run build:no-runtime-assets` 通过。固定 Pi 合同清理日志偶有非强制 `taskkill /T` status 128；GUI 进程报告无强制清理或残留。受控 loopback 模型不算在线 provider。
- #9 隔离精确源码 GUI `D:/Temp/pi-agent-gui-fork-clone-20260927/test-results/native-parity/product/pi-session-transfer-gui-report.json` 已绿，整合源码的 #9/#27 GUI、最终包内与真实 Gist 仍待独立验证。#27 隔离固定 Pi GUI `D:/Temp/pi-diagnostics-gui-20260928-b/pi-diagnostics-gui-report.json` 已绿，主目录定向测试 4/4、typecheck/lint/build 通过。#3 隔离树 `D:/Temp/pi-agent-gui-model-thinking-20260928` 提交 `de9492b`/`d7fa095`，搜索、null 用量与累计费用静态红绿已过，当前独占桌面做 GUI；#10 新隔离树 `D:/Temp/pi-agent-gui-settings-scope-20260928` 做来源与并发保存；#25 新隔离树 `D:/Temp/pi-agent-gui-extension-validation-20260928` 做自定义工具多模态和隐私。各目录仅一名源码写入者，尚未整合这三树。
- 下一步：完成本账本和 coverage 校验，普通推送及更新 #4/#9/#13/#26/#27 技术进度和 Draft PR #39；顺序给 #3/#10/#25 固定 Pi GUI 时段并在提交后 cherry-pick 主目录；逐项继续 #3–#14/#25–#28 未完成能力。最终仍要主分支固定 Pi 全套顺序、`check-delivery-plan` 本地/测试/`--github`、原生 GUI、隔离 Windows unpacked+NSIS 包内 GUI/进程、实际安装升级卸载和 Standards/Spec 总审查。在线账号/OAuth 人工回调、真实 GGUF/router、用户统一验收若无条件则单列，不代签、不关闭 Issue、不合并 PR、不正式发布。

## 2026-09-28 01:11 历史断点（以下为当时快照）

- 主目录 `issue-34-native-pi-rpc` HEAD `b641c68` 已普通推送至 origin，PR #39 保持 OPEN/Draft，Issues 未代签人工验收。`48ab69e` 修复固定 Pi 已注册扩展斜杠命令无 Agent 回合后误闭锁会话：仅在同一 Pi `get_commands` 证实来源为 extension 且 Pi `prompt` 已 ACK 时收口；未知无回合仍闭锁，命令图片在投递前拒绝，独立扩展错误保留。先红后绿的假 Pi 合同 17/17，固定 Pi 0.87.0 扩展顺序 6/6 PASS，typecheck 与定向 oxlint PASS。`e2df2e8` 整合 #26 原生弹窗焦点（隔离 GUI `D:/Temp/pi-dialog-focus-gui-20260928-n/pi-dialog-focus-gui-report.json` PASS，旧基线 `noRun` 时回退到可用模型按钮）；主分支集成后的可编辑 composer 焦点与后续模型推理已加到 `scripts/pi-dialog-focus-gui-smoke.mjs`，**尚未跑 GUI**。`b641c68` 抽出 Pi 行 diff 后全仓 lint 恢复 0 error / 69 既有 warning；消息行纯测试 8/8、typecheck PASS。上述三提交均已普通推送。
- #4 自动溢出压缩 Stop 新增 `packages/services/test/pi-auto-compaction-stop-fixed.test.ts`，固定 Pi 0.87.0 + 受控 400 上下文错误 + held summary 实测 1/1 PASS：Stop 后无迟到 retry、无成功 compaction entry、3 条用户输入仍在 Pi 历史。相应 `scripts/native-smoke/pi-model.mjs` 和 `scripts/pi-auto-compact-stop-gui-smoke.mjs` 在主目录未提交；脚本 `node --check` 与 `git diff --check` 已过，原生 GUI 未跑。固定 Pi 测试退出时 `taskkill /T` 非强制请求曾报 status 128，但随后按命令行复查 Pi/test PID 无残留；不能把该日志当成包内 GUI 进程清理证据。
- #9 导入/导出/主动分享在隔离树 `D:/Temp/pi-agent-gui-fork-clone-20260927`，固定 Pi 合同已过，首轮 GUI 暴露导入后 Pi `get_state.model` 有模型而原生 Composer 空选；代理正修 Pi 快照→目录→原生选择状态并重跑 GUI，当前独占桌面。分享预览需显示固定 Pi HTML 内嵌完整会话数据且不执行 HTML 脚本，用户明确确认后才创建 secret Gist；未实际向远端发布。#27 隐私诊断隔离提交 `3b1293a` 已有纯测 4/4、typecheck/lint/delivery PASS，GUI 待 #9 释放后跑；未整合。#3 新隔离树 `D:/Temp/pi-agent-gui-model-thinking-20260928` 正做模型搜索、thinking/usage 红绿切片，不占 GUI。各隔离目录保持单写者，主目录只由根代理写。
- 主目录除上述未提交 #4 GUI/测试、`scripts/pi-dialog-focus-gui-smoke.mjs` 的集成断言和本账本外，受保护未跟踪 `%SystemDrive%/`、`用`、`packages/desktop/dist-pi-incremental/`、`stash@{0}` 原样保留；用户运行中的旧 `packages/desktop/dist/win-unpacked` 不得结束或覆盖。新包只能使用隔离输出。下一步：#9 GUI 收口、#27 GUI、主目录 #13/#26 集成焦点 GUI 与 #4 自动压缩 GUI；逐项整合 #9/#27/#3，完整 Pi 顺序/typecheck/lint/delivery 本地+测试+--github、最终隔离 unpacked/NSIS 包内 GUI 与安装升级卸载仍待做。离线受控模型、在线 provider、真实 GGUF/router、实际安装、用户验收须独立记录。

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
