# 新上下文：当前仅完成并验收 #34

更新：2026-09-23。**原生底座已交付，用户已确认实际界面。** 用户新要求：暂停此前 #34→其余全部任务的自动连续开发；当前只完成、实测演示并审查 #34 原生 GUI→Pi 闭环。84故事／52能力／20场景保留为待确认范围，不自动实施或删除。先完整读取 [#34 实时交接](handoff-2026-09-23-issue-34.md)，再参考 [原全量任务依赖索引](full-development.md)；后者的自动推进指令已暂停。GitHub Issue 最新正文与评论仍为验收权威。

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

下一具体操作：**仅恢复现有 `issue-34-native-pi-rpc` 工作树**，保留全部未提交工作，核对 #34 最新正文/评论及现有 GUI/打包证据，完成原生体验与 Pi 事实边界复验。旧自动连续开发指令不再生效。
