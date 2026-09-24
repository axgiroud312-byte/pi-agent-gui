# 新上下文：当前仅完成并验收 #34

更新：2026-09-23。**原生底座已交付，用户已确认实际界面。** 用户新要求：暂停此前 #34→其余全部任务的自动连续开发；当前只完成、实测演示并审查 #34 原生 GUI→Pi 闭环。84故事／52能力／20场景保留为待确认范围，不自动实施或删除。先完整读取 [#34 实时交接](handoff-2026-09-23-issue-34.md)，再参考 [原全量任务依赖索引](full-development.md)；后者的自动推进指令已暂停。GitHub Issue 最新正文与评论仍为验收权威。

## 2026-09-24 恢复的当前状态

用户当前指令：**只收尾 #34，唯一执行目录是 `C:\Users\niilo\Desktop\pi-agent-gui`，分支 `issue-34-native-pi-rpc`；不新建工作树，不触碰 `D:\Temp` 的对照/审查快照。** PR #39 保持 Draft、#34 保持 OPEN。对 `4fd60df` 的 12 条 Standards/Spec 意见逐项处理和多轮本地、Windows CI 反馈见[收口记录](issue-34-closeout/review-resolution-2026-09-24.md)。`30c35ad` 与 `8f8e0e3` 的 Windows CI 均未全绿；最新 CIM 冷启动修复已在上述目录完成受影响测试、重新打包和真实打包 GUI 验证。下一步只提交 #34 文件并等待该提交的 push/PR Windows CI 全绿，再续同一轮 Standards/Spec 全 PR 加新增改动复审。复审通过后停下等用户确认，未经确认不合并、不关闭 #34、不开始 #3–#28。下文 Temp/opencode 路径、旧计数与“先取得计划批准”等内容均为历史快照，不再作为操作指令；未跟踪 `%SystemDrive%/` 保留且不提交。

## 本轮收尾补充（历史过程）

**最新：Standards / Spec 首轮均 Request changes，不能继续仅按 CI 收尾。** [联合生产阻塞与主会话初核](issue-34-standards-findings.md)记录接纳/防重放、权限、先锁后 spawn、生命周期、真实状态、扩展边界、Stop 代际，以及 Spec 新增的 retry/compaction 实时/恢复消息不收敛；第一批生产整改已落地：admission 后查询失败保持 accepted、恢复先锁后启动、no-run 关联清理、Stop 代际与按 command 停止投影、workspace 实际释放及在途启动栅栏。服务 64/64、相关类型/lint 通过；持久化对账、惰性加载/崩溃恢复、权限/扩展、状态及历史协调仍未完成，GUI/新包未重测。两份首轮针对已提交 HEAD，已要求原两位审查补审最新增量并精确化发现，不派新任务。

先读 [收尾证据与未过关卡](issue-34-closeout/README.md)和[原版/Pi 断言映射](issue-34-ci-acceptance-map.md)。用户批准的最小 CI 修复已在现有 #34 工作树完成本地验证：139 项测试、lint/typecheck/architecture、许可/provenance 基础检查、18 组原生动作/48 图、原版与 Pi 的滚动/工具/标签/双会话及 Pi 重启恢复。**尚未提交推送、无最新绿 CI、无独立审查通过、新包未重建、图片读取限制仍在；PR #39 Draft / #34 OPEN 不变。** 只继续已有 Sol/max Standards/Spec 实例，不派新任务；具体 ID、原始日志位置和当前唯一写入方见交接顶部。旧章节中的“尚未修复/没有合规审查运行环境”仅是历史快照。

## 已完成与权威记录

- PR #37已合并到主线 `59362a37f044157a17b49950dc46b33c4d83842b`，#32/#36 CLOSED；产品源码/构建为 `0de01e26b86f7bc2ed023623516a0907f848819d`，证据提交为 `36e3eb811c1467c1b43646b5d2b3ff9a6c1e8cba`。
- **#33 CLOSED，用户确认已记录**：[原话、日期、版本与GitHub链接](native-ui-confirmation.md)。已完成的实际界面关卡不重复询问。
- 两轴独立审查通过；最终Windows CI [35796732198](https://github.com/axgiroud312-byte/pi-agent-gui/actions/runs/35796732198) / [35796727209](https://github.com/axgiroud312-byte/pi-agent-gui/actions/runs/35796727209)通过。真实运行、87项回归和26对截图见 [#32验收](issue-32-acceptance.md)。
- 旧记录中“#34尚未实施”是历史快照。**#34 当前在独立工作树实施中、初始工作已保存至分支，尚未 PR/合并；#3–#28 的自动实施暂停，#1 仍 OPEN。** 具体进展与证据见 [#34 交接](handoff-2026-09-23-issue-34.md)，实时状态以 GitHub 为准。

## 恢复步骤

1. 读根AGENTS、产品目标、ADR0001、CONTEXT、CONTRIBUTING及 `docs/agents/` 约定。
2. 读 [full-development.md](full-development.md)，按其中顺序核对GitHub #1/#33/当前票、原生依赖和现有PR。
3. 核对 `git status`、`git worktree list`、最新 `origin/main`。原项目目录曾在旧 `issue-32-native-zcode-import@317d286` 且有未提交文件；保留这些工作，从包含上述原生底座的最新主线创建或恢复正确独立worktree。
4. 在新文档所在工作树运行 `node scripts/check-delivery-plan.mjs --github`。截至本轮，30张管理票、71条原生依赖、27张剩余执行票核对一致，唯一就绪实施票为#34。
5. #34 完成并经用户验收后暂停；未经用户再次确认，不自动领取 #3–#28。跨上下文更新交接和 Issue，不以本阶段完成宣称完整首版完成。

## 按任务加载资料

| 正在做什么 | 先读 |
| --- | --- |
| 实施#34或修改RPC/会话/队列 | 当前Issue、[固定上游与协议](../references/upstream-and-ui.md)、[复用清单](reuse-inventory.md) |
| 调整数据目录、认证或迁移 | [应用profile合同](desktop-profile-contract.md)，并区分Pi的目标侧认证/历史与GUI元数据 |
| 修改用户界面 | [原生一致性标准](native-ui-parity.md)、已确认产品及原版截图 |
| 更改CLI或CI | 当前包AGENTS与实际workflow、[CLI lint基线政策](native-cli-lint-policy.md) |
| 最终发行 | #27/#28、[覆盖账本](coverage.md)、第三方inventory/README和严格发行检查 |

## 遗留差额与记录

固定原版未启用的会话split、物理IME、完整性能/安装升级恢复和19项继承发行材料差额按#5/#26/#27/#28补齐。真实OAuth、llama.cpp、MCP、GitHub、WSL/SSH及新Pi链路均需自己的证据；详细处理见执行文档，旧分支结果仅为资产。

旧路线和历史检查保存在 [execution-log.md](execution-log.md)、[reuse-inventory.md](reuse-inventory.md) 及原提交；恢复工作时以本入口、最新执行文档及GitHub为准。

下一具体操作以本页顶部当前指令和 GitHub 最新状态为准；本段以前的执行清单保留作历史来源，不再要求恢复 Temp 工作树。核对 #34 最新正文/评论、[逐条收口](issue-34-closeout/review-resolution-2026-09-24.md)和[原版/Pi 对照](issue-34-parity/README.md)，不要在 CI 与复审通过前宣称 #34 已完成。
