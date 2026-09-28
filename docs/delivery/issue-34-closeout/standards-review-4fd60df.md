# 独立 Standards 复审：REQUEST CHANGES

reviewer `pi34-standards-final` / `A-94d127c3`，实际 GPT-5.6 Sol / max；只读冻结 `D:/Temp/pi34-review-snapshot-4fd60df`，覆盖全 PR `4e6cf6a..4fd60df`。未运行命令/测试、未修改源码。两项 Windows CI SUCCESS 不抵消以下发现。

## 阻塞与必要故障回归

1. **可恢复 admission 身份/intent 缺口**：ledger pending仅ack:null；首输入JSONL未存在时catalog不能保存指针但仍发prompt；恢复仅uncertain闸门，pendingIntent本身不阻塞。真实扩展no-run可执行副作用却不留user消息，不能用无历史证明未执行。需副作用前可恢复session身份，未决intent无论uncertain标志如何保持闸门；覆盖reserve/create/flush/response/post-bookmark各崩溃边界、hook改写/no-run。
2. **同session admission并发**：model切换和共享intent无临界区，输家可改变赢家model或删除其intent；旧settled读的recordVersion未包含新admission，可清新intent。需session串行接纳、独立generation、匹配command/generation才能结算；并发不同模型/延迟旧历史读回归。
3. **Host退出预算不匹配**：Host service-dispose仅3.5s，Pi teardown串行最坏约26s；Promise.race超时不取消operation随后Host退出，Agent bash abort失败无tree-kill兜底。需统一预算与可靠owner等待强制进程树收口；Host级hung clear/abort+真实工具后代故障测试。
4. **全局终止/失败收口**：与Spec的startup/dispose和exit/resume竞态重合；另releaseWorkspace close失败跳过drain/订阅/zombie清理，node.ts通用disposer前一服务失败可跳过Pi。需全部owner收口后聚合报错，清理promise可等待。
5. **锁本体崩溃恢复**：空.recover无owner永久阻塞；主锁创建后写owner前崩溃成空/partial锁不可回收；release在unlink前置released使I/O失败不可重试。需安全owner-bearing恢复claim、活跃初始化不被误抢、空锁/stale恢复/多进程/unlink故障回归。
6. **settled唯一完成边界**：reconcile无assistant用户轮可标成功，compaction_end活动轮也触发；恢复idle+user-only历史误报成功；成功retry残留错误，summarization retry未完整投影。断言turn/session/error/apiRetry而非只rows。
7. **Stop返还队列**：clear_queue后本地保留项下一输入被改为autoDrain但未入Pi，重启不持久化丢输入。需持久化paused/non-executable返还状态，真实重新入Pi之前不能自动执行；Stop→重启/新输入回归。
8. **诊断边界断开**：supervisor diagnostics未被service消费，未知合法record静默忽略。需有界脱敏诊断日志/投影，stderr、startup extension_error、unknown record回归。

以上是独立发现，仍需主会话逐项核实和实施证据；不是已经复现全部故障。当前单一生产worker先修Spec三项及服务失败收口；独立lease worker仅修改lease本体/专属测试，公开接口不变，避免共享写入。Host预算与后续admission/状态等按依赖顺序推进，不能以局部修复关票。

## 正向核查与边界

CI未弱化，无continue-on-error或测试过滤；桌面产品无旧Agent fallback（prepare-storage仅存储，不判为模型循环）；权限文案诚实。17项新增许可静态与lock/inventory/override/notices一致、完整commit来源、proxy lineage保留，未扩大19项发行差额；reviewer未联网重算SHA，已有执行证据不冒称其独立执行。视觉仍未完成，工具限制不以PNG存在替代PASS。

当前PR Draft / #34 OPEN。生产修改后必须重跑必要本地/GUI/包/Windows CI，再继续原两位reviewer复审；不合并、不推进后续票。
