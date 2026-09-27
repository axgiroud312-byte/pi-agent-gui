# 当前入口：Pi 范围已收缩，#34 等待用户验收

更新时间：2026-09-27。先读 [产品目标](../product-goal.md)、[ADR 0001](../adr/0001-native-zcode-base.md)、[范围修订](pi-first-scope.md)，再核对 GitHub 最新正文与本地 `git status`。此次用户授权更新远程文档、任务与后续 Issues，不授权自动开始新功能或合并 #34。

## 当前状态

- #32 原生导入与 #33 实际界面确认已完成。ZCode 原生组件、布局和交互继续复用。
- #34 OPEN / [PR #39](https://github.com/axgiroud312-byte/pi-agent-gui/pull/39) Draft；`issue-34-native-pi-rpc@ef77805` 之后的本地压缩错误修复、恢复回归和证据纠正仍未提交。不要把文档分支合并当成 #34 已合并。
- 本地 #34 试用包与验证材料保留在 `C:\Users\niilo\Desktop\pi-agent-gui\release\issue-34-closeout\2026-09-27\`；可运行入口为 `bundle/win-unpacked/Pi Agent IDE Preview.exe`。这些本地产物不在文档提交中，也不是远程可下载发行版。
- 本地工作树中的 `docs/delivery/issue-34-closeout/closeout-2026-09-27.md`、Standards/Spec 报告和 `manifest.json` 记录本次收尾证据。固定真实 Pi + 受控 loopback 模型验证不等于在线账号验收；安装器安装/升级尚未验证。
- 清理证据中的 `forced=[]` 仅表示测试 harness 在应用退出后无需补杀；`survivors=[]` 表示它记录的进程无残留，不能证明运行时内部从未强杀。
- 远程 CI 已取消；旧正文/评论/报告的 CI 门槛由当前 CONTRIBUTING 覆盖，不恢复工作流。

## 当前任务范围

#1 保持开启；#34 是当前验收关卡。之后保留 15 张功能票 + #28 最终验收，见 [执行表](full-development.md)、[能力账本](coverage.md) 与 [机器合同](tickets.json)。#15–#24 共 10 张旧票按 not_planned/wontfix 退出，并非已交付；其旧正文、依赖见 [历史快照](archive/scope-before-2026-09-27/README.md)，原评论/分支/源码不删除。

Pi 能力包括对话、图片、工具、模型/认证/thinking、队列/停止/重试/压缩、历史/树/分支、Skills/模板/扩展/配置，以及固定版本的其他原生能力。桌面只补使用 Pi 所必要的本地项目、输入/引用/预览、会话切换、设置和可靠启动/保存恢复。在线 API/OAuth 仍保留，复杂 TUI 按实际接口记录边界。

## 接手动作

1. 原工作树 `C:\Users\niilo\Desktop\pi-agent-gui` 的所有未提交内容必须保留，尤其 #34 源码/测试、历史交接、`%SystemDrive%/`、`用`。不 reset、clean、强推或批量暂存。
2. 文档与任务同步通过独立 `docs/pi-first-scope-20260927` 分支进行，不包含产品修复；保留原分支。后续集成 main 时逐文件解决范围文档冲突，不覆盖本地产品代码。
3. 先核对 #34 当前用户验收结果。未获后续功能实施指令时停在此处；ready 标签或无依赖不等于自动开工。
4. 进入具体实施后按最新 Issue、原生依赖、复用边界和本地验证规则交付。`node scripts/check-delivery-plan.mjs --github` 只验证账本一致，不证明任何功能完成。
