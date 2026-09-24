# #34 最终本地检查（2026-09-24；CI/独立复审待完成）

这批证据对应 `280e01e` 之后本轮拟提交的全部生产修复，包含首输入 payload 和冷历史标题的 GUI 回归修复。报告中的 Git HEAD 仍为构建时的 `280e01e`，不是声称旧提交具有新行为；记录包含工作树状态与实际构建摘要。提交后以 PR #39 CI 对提交快照再验。

- `checks/pi34-title-fix-services.log`：服务包 cwd **81/81**。
- `checks/pi34-final-precommit-{lint,typecheck,provenance,licenses}.log`：全仓 lint **0 errors / 70 warnings**、typecheck、6,123 项 provenance、1,812 实装包 license 基础检查均通过。继承 19 项严格发行材料差额未豁免。
- `native/report.json` 与 `native/screenshots/`：最终原生产品 **18 组操作 / 48 图**；原版 Agent 特有的 waiting、slash 合同仍仅在固定原版路径验收，不伪称 Pi 已实现。
- `packaged/pi-native-gui-report.json` 与相邻截图：真实 **win-unpacked exe** + 固定 Pi0.87 文本、read、Stop、同 JSONL 重启无重发、滚动锚点、文件标签/resize、双会话切换通过；pageErrors、filesystemBlocked、清理 survivors 为空。
- `checks/pi34-final-bundle-2.log`：完整 Windows x64 NSIS 构建、afterPack、运行时依赖校验、size audit 通过，**170.5 MiB < 500 MiB**，未签名。
- 本地安装包：`D:/Temp/pi34-final-bundle-2/Pi Agent IDE Preview-3.14.0-win-x64_TEST.exe`；SHA-256 `8DB6121A62215ADAC522289ECD4F63EDAD18925B4AB6A7339FC45750FF9ED829`。未执行安装/升级，不将直接运行 win-unpacked 说成安装验收。

重跑前原 bundle 失败进程已经退出；旧 asar 独立 list/extract 成功。旧日志 `D:/Temp/pi34-final-bundle.log` 的 0xC0000142 保留；新完整构建 exit0，没有修改/跳过打包门禁。冒烟启动等待真实窗口 show；原生模型 submenu 用键盘 ArrowRight；共用窗口 resize 绑定被测 renderer，而非碰巧可见的窗口。所有失败与修复经过见 [恢复记录](../resume-2026-09-24.md)。

全部模型端点为隔离 loopback 确定性 HTTP 服务，不是在线供应商推理；Pi 真实进程实际执行工具。截图采集/DOM 操作不替代独立视觉复核。**尚无本轮绿色 Windows CI或独立 Standards/Spec PASS，不合并、不关闭 #34、不推进后续票。**
