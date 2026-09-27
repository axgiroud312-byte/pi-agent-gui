# PR #39 Standards 复审：PASS

审查者：本轮独立只读子 Agent `standards_review`。本页由主会话汇编其完整 PR 审查与最终增量复核结论，不是 GitHub review，也不代替测试或用户验收。

- 分支：`issue-34-native-pi-rpc`。
- 基线：`4e6cf6ad8a24dcaeaf93e3bcf84bc22a4e9e2b3a..ef7780564a878b9be5d73b191df25a765b795519` 加本轮未提交修复。
- GitHub 只读核实：PR #39 OPEN / Draft，#34 OPEN，#33 CLOSED。
- 远程 CI 已取消；旧 reviewer 停止状态与旧 CI 不作为本轮通过依据。

## 结论与覆盖

完整 PR 的生产代码、脚本、来源与许可边界未发现阻塞 #34 收尾的新增确定缺陷。以下旧问题均从当前实现重新核对，没有只引用修复表：

| 边界 | 审查结果 |
| --- | --- |
| 首输入与未知投递 | prompt 前持久化指针和 pending intent；无历史不代表未执行，无法对账保留输入闸门。 |
| 并发接纳 | sendText/delete 按会话串行；generation / record version 防止旧 settled 查询覆盖新输入。 |
| Host / Pi 退出 | Host 超时作为报警并继续等待 owner；清理验证失败保留租约与 quarantine。 |
| 失败收口 | disposal 汇总失败后继续处理其他 owner；在途启动和命令有排空路径。 |
| 锁恢复 | 新锁公开前具备完整 owner；失败 unlink 可重试；旧空锁保守拒绝接管是已登记边界。 |
| 完成与历史 | agent_end / compaction_end 不代表整个运行完成；agent_settled 配合权威历史协调。缺失 assistant 结果时不伪称成功。 |
| Stop 队列 | clear_queue 返还项持久化并保持暂停；新输入不自动执行它们。 |
| 诊断 | 有界未知类别与 service 诊断可观察，不直接输出可能含凭据的 stderr 原文。 |
| 执行入口 | 桌面 Host 注入 Pi；旧 task 动作显式拒绝；远端旧 server 启动前拒绝。原版对照与 Pi 产品隔离。 |

本轮压缩修复可接受：保存真实失败文案，abort 有兜底；仅替换同一轮模型重试错误，保留独立 extension/protocol 错误。成功压缩后 Pi 可以直接再次发出 agent_start，无 auto_retry_end；现在仅清理已恢复的模型错误，并让 hadRunError 继承 persistentRunError。真正新输入仍由 sendText 重置状态。

审查者实际读取修前/修后日志：新增恢复场景修前 2 失败，修后 7/7 通过。测试通过原生 conversation snapshot 订阅断言 phase / lastError。审查者没有重复执行测试。

cleanup 的注释和断言准确区分 harness 退出后补杀与产品内部强制终止；`forced=[]` 不再被解释为产品内部强制终止次数为零。

## 来源许可

只读核对 17 个新增 override 的本地许可文件 SHA、40 位固定来源提交及 inventory 条目，全部匹配。`proxy-agent-negotiate` 的原代码 MIT notice 与提取来源有明确说明。严格发行材料差额仍为 19 → 19，没有把基础检查冒称正式发行合规完成。未联网重下载全部上游文件或重新核算 npm tarball。

## 实际执行与限制

执行：Git / Issue / PR 只读核查、完整生产差异、相关脚本与回归断言、许可文件哈希、`git diff --check`。React 增量结合仓库 `vercel-react-best-practices` 指引检查，未发现需要扩大的性能修改。

未执行：构建、测试负载、GUI 启停、独立视觉验收、GitHub 写入。视觉与最终运行证据见 [本轮收尾报告](closeout-2026-09-27.md)。PASS 不等于用户验收或正式发行。

## 最终文件 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `packages/services/src/pi-agent/pi-session-supervisor.ts` | `696CB687AEC89E180433F65459AF6DF6DDB707217EBF44EDB2D95B437167498F` |
| `packages/services/test/pi-compaction-error.test.ts` | `8B36A0D7ADB0F4BC8C4CE4D388B24CA8B03D46B630DC257CCD032D0D6384CCCC` |
| `scripts/native-smoke/cleanup.mjs` | `31F20697A1F0FEC8B99BFFAD2286354D53AFEAE6DDD638C098EDD873C4C49DB3` |

交付后保持 PR Draft / #34 OPEN，停在用户验收，不合并、关闭或推进其他功能。
