# 新上下文：原生 ZCode 底座验收与用户关卡

## 最新实施状态（2026-09-22，优先于下方初始指令快照）

- Claude 导入提交 `317d286` 后的修复在独立工作树 `C:\Users\niilo\AppData\Local\Temp\opencode\pi-native-32`，分支 `issue-32-native-zcode-fix`。原桌面目录的未提交报告/生成物仍保留，不覆盖。
- 冻结依赖及原生生产构建已通过，无Vite降级；原版19组、产品18组实际Electron操作通过，已收集26对截图。
- 已完成品牌/厂商服务边界、原生CI/来源字节修复、类型与测试边界、只读内建配置缓存修复。实际测试与剩余限制看 `issue-32-acceptance.md`，不要继续使用旧 report 的勾选或旧失败诊断作为当前结果。
- #32 和关联修复 #36 等独立审查及最终CI后合并；#33仍等待用户对实际版本明确确认；#34未开始。状态以最新GitHub评论/PR为准。
- 待呈现材料：`docs/delivery/issue-32-parity/index.html`；构建后预览命令 `node scripts/start-native-preview.mjs`，独立profile，原Agent仅作UI对照。
- 继承的19项发行许可材料缺口仍记录，完整安装/升级、物理IME、会话拆分及Pi能力不是本轮已通过项；后续按#5/#26/#27/#28完成。
- 下一步：完成#32两轴审查、Windows CI和PR，展示真实图集/预览，记录用户#33确认；没有明确确认不进入#34。

## 初始路线快照（历史，最新状态见上）

- 项目：`C:\Users\niilo\Desktop\pi-agent-gui`；仓库：`axgiroud312-byte/pi-agent-gui`。
- 主规格 [#1](https://github.com/axgiroud312-byte/pi-agent-gui/issues/1) 已改为“ZCode 原生工作台 + Pi RPC”。2026-09-22 两轮 grill-with-docs 的七项决定已确认，见产品目标；不要重新解释成风格参考。
- 产品代码仍为旧基础 `46c34f18011030024225cf71fd3e829dc31a57b4`（PR #31，#2/#30 CLOSED）。本轮只更新规格、任务依赖和文档，没有导入 ZCode 或修改产品代码。
- [#32](https://github.com/axgiroud312-byte/pi-agent-gui/issues/32) 已重写为原生工程导入/实际对照，OPEN、无阻塞；旧同号样式分支不满足它的新条件。
- [#33](https://github.com/axgiroud312-byte/pi-agent-gui/issues/33) 是用户实际界面确认关卡，OPEN、ready-for-human，blocked by #32。**没有用户确认链接。**
- [#34](https://github.com/axgiroud312-byte/pi-agent-gui/issues/34) 是原生服务到 Pi 的最小闭环，blocked by #33；原能力票继续阻塞于 #34 或其后续任务。
- 所有旧功能 worktree/提交都已保留，详情和已知真实验收差额见 `reuse-inventory.md`。未集成分支不自动合并；`integration/first-release` 旧整合路线停止。

## 首次读取与核对

1. 读 `AGENTS.md`、`docs/product-goal.md`、`CONTEXT.md`、`docs/adr/0001-native-zcode-base.md`、`CONTRIBUTING.md`。
2. 按 `docs/agents/` 读取 tracker/domain/标签约定，再读 `docs/delivery/native-rebase-plan.md`、`native-ui-parity.md`、`reuse-inventory.md`、`coverage.md` 与 `docs/references/upstream-and-ui.md`。
3. 用 Git/gh 核对最新分支、未提交改动、worktree、#1/#32/#33 的正文和评论、现有 PR。保留陌生改动。路线文档以最新合并版本和 GitHub 为准，不凭旧会话报告推断已通过。
4. 确认 #33 没有新用户确认后，只领取 #32。新建一个明确的新导入分支，如 `issue-32-native-zcode-import`，不要在旧 `issue-32-zcode-workbench` 上继续拼样式。

## 可直接复制的执行指令

```text
在 C:\Users\niilo\Desktop\pi-agent-gui，按 Matt 工作流执行 Pi Agent IDE 的新路线。
GitHub: axgiroud312-byte/pi-agent-gui；主规格 #1。

先读取 AGENTS.md、docs/product-goal.md、CONTEXT.md、CONTRIBUTING.md、
docs/adr/0001-native-zcode-base.md、docs/agents/、
docs/references/upstream-and-ui.md，以及 docs/delivery/ 下的
next-context.md、native-rebase-plan.md、native-ui-parity.md、reuse-inventory.md、coverage.md。
再读取 GitHub #1、#32、#33 最新正文/评论、当前 PR 和本地 git/worktree 状态。

已确定路线：以固定 zai-org/ZCode@872ad960de7ec172591f7e1952f7849229f94521
的原生完整工程为底座，保留原生 Electron、UI组件、Lexical输入框、时间线、
布局/会话状态、平台接口和可复用文件/Git/终端等宿主服务。
允许替换旧自建工程结构；不要把旧 assistant-ui/shadcn 工作台或旧 #32 样式分支
当作原生底座。保留所有旧分支和提交，Pi模块与测试以后按需迁入。

本次执行到明确检查点为止：
1. 领取并完成 #32：导入固定原生源码、保留许可证/NOTICE/来源，按真实脚本安装、构建和运行。
2. 在隔离数据目录运行原版与产品副本，保留原生布局、面板行为和操作路径。
3. 更换产品品牌，按已确认清单处理厂商产品账户/订阅/充值/团队/云服务等入口；
   Pi支持的provider认证、通用MCP/资源/分享等仍在完整范围，不因基础RPC缺口删除。
4. 按 native-ui-parity.md 产出原版/产品同状态截图、操作步骤或录像、差异清单、
   可启动版本和实际检查结果；关键视口1280×800、1920×1080，明暗主题。
5. 审查全部变更、修复问题、提交推送并完成PR/CI，证据回写 #32/#33。
6. 在 #33 暂停，明确请我确认实际原生界面。没有我的明确确认，不能关闭 #33，
   不能开始 #34、Pi后端替换或继续合并旧功能批次。

原ZCode Agent仅可用于隔离的原版交互对照；不能把其行为说成Pi已实现。
我确认 #33 后，再按 #34 → 现有能力票 → #28 的依赖顺序自动完成：
在原生Agent服务边界适配Pi RPC0.87.0，最终Agent执行只走Pi，不暗中回退原引擎。
84条故事、P01–P34、I01–I18、T01–T20全量保留，分阶段只是顺序。

授权沿用：可维护Issues/标签/原生依赖、独立分支/worktree、提交/推送/PR，
必要检查和独立Standards/Spec审查通过后可合并；允许依赖内并行subagents，主Agent集成。
本次并行范围限原生导入与基线取证，不能绕过 #33。
普通问题自行解决；外部凭据/设备缺失具体列出并保持验收开启。
只报告实际运行结果；不要通过改验收条件或mock-only页面宣称完成。
```

## 后续上下文的记录要求

中断前更新当前分支/提交、实际启动产物、原版对照状态、未解故障、用户关卡是否确认及下一条具体命令。代码迁移以清单中固定提交为来源，旧临时 worktree 不作为唯一资料。

## 本轮已经做过的核对

- 主规格 84 用户故事与 P/I 矩阵在更新前后逐字比对保持一致；20 个 T 场景保留，T19 增加硬性交互对照。
- 任务清单覆盖 52 能力/84 故事/20 场景，排除旧基础及总验收票后仍完整；依赖拓扑无环。
- 未运行原版 ZCode、未进行原生迁移构建、未新增实机验收；旧测试/模型结果仅作复用记录。
