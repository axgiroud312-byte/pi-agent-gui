# 2026-09-27 范围与任务同步验收

本次按用户明确确认的“Pi 自己的能力映射到 GUI + 使用 Pi 必要的桌面体验”更新规格、清单和后续 Issues。不是产品功能验收，也不合并 #34。

## 修改内容与保留边界

- 当前任务：#34 验收关卡、15 张后续功能票、#28 最终验收；父规格 #1 保持开启。
- #15–#24 共 10 张旧票退出首版，使用 `not_planned` / `wontfix`，不记为已交付；必要 Pi shell、启动参数和文件预览分别由 #4/#10/#14 承接。
- 71 条原生依赖调整为 45 条：删除 32 条旧依赖，增加 6 条保留范围内依赖。退出任务不参与覆盖或阻塞。
- 当前范围使用 P01–P34、D01–D06 和 V01–V12；旧 52/84/20 合同及 Issue 原文、状态、依赖在 [历史快照](archive/scope-before-2026-09-27/README.md) 保存，原评论/分支/源码保留。
- README、产品目标、ADR、任务入口、覆盖账本、上游参考和本地验证规则同步。删除原 main 仍保留的已禁用 CI 工作流，不恢复远程 CI。
- 独立分支 `docs/pi-first-scope-20260927` 基于 `main@4e6cf6a`，不包含原工作树 #34 未提交源码、测试或交付包。#34 / PR #39 保持 OPEN / Draft 与用户验收停点。

## 本地验证

| 验证 | 结果 |
| --- | --- |
| `node scripts/check-delivery-plan.mjs` | PASS：17 active、10 retired、3 historical；40 项能力和 12 个场景均有实施覆盖，执行表与依赖一致。 |
| `node --test scripts/check-delivery-plan.test.mjs` | PASS 6/6：缺失实施覆盖、退出票贡献覆盖/阻塞、遗漏最终依赖、表格漂移、把退出误记完成等反例均被拒绝。 |
| 定向 `oxlint`（两个校验器文件） | PASS，0 errors / 0 warnings。 |
| `git diff --check` / 暂存区检查 | PASS；CRLF/LF 规范化提示不属于内容错误。 |
| Markdown 本地链接、历史原文和覆盖表交叉核对 | PASS：78 个本地 Markdown 链接无缺失；历史 5 份文档与原 main 内容一致，覆盖表 40 项能力 / 12 场景与 registry 一致。 |

按 CONTRIBUTING，本轮为文档与流程校验变更，不重复产品全量构建/GUI 测试，也不运行远程 CI。

## 独立审查

主代理汇总两位只读 reviewer 的报告：

- **Spec PASS**：范围/必要能力承接/依赖均符合用户方向。初审发现 Pi 原生会话删除被误写为可选；已修正 #9 查询、排序、筛选、重命名与确认删除，并补测试及 P11 定义，复审通过。复杂 TUI 的兼容边界与固定 Pi 文档核对，保留必要输入及明确失败路径。
- **Standards PASS**：校验器阻止退出票参与当前覆盖或阻塞，要求 not_planned/wontfix，检查正文、父子关系和原生依赖。独立执行本地校验与 6 项测试通过；覆盖表 40 能力/12 场景与 registry 一致。无 packages/apps 产品代码变更。

两份审查均只针对此次文档和流程变更，不将后续功能或在线 provider 记为通过。

## 远程核对

`node scripts/check-delivery-plan.mjs --github` 实际 PASS：父规格 #1、30 个子 Issue、当前标题/完整正文、退出票 not_planned/wontfix 与 45 条原生依赖全部一致。10 张退出票已关闭为不计划实施，保留任务仍待验收；唯一无开放前置的实施票仍为 #34，但不绕过用户验收停点。

另外核对 PR #39 仍 OPEN / Draft，head 保持 `ef7780564a878b9be5d73b191df25a765b795519`。远程 workflow 仍为 disabled_manually；本分支删除其主线残留配置。此次同步不替用户验收 #34，不触发后续功能实施。
