# #34 实时交接：原生 GUI → Pi，待最终验收

更新：2026-09-23（Asia/Shanghai）。权威验收以 GitHub #34 最新正文与评论为准；本文只记当前工作树和**实际取得**的证据。

## 2026-09-24 当前停点：本地整改复验通过，待本次 CI 与独立复审

本轮只在 `C:\Users\niilo\Desktop\pi-agent-gui`、`issue-34-native-pi-rpc` 收尾 #34，没有新建工作树，也没有改动 `D:\Temp` 的对照或审查快照。两份 `4fd60df` 审查的 12 条意见、接手时状态、补充改动和本地证据见 [逐项收口](issue-34-closeout/review-resolution-2026-09-24.md)。最新源码 Pi 测试 105/105、桌面投影 1/1、类型检查与定向 lint 通过；Windows 新包及包内 exe GUI、18 项原生 GUI smoke 通过，全部产物在本仓库 `release/issue-34-closeout/`。这些是本地验证，不替代尚待触发的最新 Windows CI 或独立复审。

仍须只提交 #34 文件并推送现有 Draft PR #39，等最新 Windows CI 绿后续 Standards / Spec 全范围复审。审查通过后停下等待用户确认，不自行合并、不关闭 #34、不开始 #3 到 #28。以下均为历史阶段记录，旧路径与旧 CI 状态不再描述当前工作区。

## 历史停点：4fd60df 双 CI 绿后，独立复审均 Request changes

[Spec 发现](issue-34-closeout/spec-review-4fd60df.md)与[Standards 发现](issue-34-closeout/standards-review-4fd60df.md)覆盖冻结全PR快照，实际两 reviewer 均 GPT-5.6 Sol / max。不得以绿色 CI 合并/关闭。当前三个实施任务分离文件：production 修 supervisor/native-v4 的重试与生命周期失败收口；lease-recovery 仅锁本体/专属测试；host-shutdown 负责 RPC teardown 和 desktop/main 的预算/可靠进程树收口。主会话已红绿修 node.ts 通用 disposer 前序失败跳过 Pi 的问题，图像加载取证脚本正在补充。Spec 三项首批修复报告87/87，不覆盖剩余Standards admission并发/重启、运行状态、Stop返还队列和诊断链，仍须后续逐项整改。

工作树有新未提交整改；生产代码变化后必须重跑测试/GUI/新包/CI，再续原两 reviewer，不能用4fd60df旧绿色代替。视觉工具依然禁用，目视复核仍未完成。%SystemDrive%缓存保持不动。

## 2026-09-24 恢复（历史过程）

用户已明确授权修复既有阻塞后提交/推送 PR #39，**先通过 Windows CI，再独立 Standards / Spec 复审**；不合并、不关闭 #34、不推进后续票。本轮已核对最新 PR/CI/Issue，复跑许可、provenance、46 项脚本回归及双 cwd transport，详见 [恢复核验](issue-34-closeout/resume-2026-09-24.md)。生产 S1–S8 本轮修复及两个集成回归已处理；服务81/81、新构建两条GUI、新Windows包和打包exe GUI均通过，见[最终本地证据](issue-34-closeout/final/README.md)。生产修复 `d25580b`、CI/证据 `8dc95b7` 已推送 PR #39；Windows CI 已触发，尚无新绿CI或独立复审PASS。下文“不提交推送、只继续旧实例”的旧停点不再适用，旧证据仍保留。

## 本轮收尾更新（优先于下方旧阶段快照）

**后续收到 Standards / Spec 首轮 Request changes。** 核心生产阻塞仍存在；Spec 另指出 retry/compaction 后实时与恢复消息不收敛，主会话已核对代码缺口。不能以本轮 139 项测试通过抵销。详见 [联合发现、初核与精确化反馈](issue-34-standards-findings.md)；原两位审查正补审未提交增量/许可来源。主会话已完成第一批生产修复：admission 查询失败不降级、恢复先锁后启动、no-run 关联清理、Stop 代际与指定 command 投影、workspace 真实释放和在途启动栅栏。服务 64/64、相关类型/lint 通过；尚未解决的持久化对账、惰性恢复/崩溃重连、权限/扩展/状态/历史协调详见联合发现顶部。生产代码变动后旧 GUI/139 项记录只作历史证据，新 GUI/打包尚未重跑。不继续许可支线，不重复排队复审。

- 继续唯一现有工作树；HEAD/远端仍为 `280e01e`。用户已批准原版/产品测试分流；主会话完成未提交修复，没有重新开发生产 UI/适配，没有提交/推送/合并。
- [本轮断言映射](issue-34-ci-acceptance-map.md)逐项保留原版能力；Pi 使用实际 `read(path)` 和真实 `get_commands` / `compact` RPC 合同，GUI 命令菜单/扩展 waiting 不算通过，不偷做后续票。
- [本轮完整证据](issue-34-closeout/README.md)：139 项测试通过；全仓 lint 0 errors/70 warnings，typecheck、architecture、CLI 门禁通过；18 组原生操作/48 图、真实 Pi 重启/滚动/工具/双会话及固定原版对应交互通过。图片读取仍被禁用，独立逐屏视觉审查未完成。
- 许可与 provenance 基础门禁恢复；没有删依赖或增豁免。`proxy-agent-negotiate` 补入真实前身代码的 MIT 通知、不可变来源链及 npm 对照证据，待 Standards 独立裁定；原有 19 项严格发行材料差额不变。没有宣称最终法律/发行合规完成。
- 只继续现有两位 Sol/max 审查：`pi34-standards` (`A-6b66cca3`) 和 `pi34-spec-evidence` (`A-f6fccc4f`)。实际 runner 选型已验证，审查尚无通过结论。旧 `pi34-spec` 已停，不恢复。原 `pi34-ci` 因调度策略禁用停止，主会话接手写入；按用户要求不派新任务、不擅换模型。
- 审查可读全量/增量快照在 `D:/Temp/pi34-closeout/`；原始失败日志、模型请求、trace、守卫日志均保留。后续仅用 `SendMessage` 继续上述既有审查，必须复核全 PR 加增量。
- 剩余：处理审查发现/视觉限制 → 对最终源码新打包复验 → 获准提交推送并核对最新 Windows CI → 仅在所有关卡通过后 ready/merge/关闭 #34。当前 Draft/OPEN，不推进其他票。C: 仅约 0.5 GiB 可用，新增大文件/临时构建放 D:，不清理用户/旧缓存资产。

## 用户最新边界与停点

用户要求保留 **ZCode 原生前端的布局、组件、交互、动态反馈、流式显示、工具卡、滚动、标签和分栏体验**，并非保留旧 Agent 内部架构。Pi 是消息、工具执行、会话历史、运行状态和队列的唯一事实来源；前端只保存必要展示/交互状态。当前低成本 v4 适配可以继续，但不能以兼容旧接口为由假报成功。**先完成并实际演示 #34；原 #34→其余全部任务的自动连续执行已暂停。** 84故事／52能力／20场景保留待确认，不删除、不自动实施、不宣称完成；不切换 SDK，不推倒已有成果。说明已同步 [产品目标](../product-goal.md)、[适配合同](issue-34-pi-adapter-contract.md)、[原计划暂停说明](full-development.md) 与 [新上下文入口](next-context.md)，并记录于 [#34 最新澄清评论](https://github.com/axgiroud312-byte/pi-agent-gui/issues/34#issuecomment-5788677011) 和 [父规格 #1 评论](https://github.com/axgiroud312-byte/pi-agent-gui/issues/1#issuecomment-5788679880)。

#33 原生界面关卡已确认并关闭。#34 **OPEN；Draft PR #39 已创建、本分支 Windows CI 已运行但失败；尚无独立 Standards/Spec 审查/合并**。#1、#28 和后续实施票并未因为本阶段演示完成。领取评论：[Issue #34 领取记录](https://github.com/axgiroud312-byte/pi-agent-gui/issues/34#issuecomment-5787690336)；[最新本地实测回写](https://github.com/axgiroud312-byte/pi-agent-gui/issues/34#issuecomment-5788997840)。

## 只在现有工作树继续

- 路径：`C:\Users\niilo\AppData\Local\Temp\opencode\pi-native-pi-34`；分支 `issue-34-native-pi-rpc`，基于已合并 PR #38 的 `4e6cf6ad8a24dcaeaf93e3bcf84bc22a4e9e2b3a`。**#34 初始成果保存于 `388f672`，交互补验与服务边界增量已推送 `b6c34a9`；同视口原版滚动补验新增证据提交随后记载。不得重建、清理、重置或丢弃。**
- 原目录 `C:\Users\niilo\Desktop\pi-agent-gui` 仍属旧 #32 工作树；不得在那里继续 #34，也不要改动其未提交资产。
- 工作树内未跟踪的字面目录 `%SystemDrive%/` 是先前隔离桌面运行时于 10:54 写出的 Windows 缓存；非本票源码，尚未清理，**不要盲目纳入提交或未经核实删除**。
- 先完整读本交接，再读 `AGENTS.md`、`CONTEXT.md`、`CONTRIBUTING.md`、`docs/product-goal.md`、`docs/adr/0001-native-zcode-base.md`、`docs/delivery/next-context.md`、`docs/delivery/full-development.md`、`docs/agents/{domain,issue-tracker}.md`、`docs/references/upstream-and-ui.md`、`docs/delivery/{reuse-inventory,native-ui-parity,desktop-profile-contract}.md`。动 Issue 先核对最新正文/评论。

## 当前实际实现（已有阶段性提交，待独立审查及 CI 修复）

- Pi 固定 `@earendil-works/pi-coding-agent@0.87.0`；本地 Host 注册 Pi Agent v4 适配，`PiRpcClient` 为 stdin/stdout JSONL，`PiSessionSupervisor` 每活动会话一个真实 Pi 进程，stop 清队列后 abort；`PiMessageRows` 将 Pi 文本、工具和运行事实投影到原生时间线。
- 修复原先 `onAgentRuntimeLifecycle` 缺失导致 Host 崩溃；此生命周期表示稳定的 Host 工作区服务，而不是 Pi 草稿子进程的退出。`readWorkspacePresentation` 返回原生工作区投影。已不再出现启动循环导致的 composer 失焦。
- `PiSessionCatalog` 在应用元数据目录保存 Pi JSONL **指针**，不复制 Pi 历史；重启时经 Pi `--session`、`get_state`、`get_messages` 重投影。`PiSessionLease` 对同一 sessionFile 在产品 Host 进程间原子排他、死 PID 恢复；外部 Pi CLI 不遵守这把锁，不能据此保证跨所有 Pi 进程独占。
- 原生 Controller 与项目任务区以 Pi sessions index 投影会话展示行，不创建旧 ZCode Task；无对应 Task membership 的非打开/恢复操作显式拒绝。原 UI 组件并未被改造成另一个聊天页。
- 目录书签写入失败后的 prompt ACK 仍保持已接收，v4 控制状态显示历史索引失败，防止把已经发给 Pi 的输入错误标成失败而引发重发。已重新打包并以最新代码实测 GUI；该失败注入只在专门单测覆盖，GUI 运行未注入磁盘失败。

### 当前能证明的证据与边界

| 证据 | 实际通过 | 不能推出 |
| --- | --- | --- |
| `node node_modules/tsx/dist/cli.mjs --test packages/services/test/pi-*.test.ts packages/desktop/src/host/windowHostControllerProjection.test.ts` | 最新源码 **43/43**；包括 Pi 两进程、租约、异常输出/背压/退出、ACK 与结算分相、read 文件目标一致性 | 完整桌面体验或全仓测试 |
| `tsc -b packages/services packages/desktop/tsconfig.host.json packages/ui`；定向 oxlint | 最新服务/桌面/UI 类型检查和定向 lint 曾通过；本次滚动脚本 `node --check`、oxlint 三文件 **0 警告/0 错误** | Windows CI **失败**，详见 Draft PR #39，不能宣称全仓通过 |
| `pi-34-gui-final/`（隔离 Electron 原生预览） | 模型通过固定 Pi RPC 进程流式返回文本；Pi 自己发起 `read` 并取得 README 标记；原生按钮停止模型流；重启后项目列表选取同一 Pi JSONL 恢复文本/工具/停止状态，无重发。截图与 `pi-native-gui-report.json`、日志均在该目录 | 在线真实供应商、工具卡展开/滚动/分栏完整对照已经通过 |
| `pi-34-bundle-final/` + `pi-34-bundle-final.log` | **最新源码** Windows x64 NSIS 构建成功、170.5 MiB、依赖闭包与大小审计通过；未签名 | 签发/安装器升级测试 |
| `pi-34-bundle-interaction/` + `pi-34-product-scroll-1280-dark/` | **最新服务代码的**实际打包 exe/app.asar 复测通过初始链路及长流式自动跟随、手动上滚不抢滚动、返回最新；Pi 第二次 read 打开真实 hello.txt、原生两文件标签拖拽重排与 Side Pane 缩放、双 Pi 会话切换不重放、原生禁用 split 探针；报告明确 `http://127.0.0.1:55457/v1` 是该次运行的本地确定性模型测试端点，Pi 自己执行文件工具；`pageErrors=[]`、两次进程树无幸存 | 在线真实供应商、会话 split 可用性及安装器升级 |
| `D:\Temp\pi-34-original-scroll-1280-dark/` | 固定原版 317d286 临时源码归档独立构建，真正原版 Agent 使用 `http://127.0.0.1:62737/v1` 受控模型，同尺寸 **1280×800 深色** 的流式跟随、手动上滚不抢滚动、返回最新均实际通过；三张原版图与产品同状态图已成对入库 | 这是原版参考行为，不是产品 Pi 运行证据；其他全量逐屏审查 |
| `packages/services/test/pi-session-lease.test.ts` | 两个实际 Node 进程争抢同一 Pi sessionFile 的产品锁，死 owner 恢复、无自动命令重放 | 并发的外部 Pi CLI 也受产品锁保护 |

受控模型服务是本地 OpenAI-compatible 测试端点，不是在线供应商推理；真实工具由**固定 Pi 进程**执行，不能写成仅 mock 工具。原生已完成轮次的“工作历史”默认折叠，所以原初脚本只查工具 DOM 判错；现按原生操作展开后工具卡实际可见，read 芯片点开原生 Side Pane 并验证正确文件。最新滚动/标签/会话/split 截图也已复制到 [#34 对照资料（待独立逐屏复核）](issue-34-parity/README.md)，与 #32 固定原版实际操作逐面关联并明确缺口。固定原版 #32 先前没有量测长流式自动/手动滚动；本轮初次在 C: 副本安装触发 `ENOSPC`，已删除仅该失败副本，随后在空间充足的 D: 隔离归档成功构建并**真实启动固定原版**执行同尺寸、主题和流式手势。两侧均不回弹抢滚，返回最新正常；详细数值、对应图、不同 Agent 内容导致的高度差见对照资料。脚本 `scripts/pi-native-gui-smoke.mjs` 支持开发预览，也可令 `NATIVE_PI_PACKAGED_EXE` 指向 `win-unpacked` 真正启动已打包入口；每次生成独立 profile、模型端点、操作报告和截图。

## 结构审查：保留与收紧

**保留**：原生前端与状态/交互管理；仅为它们服务的命令 ACK、snapshot/delta、session index、Controller 投影；Pi RPC 主管、工具/消息投影、JSONL 指针与排他租约。这是目前不用重写原生工作台的低成本路径，并不规定最终必须保留旧 Agent 内部结构。

**已收紧**：未知 `on*` 不再泛化返回空 Event；同步显式拒绝未知事件，启动期只为少量未启用遥测/CUA观察保留空订阅。产品桌面本地 Host 明确传 `piAgentRpcEntry`；旧后台 `zcodeTaskService` 调 Pi proxy 时因缺少旧执行方法而拒绝。Pi-only 适配不让旧 ZCode task-index syncer 将 Pi sessions-index 导入旧 SQLite/readSession；Host 不订阅不存在的旧 Agent/MCP 资源遥测。这些增量的最新源码通过 43/43 Pi 测试、TypeScript、定向 lint 和开发 GUI；最新打包产物另有交互 probe-10 成功。桌面远端连接现**在启动旧 `zcode-server` 前显式报不可用**，待 Pi 远端目标迁移，不把旧引擎暗中作为产品 fallback。**待边界独立复核**：`packages/services/src/node.ts` 在未传 Pi 入口时仍能构造旧 Agent；`packages/server/src/{entry-http,stdioServices}.ts` 仍提供独立旧 server 路线，不能将它包装成 Pi 产品 server；兼容的无操作方法还须逐项标示语义。完整 spec / 正反例按 GitHub #34 最新评论复核。

## 下一步（只针对 #34）

1. 核对 GitHub #1/#34 最新正文和评论、本工作树 `git status`；校验 `node scripts/check-delivery-plan.mjs --github`。用户澄清须先在文档及 Issue 留痕，84/52/20 范围不擅删。
2. 已有固定原版与产品 **1280×800 深色**的真实滚动三阶段成对截图和数值、原版/产品可用 Side Pane 标签拖动/缩放与禁用会话 split 的路径证据；继续按 `native-ui-parity.md` 做其余逐屏视觉复核并登记缺陷，不能凭局部截图宣布全体验完成。
3. 复核本地 Pi-only / 远端明确拒绝与独立旧 server 边界，尤其无操作兼容方法。必要修复后重跑局部测试/类型/lint/打包入口，禁止用旧安装包证明新补丁。
4. Draft PR #39 的 Windows CI [35824489392](https://github.com/axgiroud312-byte/pi-agent-gui/actions/runs/35824489392) **失败**：源码/lock 变更后 notice 输入哈希不一致；服务测试用 `process.cwd()` 计算 fixture 路径而 CI 使用 `pnpm --dir packages/services`；许可检查把 Windows 未装的 AIX 平台 optional 依赖当作必装；旧 ZCode 桌面 smoke 还要求 `/compact`，不适用于真实 Pi 产品。先按 CI 修复规范提出计划获明确批准再修、重跑最新 CI，不许静音/跳过失败。逐项核对 #34 验收条件后做**独立** Standards/Spec 审查、修复复审；不满足不得合并/关闭 #34。当前 `reviewer` 角色两次派遣均被模型策略立即拒绝（只能 GPT-5.6 Sol，现有未配置 Jev/合规模型），**没有独立审查结果，不能伪称通过**。需为独立审查提供合规 reviewer 运行环境。完成后暂停，等待用户确认后续范围，不自动领取其他票。

#34 初始和交互阶段提交均已推送至当前分支；Windows 偶发 `%SystemDrive%/` 缓存未纳入提交，仍原样保留。`node scripts/check-delivery-plan.mjs --github` 曾核对 30 票/71 依赖边、唯一就绪 #34。PR #39 保持 Draft，CI 修复及合规独立审查后才可合并；跨上下文再次更新实测状态，避免将老日志说成新测试。
