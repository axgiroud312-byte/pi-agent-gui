# 新上下文：从 #34 连续完成完整首版

更新：2026-09-23。**原生底座已交付，用户已确认实际界面。** 下一次实施直接使用 [后续任务一次性开发执行文档](full-development.md)，从GitHub实际就绪前沿继续；当前为#34。

## 已完成与权威记录

- PR #37已合并到主线 `59362a37f044157a17b49950dc46b33c4d83842b`，#32/#36 CLOSED；产品源码/构建为 `0de01e26b86f7bc2ed023623516a0907f848819d`，证据提交为 `36e3eb811c1467c1b43646b5d2b3ff9a6c1e8cba`。
- **#33 CLOSED，用户确认已记录**：[原话、日期、版本与GitHub链接](native-ui-confirmation.md)。已完成的实际界面关卡不重复询问。
- 两轴独立审查通过；最终Windows CI [35796732198](https://github.com/axgiroud312-byte/pi-agent-gui/actions/runs/35796732198) / [35796727209](https://github.com/axgiroud312-byte/pi-agent-gui/actions/runs/35796727209)通过。真实运行、87项回归和26对截图见 [#32验收](issue-32-acceptance.md)。
- 本次完成关卡记录和后续执行文档。**#34尚未实施，#3–#28仍需在原生Pi链路交付，#1仍OPEN。** 实时状态以GitHub为准。

## 恢复步骤

1. 读根AGENTS、产品目标、ADR0001、CONTEXT、CONTRIBUTING及 `docs/agents/` 约定。
2. 读 [full-development.md](full-development.md)，按其中顺序核对GitHub #1/#33/当前票、原生依赖和现有PR。
3. 核对 `git status`、`git worktree list`、最新 `origin/main`。原项目目录曾在旧 `issue-32-native-zcode-import@317d286` 且有未提交文件；保留这些工作，从包含上述原生底座的最新主线创建或恢复正确独立worktree。
4. 在新文档所在工作树运行 `node scripts/check-delivery-plan.mjs --github`。截至本轮，30张管理票、71条原生依赖、27张剩余执行票核对一致，唯一就绪实施票为#34。
5. #34完成并合并后，按各票实际依赖连续实施；跨上下文更新本文件与Issue，不以完成一批作为完整首版完成。

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

下一具体操作：核对#34最新正文/评论和前置关闭状态，建立 `issue-34-native-pi-runtime` 或恢复已有对应分支，执行完整开发循环。用户若仅要求评审/文档，则交付所请求的材料后结束，不把阅读本文件当作立即改产品代码的请求。
