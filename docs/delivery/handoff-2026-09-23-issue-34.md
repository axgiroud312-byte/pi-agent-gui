# #34 实时交接：原生 GUI → Pi，待最终验收

更新：2026-09-23（Asia/Shanghai）。权威验收以 GitHub #34 最新正文与评论为准；本文只记当前工作树和**实际取得**的证据。

## 用户最新边界与停点

用户要求保留 **ZCode 原生前端的布局、组件、交互、动态反馈、流式显示、工具卡、滚动、标签和分栏体验**，并非保留旧 Agent 内部架构。Pi 是消息、工具执行、会话历史、运行状态和队列的唯一事实来源；前端只保存必要展示/交互状态。当前低成本 v4 适配可以继续，但不能以兼容旧接口为由假报成功。**先完成并实际演示 #34；原 #34→其余全部任务的自动连续执行已暂停。** 84故事／52能力／20场景保留待确认，不删除、不自动实施、不宣称完成；不切换 SDK，不推倒已有成果。说明已同步 [产品目标](../product-goal.md)、[适配合同](issue-34-pi-adapter-contract.md)、[原计划暂停说明](full-development.md) 与 [新上下文入口](next-context.md)，并记录于 [#34 最新澄清评论](https://github.com/axgiroud312-byte/pi-agent-gui/issues/34#issuecomment-5788677011) 和 [父规格 #1 评论](https://github.com/axgiroud312-byte/pi-agent-gui/issues/1#issuecomment-5788679880)。

#33 原生界面关卡已确认并关闭。#34 **OPEN、尚无 PR/独立 Standards/Spec 审查/本分支 Windows CI/合并**；#1、#28 和后续实施票并未因为本阶段演示完成。领取评论：[Issue #34 领取记录](https://github.com/axgiroud312-byte/pi-agent-gui/issues/34#issuecomment-5787690336)；[最新本地实测回写](https://github.com/axgiroud312-byte/pi-agent-gui/issues/34#issuecomment-5788997840)。

## 只在现有工作树继续

- 路径：`C:\Users\niilo\AppData\Local\Temp\opencode\pi-native-pi-34`；分支 `issue-34-native-pi-rpc`，基于已合并 PR #38 的 `4e6cf6ad8a24dcaeaf93e3bcf84bc22a4e9e2b3a`。**#34 初始源码、文档、测试和必要截图已保存到当前分支；后续未提交增量同样必须保留，不得重建、清理、重置或丢弃。**
- 原目录 `C:\Users\niilo\Desktop\pi-agent-gui` 仍属旧 #32 工作树；不得在那里继续 #34，也不要改动其未提交资产。
- 工作树内未跟踪的字面目录 `%SystemDrive%/` 是先前隔离桌面运行时于 10:54 写出的 Windows 缓存；非本票源码，尚未清理，**不要盲目纳入提交或未经核实删除**。
- 先完整读本交接，再读 `AGENTS.md`、`CONTEXT.md`、`CONTRIBUTING.md`、`docs/product-goal.md`、`docs/adr/0001-native-zcode-base.md`、`docs/delivery/next-context.md`、`docs/delivery/full-development.md`、`docs/agents/{domain,issue-tracker}.md`、`docs/references/upstream-and-ui.md`、`docs/delivery/{reuse-inventory,native-ui-parity,desktop-profile-contract}.md`。动 Issue 先核对最新正文/评论。

## 当前实际实现（已保存初始提交，待交互复核）

- Pi 固定 `@earendil-works/pi-coding-agent@0.87.0`；本地 Host 注册 Pi Agent v4 适配，`PiRpcClient` 为 stdin/stdout JSONL，`PiSessionSupervisor` 每活动会话一个真实 Pi 进程，stop 清队列后 abort；`PiMessageRows` 将 Pi 文本、工具和运行事实投影到原生时间线。
- 修复原先 `onAgentRuntimeLifecycle` 缺失导致 Host 崩溃；此生命周期表示稳定的 Host 工作区服务，而不是 Pi 草稿子进程的退出。`readWorkspacePresentation` 返回原生工作区投影。已不再出现启动循环导致的 composer 失焦。
- `PiSessionCatalog` 在应用元数据目录保存 Pi JSONL **指针**，不复制 Pi 历史；重启时经 Pi `--session`、`get_state`、`get_messages` 重投影。`PiSessionLease` 对同一 sessionFile 在产品 Host 进程间原子排他、死 PID 恢复；外部 Pi CLI 不遵守这把锁，不能据此保证跨所有 Pi 进程独占。
- 原生 Controller 与项目任务区以 Pi sessions index 投影会话展示行，不创建旧 ZCode Task；无对应 Task membership 的非打开/恢复操作显式拒绝。原 UI 组件并未被改造成另一个聊天页。
- 目录书签写入失败后的 prompt ACK 仍保持已接收，v4 控制状态显示历史索引失败，防止把已经发给 Pi 的输入错误标成失败而引发重发。已重新打包并以最新代码实测 GUI；该失败注入只在专门单测覆盖，GUI 运行未注入磁盘失败。

### 当前能证明的证据与边界

| 证据 | 实际通过 | 不能推出 |
| --- | --- | --- |
| `node node_modules/tsx/dist/cli.mjs --test packages/services/test/pi-*.test.ts packages/desktop/src/host/windowHostControllerProjection.test.ts` | 最新源码 **43/43**；包括 Pi 两进程、租约、异常输出/背压/退出、ACK 与结算分相、read 文件目标一致性 | 完整桌面体验或全仓测试 |
| `tsc -b packages/services packages/desktop/tsconfig.host.json packages/ui`；定向 oxlint | 最新源码类型检查通过；改动范围 28 文件 **0 警告/0 错误** | 全仓 lint/Windows CI 已通过 |
| `pi-34-gui-final/`（隔离 Electron 原生预览） | 模型通过固定 Pi RPC 进程流式返回文本；Pi 自己发起 `read` 并取得 README 标记；原生按钮停止模型流；重启后项目列表选取同一 Pi JSONL 恢复文本/工具/停止状态，无重发。截图与 `pi-native-gui-report.json`、日志均在该目录 | 在线真实供应商、工具卡展开/滚动/分栏完整对照已经通过 |
| `pi-34-bundle-final/` + `pi-34-bundle-final.log` | **最新源码** Windows x64 NSIS 构建成功、170.5 MiB、依赖闭包与大小审计通过；未签名 | 签发/安装器升级测试 |
| `pi-34-packaged-final/` | 实际 `win-unpacked/Pi Agent IDE Preview.exe` 的 app.asar 入口以隔离 profile 重做创建/分段流/原生工具卡/停止/重启恢复、无重放；工具卡完成态 `completed`，点击原生文件芯片可在 Side Pane 打开 **Pi 工作区** README 的 `NATIVE_PARITY_PREVIEW`（曾错误打开应用仓库 README，已修复）；1280×800 和 1920×1080 各明暗两种主题的侧栏/输入/工具卡均可见、截图 4 张；`pageErrors=[]`、两次进程树无幸存 | 在线真实供应商、原版逐屏像素对照、滚动/标签/分栏全操作及安装器升级 |
| `packages/services/test/pi-session-lease.test.ts` | 两个实际 Node 进程争抢同一 Pi sessionFile 的产品锁，死 owner 恢复、无自动命令重放 | 并发的外部 Pi CLI 也受产品锁保护 |

受控模型服务是本地 OpenAI-compatible 测试端点，不是在线供应商推理；真实工具由**固定 Pi 进程**执行，不能写成仅 mock 工具。原生已完成轮次的“工作历史”默认折叠，所以原初脚本只查工具 DOM 判错；现按原生操作展开后工具卡实际可见，read 芯片点开原生 Side Pane 并验证正确文件。截图已复制到 [#34 对照资料（待独立逐屏复核）](issue-34-parity/README.md)，与 #32 固定原版图按交互面关联并明确未同状态部分。旧 #33 的 26 对原生基线图已在仓库，本轮虽有两视口/明暗四组合，但尚**未**逐操作对照原版滚动/标签和多分栏。脚本 `scripts/pi-native-gui-smoke.mjs` 支持开发预览，也可令 `NATIVE_PI_PACKAGED_EXE` 指向 `win-unpacked` 真正启动已打包入口；每次生成独立 profile、模型端点、操作报告和截图。

## 结构审查：保留与收紧

**保留**：原生前端与状态/交互管理；仅为它们服务的命令 ACK、snapshot/delta、session index、Controller 投影；Pi RPC 主管、工具/消息投影、JSONL 指针与排他租约。这是目前不用重写原生工作台的低成本路径，并不规定最终必须保留旧 Agent 内部结构。

**已收紧**：未知 `on*` 不再泛化返回空 Event；同步显式拒绝未知事件，启动期只为少量未启用遥测/CUA观察保留空订阅。产品桌面本地 Host 明确传 `piAgentRpcEntry`；旧后台 `zcodeTaskService` 调 Pi proxy 时因缺少旧执行方法而拒绝。桌面远端连接现**在启动旧 `zcode-server` 前显式报不可用**，待 Pi 远端目标迁移，不把旧引擎暗中作为产品 fallback。**待边界独立复核**：`packages/services/src/node.ts` 在未传 Pi 入口时仍能构造旧 Agent；`packages/server/src/{entry-http,stdioServices}.ts` 仍提供独立旧 server 路线，不能将它包装成 Pi 产品 server；兼容的无操作方法还须逐项标示语义。完整 spec / 正反例按 GitHub #34 最新评论复核。

## 下一步（只针对 #34）

1. 核对 GitHub #1/#34 最新正文和评论、本工作树 `git status`；校验 `node scripts/check-delivery-plan.mjs --github`。用户澄清须先在文档及 Issue 留痕，84/52/20 范围不擅删。
2. 已有可见 Pi 工具卡、流式中间态、停止反馈、历史列表选取及两视口/明暗截图；继续对照 `native-ui-parity.md` 的**原版实操**核对滚动、标签、分栏和本阶段可达功能，登记差异（不得以截图存在宣称逐屏验收）。
3. 复核本地 Pi-only / 远端明确拒绝与独立旧 server 边界，尤其无操作兼容方法。必要修复后重跑局部测试/类型/lint/打包入口，禁止用旧安装包证明新补丁。
4. 逐项核对 #34 验收条件后做**独立** Standards/Spec 审查、修复复审、PR 与最新 Windows CI；不满足不得合并/关闭 #34。完成后暂停，等待用户确认后续范围，不自动领取其他票。

#34 初始源码、测试、合同、对照资料及 8 张截图已保存至当前分支，Windows 偶发 `%SystemDrive%/` 缓存未纳入提交，仍原样保留。保存前 `git diff --check` 通过，`node scripts/check-delivery-plan.mjs --github` 核对 30 票/71 依赖边、唯一就绪 #34。后续交互对照、修复、PR 与 CI 尚待完成；跨上下文再次更新实测状态，避免将老日志说成新测试。
