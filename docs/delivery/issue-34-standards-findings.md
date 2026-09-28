# #34 Standards / Spec：均请求更改，待整改

来源：既有独立审查 `pi34-standards` / `A-6b66cca3` 与 `pi34-spec-evidence` / `A-f6fccc4f`，实际均为 GPT-5.6 Sol / max。两份首轮报告覆盖 `4e6cf6a...280e01e` 全分支；最新未提交 CI/许可补件仍在原任务补审。Spec 的任务封装状态为失败，但正文给出了明确 Request changes 和六项可核查代码发现，不能当作纯调度失败忽略，也不能视为通过。以下为主会话结合当前文件的初核与整改分流，不是替代独立审查，不表示故障复现测试已完成。

## 2026-09-24 整改结果（待独立复审，不替代 PASS）

本轮继续修复 S1–S8：持久化 admission fence/不确定投递对账、先锁后启动、惰性历史列表及退出恢复、稳定 Stop execution ID、扩展对话取消/启动期失败关闭、真实队列/retry 投影与 settled/compaction 权威历史协调。Pi 工具栏明确直接执行而非虚假审批；不支持的权限/执行约束显式拒绝。随后真实 GUI 找出的默认 create payload 和冷历史标题回归均修复并加测。当前服务81/81、全仓类型/lint、两条GUI、新Windows包及打包exe GUI通过，见[最终本地证据](issue-34-closeout/final/README.md)。

仍须独立复核全部生产增量、许可 source-lineage、扩展启动 fail-closed 和关闭超时兜底边界；本地结果不是独立审查结论。按用户当前要求，提交推送且Windows CI通过后才启动独立Standards/Spec复审，不合并/关闭#34。下方保留初核与第一批过程，未完成描述以本段及最终证据更新为准。

## 第一批生产整改（历史过程，未独立复审）

- S2 的 admission 降级已拆开：成功 prompt 后 get_state 异常仍返回 accepted，标记需要协调并阻止继续输入。首输入/普通输入、普通查询异常/timeout 四个回归由 failed ACK 转为通过。**跨重启持久化账本、未知投递 ACK 仍待修。**
- S3 已知 JSONL 恢复先 realpath/租约后创建 Pi client，核验返回路径，失败释放租约。两个真实 Host + 固定真实 Pi 的竞争回归先测出构造了两个 client，修后只有赢家构造/启动；原始 header 保留，Pi 合法追加初始化设置。新会话身份预留仍需复核。
- S5 的已验证 no-run 会撤销待关联 command，避免下一条消息归错命令。此回归为可控 client seam，尚不替代真实扩展合同。
- S7 每次输入建立 execution ID，投影到 activeWorks，Stop 在任何 await 前校验并占用；idle 为 noop，旧/空 ID 为 stale。停止投影按捕获的 command 定位，不能把新一轮或已完成轮次改成 interrupted。
- S4 的 disposeWorkspace 已实际关闭本 workspace Pi、等待 lease/书签写入、排空在途启动、清理订阅和加载缓存并推进 identity generation；另一 workspace 不受影响。真实进程退出/重获 lease 与并发启动释放两项回归通过。**惰性历史加载、同 Host 崩溃恢复及长寿命工具后代回收仍待修/验证。**
- 当前 `pnpm --dir packages/services exec tsx --test --test-concurrency=1 "test/*.test.ts"`：**64/64，无 skip**（比此前服务 54 项新增 10 项）；相关 services/desktop-host/UI 类型检查、定向 lint、diff check 通过。原始红/绿日志在 `D:/Temp/pi34-closeout/{s2-admission-before,s3-lease-before,s7-stop-before,s4-release-before,production-fixes-services,production-fixes-typecheck,production-fixes-lint}.log`。
- 未提交/推送；未重建桌面或重跑 GUI/打包。此前 139 项及 GUI 证据属于生产修复前快照，不算当前源码完整验收。S1、S6、S8 及以上剩余部分仍阻塞，不将部分修复记成全部通过。

## 原审查发现（历史依据；整改进度以上节为准）

| ID | 发现及当前代码依据 | #34 最小整改方向（尚未实施） |
| --- | --- | --- |
| S1 | `pi-agent-service.ts` / `pi-v4-snapshot.ts` 固定投影 build，但没有工具变更授权桥；命令若干执行约束未校验。 | 不得显示不存在的“修改前确认”。显式拒绝未支持的字段/模式并使 UI 诚实；不能偷偷改成更宽权限的 auto。完整模式/授权能力仍归后续票。 |
| S2 | `pi-session-supervisor.ts:sendText` 的 prompt 成功后仍在同一 try 中查询 get_state；后者异常可令 service 返回普通 failed ACK。历史恢复清掉 sourceCommandId 映射；账本仅存内存。 | admission 不可回退；持久化命令对账/实际 Pi 消息锚点，unknown-delivery 保持专门待对账，禁止重放可能执行过的输入。首输入和普通输入都须覆盖。 |
| S3 | `start` 在 client.start/get_state 后才 acquire lease；已知 JSONL 的 resume 在互斥前即打开文件。 | 已知文件先锁后 spawn；两套 supervisor 并发恢复同一文件的真实合同测试，不能仅测裸锁。 |
| S4 | `disposeWorkspace` 为成功空操作；loadWorkspace 为全部 bookmarks 启动 Pi；异常退出只清 supervisor，service/加载缓存仍留。 | 按 workspace 释放 runtime/租约/缓存/订阅；列表不预启动全部历史；明确恢复退出会话并换代，不假称重建成功。 |
| S5 | queue_update 未投影，快照 queue 永远空、apiRetry=null；clear_queue 返回值丢弃；无 Run 后期望 command ID 未结算。 | 从 Pi 事实维护必要队列/retry/compaction/无 Run 投影，保留未执行输入；补固定真实 Pi 合同。不是在本票实现完整双队列编辑器。 |
| S6 | 默认产品允许加载扩展，但没有 extension_ui_request/response 桥；部分真实测试使用 --no-extensions，和产品默认不同。 | 未支持的交互扩展必须明确 fail closed，不能无限等待；完整扩展 UI 留 #13。#34 原有真实 no-run 合同不能用 fake 代替或默删。 |
| S7 | activeWorks 无稳定 foregroundExecutionId，stop 忽略 expectedForegroundExecutionId；迟到 Stop 还会无条件 markStopped，将已成功轮次改成 interrupted。 | 每次 admission 建立稳定 run ID并投影，直到对应运行结算；Stop 原子校验 ID，只有实际中止该轮才标 interrupted。 |
| S8（Spec 新增） | PiMessageRows 忽略 retry/compaction/context edit；onPiRecord 在 settled 仅保存书签，没有查询权威 messages。恢复则用 get_messages 重建，可能使失败重试行/压缩前行突然变化。 | 在 Pi 的可靠边界有序协调权威 messages，防止异步旧查询覆盖新一轮；保留稳定行/命令锚点，不能直接 restore 清空关联。增加真实 retry、compact、恢复前后的行一致性测试。 |

文件均在 `packages/services/src/pi-agent/`。首轮初核时以上路径均仍存在，CI 修复没有解决这些生产缺陷；随后第一批生产变更及尚未解决部分见顶部。139 项本地测试通过及正常 GUI 路径证据不能否定未覆盖故障。

## 对首份报告的精确化反馈

已交回同一 Standards 任务核对，不能把过宽描述直接写成事实：

1. `applyModelSelection` 确实调用 Pi get_state/set_model/set_thinking_level，不是所有模型选择都被静默丢弃。普通 sendText 会显式拒绝非空 attachments 和非 startNow requestedDelivery；createSession.firstInput 与其余执行约束须分别核查。
2. `sendConversationCommandV4` 已按 workspace + session/create + commandId 保存 Promise 并返回 duplicate，所以同一存活 Host 的重复 create 有去重。缺陷是跨重启的持久化账本、Pi 消息锚点和不确定接纳对账，不能说完全没有去重。
3. hello.capabilities.nativeDialogs 的协议含义尚待确认，不能未查定义就等同于 Pi 扩展交互支持；扩展无响应的核心风险不依赖这个字段是否表示 OS 对话框。
4. 文档旧 43/43 属历史快照，不作为本轮测试数字。本轮命令/日志和 139 项计数在 closeout 目录；不能用新数字冒充新增故障测试。

## 其他仍需验证

- Windows 活跃 bash 及其子进程退出：必须以产品自身 stop/close 证明，不能用 harness 的 taskkill 清理后无幸存代替。本轮实际正常 GUI 报告虽然 forced=[]，但不覆盖活跃 bash 子树场景。
- 同一 Standards 任务仍需裁定最新 license source-lineage 补件；基础 license/provenance 通过不是独立许可审查通过。
- Spec 首轮判定：验收 1 部分满足，2/3/5 不满足；4 当前本地桌面 Pi-only 路径可接受。与 Standards 一致，图片读取限制、最新提交 CI 和最终新包门禁保持独立。
- 两份审查均未独立执行新测试。主会话对 S8 已核对 apply/onPiRecord 的缺口，但尚未执行 retry/compact 故障场景；不能把静态证据写成已复现。

当前：PR #39 Draft、#34 OPEN；不提交推送、ready/merge/close，不派新任务，不推进 #3–#27。联合整改顺序：先锁/生命周期 → admission/持久化对账与运行 ID → no-run/扩展取消 → retry/compact 消息协调和真实状态 → 不支持权限/字段的诚实封堵；以依赖关系调整，不扩展后续完整功能。待现有审查补充与最小整改计划收敛，再逐项修复、增加正负测试、由原审查任务复审。
