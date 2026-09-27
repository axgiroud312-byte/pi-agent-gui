# 后续任务一次性开发执行文档

更新：2026-09-23。适用：把本文件交给后续 Agent，连续完成 **#34 → #3–#27 → #28**，交付主规格#1的完整首版。分阶段只决定依赖顺序；可以跨多次上下文接续，不缩减范围、不以最小演示结束。

## 1. 开发起点与终点

- 仓库：[axgiroud312-byte/pi-agent-gui](https://github.com/axgiroud312-byte/pi-agent-gui)。验收权威：[Issue #1 最新正文与评论](https://github.com/axgiroud312-byte/pi-agent-gui/issues/1)，以及各实施票最新验收条目。
- 原生导入 PR #37 已合并，产品底座主线提交为 `59362a37f044157a17b49950dc46b33c4d83842b`；从包含它的**最新 `origin/main`**开始。
- **#33 已由用户确认并关闭**：[确认记录](native-ui-confirmation.md)。#32/#36也已关闭。当前代码尚未接入Pi，下一票是#34。
- 全量目标：**84条用户故事、34项Pi能力、18项IDE能力、20个验收场景**。详细定义只维护在#1；任务映射见 [coverage.md](coverage.md) / [tickets.json](tickets.json)。
- 完成终点：全部实施票取得真实证据并合并，#28跨模块/真实环境/发行验收通过，代码及可定位的Windows产物已发布交付，覆盖账本完整，才关闭#1。

已确认的原生UI及87项回归、26对截图是阶段0基线，详见 [#32验收](issue-32-acceptance.md)。它们证明底座可用，不代表后续Pi能力已经完成。

## 2. 开始执行：先建立正确工作树

1. 读根 `AGENTS.md`、`CONTEXT.md`、`CONTRIBUTING.md`，以及 `docs/agents/` 的tracker/domain/标签约定、[产品目标](../product-goal.md)、[ADR0001](../adr/0001-native-zcode-base.md)。
2. 核对Git状态、worktree、remote和GitHub #1/#33/#34的正文/评论。主目录曾停在旧 `issue-32-native-zcode-import@317d286` 且有未提交报告/生成物；保留它们，在最新主线创建独立干净worktree。已有旧功能分支也保留。
3. 确认#33 CLOSED且其评论指向实际版本；该关卡已有明确用户批准，按记录继续，无需重复询问。
4. 运行只读计划校验，取得GitHub实时依赖前沿；若图或Coverage漂移，按最新规格核对并同步本地索引，再领取任务。

在正确仓库/工作树运行（PowerShell；工具调用使用 `workdir`，Git跨目录操作可用 `git -C`）：

```powershell
git status --short
git worktree list
git fetch origin main
git merge-base --is-ancestor 59362a37f044157a17b49950dc46b33c4d83842b origin/main
gh issue view 1 --repo axgiroud312-byte/pi-agent-gui --comments
gh issue view 33 --repo axgiroud312-byte/pi-agent-gui --comments
gh issue view 34 --repo axgiroud312-byte/pi-agent-gui --comments
node scripts/check-delivery-plan.mjs --github
```

新工作树的推荐分支为 `issue-34-native-pi-runtime`；若已存在，先调查现有进度再恢复。先检查父目录和分支是否存在，保留现有工作。版本/安装入口读取仓库实际 `mise.toml`、`package.json` 和锁文件；基线是Node24.14.0、pnpm10.33.2、Electron41.0.3。采用冻结pnpm安装，不从旧npm原型启动。

**开始条件：** 正确原生主线、关卡已通过、工作树归属清楚，所领Issue的原生阻塞项均已关闭。

## 3. 先完整完成 #34，建立后续统一边界

阅读 [#34](https://github.com/axgiroud312-byte/pi-agent-gui/issues/34) 的全部验收，核对 [固定上游与RPC来源](../references/upstream-and-ui.md) 和 [旧成果复用清单](reuse-inventory.md)。Pi固定 `@earendil-works/pi-coding-agent@0.87.0` / `16787ad5b2dc748047f314ca1bfe7708f30f54f3`。

### 实施顺序

1. **追踪原生调用链。** 从 `packages/desktop/src/renderer/src/main.tsx`、`packages/services/src/accessor.ts`、`packages/services/src/zcode-agent/` 与原生session订阅定位服务接缝；核对当前代码后确定实现位置。保留原生Lexical、时间线、pane/state及平台接口。
2. **写清适配合同。** 明确原生命令确认、snapshot/delta、session index、epoch/cursor如何投影Pi事实；Pi负责loop、工具、会话历史、队列、重试和压缩，IDE只管理工作区/布局/草稿/任务关联等元数据。
3. **接入真实Pi进程。** 复用已核验的JSONL/主管/错误恢复资产，适配原生服务；每活动会话独立进程、generation、单写者所有权。能力桥保持版本与关联ID。模块迁入边界、来源及许可证与代码同提交。
4. **打通用户路径。** 原生界面创建会话→文本流→一次真实工具→完整停止→读取/恢复Pi原生历史；至少两个实际Pi会话进程隔离。对照已确认UI，登记必要差异。
5. **明确存储和生命周期。** 遵循下方数据合同；处理接受/完成、取消、异常输出、背压、退出、重连与迟到事件。重连先查实际状态，不重放副作用。
6. **切换可启动产品并验证。** 产品Agent请求只由Pi执行，禁用隐式旧引擎fallback。原生ZCode Agent对照保留在显式隔离的参考流程；原类型/投影代码按前端实际依赖保留。

### #34 必须保住的合同

| 接缝 | 验收重点 |
| --- | --- |
| JSONL进程 | UTF-8分块、LF/CRLF、异常stdout/stderr、请求关联、单写者、背压、进程退出结算 |
| 原生状态投影 | `prompt`响应仅表示接受；运行以真实`agent_settled`判定；retry/compaction/扩展无Run均有正确状态 |
| 消息/工具 | 按contentIndex累积，message_end权威校正；累计partialResult替换；未知数据可查看 |
| 队列/停止 | Pi为队列权威；停止清理待定交互/队列并终止相关执行，不把第二调度器放进renderer |
| 会话/历史 | 原生session/entry/request/tool/task ID分清；cancelled保持状态，切换/reload重新绑定，丢弃旧generation |
| 进程/执行目标 | 单会话失败只影响所属会话；工作区、profile、cwd和本地/WSL/SSH语义保留可扩展边界 |

完整方法/事件以固定版本实际类型与行为为准；上述表是高风险检查索引，不取代#1/#34的全部验收。

**#34结束条件：** 原生GUI→真实宿主适配→固定Pi的合同和实机链路均通过，产品无旧Agent回退，后续模块接缝及构建/包路径写清，原生对照、独立Standards/Spec审查和Windows CI通过，PR合并并关闭#34。随后自动领取解除阻塞的能力票。

## 4. 剩余27张任务执行索引

下表为2026-09-23的规格/依赖快照；每张票实施前仍读取GitHub最新正文、评论和原生阻塞关系。它是导航，**右栏不是对完整验收条目的替代**。`#33（已完成）`表示该依赖已满足。

| Issue | 用户可见结果 | 直接前置 | 关闭前的关键证据 |
| --- | --- | --- | --- |
| #34 | 原生服务接Pi真实闭环 | #33（已完成） | 文本/工具/停止/历史、两进程隔离、无旧Agentfallback |
| #3 | 完整消息、图片、thinking、重试压缩 | #34 | 真实图片/工具/模型切换及压缩；流式与最终历史一致 |
| #4 | 双队列、完整停止、上下文shell | #34 | 消费竞态、附件取回、停止不续接、真实shell上下文差异 |
| #5 | 多工作区、四会话、分栏与恢复 | #34 | 四真实进程交错隔离、标签拖拽/分栏/恢复、草稿不丢失 |
| #6 | 版本化树/书签/工具/重载桥 | #34 | Pi active leaf/entry真实变化，reload后旧context失效 |
| #7 | API key与OAuth认证管理 | #34 | 登录/取消/刷新/登出；至少真实API key及订阅OAuth闭环 |
| #8 | 同一RPC会话的TUI兼容纵切 | #34 | custom/editor交互影响同一PID/session，补丁可重建 |
| #9 | 历史目录、分支、导入导出分享 | #6、#5 | CLI→GUI→CLI续接，fork/clone/tree/取消及真实导出/分享 |
| #10 | 完整分层设置/provider/profiles | #7、#6 | 真实生效值、未知字段/JSONC/并发修改、trust和动态目录 |
| #11 | llama.cpp router模型管理 | #7 | 真实加载/推理/卸载，下载/取消与router状态一致 |
| #12 | Skills/模板/上下文/包/热重载 | #6、#10 | npm/Git/local资源生命周期及真实Pi加载调用 |
| #13 | 全RPC扩展交互及工具/生命周期 | #6、#3、#4 | 四类对话、全部fire-and-forget、并发/取消/未知工具 |
| #14 | 真实文件树、多标签编辑和冲突 | #34 | 中文/空格/长路径、磁盘版本校验、草稿冲突和引用 |
| #15 | 搜索替换与TS/JS、JSON、Python LSP | #14 | 真实语言服务的声明能力、大目录取消及替换冲突 |
| #16 | ConPTY多终端、后台命令/CLI profiles | #34 | 真PTY输入/resize/取消/隔离；打包后native ABI可用 |
| #17 | 开发服务、隔离预览与截图上下文 | #16、#14 | 真实服务启动/重启、预览隔离、截图进入Pi |
| #18 | Git Diff、评论、提交同步和冲突 | #14 | 真Git索引/dirty tree/行级操作、bare remote同步与冲突 |
| #19 | worktree及GitHub开发闭环 | #18、#5 | 真实分支/worktree生命周期、Issue→会话→PR/reviews/checks |
| #20 | Pi Plan扩展、待办与产物 | #13 | 工具集实际变化，状态/产物持久化，可关闭扩展 |
| #21 | 真实串并行子Agent与汇总 | #20、#19、#4 | 两并行/一串行真实执行、取消/崩溃隔离、来源与用量 |
| #22 | MCP stdio/HTTP、OAuth及重连 | #13、#7 | 真MCP工具/resources/prompts、取消/刷新、不重放副作用 |
| #23 | WSL/SSH目标侧主管与恢复 | #5、#16、#18、#17、#7 | 两类真实目标的文件/Git/PTY/Pi/端口、断线重连与目标认证 |
| #24 | 持久后台/定时任务与通知 | #20、#5、#4 | 幂等触发、休眠/退出/断线策略、实际后台运行与通知 |
| #25 | 全部公开扩展UI/渲染器兼容 | #8、#13、#10 | 固定ExtensionUIContext逐类别样例、同session、reload清理 |
| #26 | 中文/键盘/主题/无障碍/性能 | #3、#5、#14、#16、#13、#12、#20、#18 | 物理IME/焦点、关键视口对照；1万消息+4会话真实p95 |
| #27 | Windows安装/升级/回退/迁移诊断 | #5、#16、#10 | 实机安装生命周期、native PTY、数据恢复、严格发行材料 |
| #28 | 完整首版发布验收 | #3、#4、#9、#10、#11、#12、#13、#15、#17、#19、#21、#22、#23、#24、#25、#26、#27 | 所有P/I/US/T逐项证据、真实环境、最终包与文档一致 |

拓扑参考批次（同批可在边界清楚、环境允许时并行）：

1. #34。
2. #3、#4、#5、#6、#7、#8、#14、#16。
3. #9、#10、#11、#13、#15、#17、#18。
4. #12、#19、#20、#22、#23、#25、#27。
5. #21、#24、#26。
6. #28，然后核对并关闭#1。

调度按**各自前置实际关闭**推进，无需等待整批所有无关票结束。#26/#27与后续功能仍可能交叉；#28负责对最终集成版本复验，早期局部通过不是最终发行通过。

## 5. 每张票都执行同一个交付循环

1. **领取：** 读取Issue/评论/父规格/阻塞项；记录分支、基线、验收和责任边界。只领取前置已关闭的票。
2. **核对复用：** 先查原生模块是否已满足目标，再按 [reuse-inventory.md](reuse-inventory.md) 的固定提交迁入必要Pi/宿主逻辑与测试。旧分支本地完成不等于新链路完成。
3. **实现：** 在既有原生接口接入，先定义行为合同与必要失败场景。会改变共享入口/协议的票由主Agent统一整合，独立子任务使用独立worktree。
4. **验证：** 聚焦真实边界回归，再执行相关原生检查/GUI操作及所需真实环境；保留失败原因、命令、版本和截图。行为、界面、真实供应商验收分别记录。
5. **审查：** 对PR merge-base到HEAD的全部变更做独立Standards/Spec两轴审查；修复后复审。每个并行成果集成后重新验证。
6. **交付：** 只提交预期文件，推送并创建关联Issue的PR；最新HEAD所需CI全部通过后合并。回写实际证据、覆盖账本和任务状态，然后立即领取下一项就绪票。

普通实现选择自行解决，不逐票询问“是否继续”。未通过的行为/检查保持未完成；新增缺陷创建关联修复票并维护依赖，不以改验收、空成功或测试跳过消除问题。

### 并行与上下文恢复

- #34先建立稳定接缝，再并行独立能力；共享store、service注册、preload、协议、配置和依赖变更明确单一整合者。
- 并行审阅者读取完整PR基线，主Agent负责整合、修复与复验。测试涉及Electron、资源准备或native模块时控制并发，保护其他开发进程。
- 每次中断前更新 [next-context.md](next-context.md)、[execution-log.md](execution-log.md) 和相关Issue：当前commit/worktree、实际检查、待解发现/外部条件、精确下一步。分支/模块来源固定到Git提交，临时目录不能成为唯一资料。
- 下一上下文恢复同一交付循环；达到可演示、完成一批或上下文不足都不是完整首版完成条件。

## 6. 数据、界面与兼容边界

### 应用数据与Pi数据

先读 [desktop-profile-contract.md](desktop-profile-contract.md)。生产入口先选择应用profile，再加载split main；执行HOME/USERPROFILE保持原生。应用设置/资源与原生Agent历史的稳定锚点，和可迁移v2数据根，已经分别验证。

接Pi时，**Pi认证/原生会话/资源属于实际执行目标及用户选择的Pi profile**，需要按P17/P18保证CLI互通；不能因桌面隔离就把用户Pi配置默默移进GUI私有目录。工作区本地资源、外部`.agents`、Git、SSH和终端仍按原来的执行HOME解析。迁移保留备份、未知字段与凭据可用性，建立新链路回归。

### 原生界面

沿用已确认布局、Lexical、时间线、菜单、设置、文件/Git/终端面板和用户路径；Pi特有入口优先放原生菜单/输入区/详情/Side Pane。按 [native-ui-parity.md](native-ui-parity.md) 在同视口/主题/状态取证并登记必要差异。既定关卡无需重过；改变已确认方向或缩减范围时才提交用户决策。

### 兼容层

优先固定Pi公开RPC/扩展API；树写操作、认证、TUI使用已验证资产并重新验收。TUI组件工厂与交互结果留在同一Pi进程/session；固定补丁记录来源/版本/许可证并可重建。严格tui guard的第三方扩展明确适配；P27以公开方法类别及代表样例逐项验收。

## 7. 检查与证据入口

当前执行依据是实际 `package.json`、各包 `AGENTS.md` 和 [.github/workflows/ci.yml](../../.github/workflows/ci.yml)。脚本随实现变化时同步CI/文档，不沿用旧npm结果。以下为本轮已验证的导航：

| 类型 | 当前入口及注意事项 |
| --- | --- |
| 覆盖与依赖 | `node scripts/check-delivery-plan.mjs`；加`--github`只读核对30张管理票、原生依赖和本执行表。归档的旧publisher不是当前入口 |
| 类型/静态 | `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check`；涉及CLI另跑`pnpm exec pnpm --dir apps/zcode-cli typecheck --concurrency=1` |
| CLI样式 | `node scripts/check-native-cli-lint.mjs`及17项回归，规则见[native-cli-lint-policy.md](native-cli-lint-policy.md)。现有86个上游max-lines不是clean；新增错误/增长/抑制仍失败 |
| 生产构建 | 冻结pnpm安装后按CI的原生资源、metadata、清理、tsup、Vite顺序；低内存串行，类型检查已验证4GiB heap |
| 真实桌面 | `node scripts/native-desktop-smoke.mjs`是阶段0原生Agent对照；#34新增/演进产品Pi-E2E，显式区分参考与产品执行。`node packages/desktop/test/production-profile-entry.mjs --app-root packages/desktop`继续验证真实分包入口 |
| 来源/发行 | `node scripts/check-native-provenance.mjs`、`node scripts/licenses.mjs check`；发行前要求`node scripts/licenses.mjs check --strict`及与真实打包内容一致 |

最高验收边界为原生GUI→真实宿主/服务适配→Pi外部进程。可控模型/协议端点验证确定性行为；“真实Pi进程+确定性provider”和“真实供应商模型”分开报告。文件/Git/PTY/LSP用真实临时项目和程序；产品链路不靠内部UI/store注入来构造成功。

每票证据至少包含：产品/上游commit与版本、命令和真实结果、P/I/US/T对应行、GUI操作与截图、真实环境/离线分类、发现及修复、PR/CI链接。原生基线截图保留用于复验；阶段0的原Agent输出不计作Pi通过。

## 8. 已知差额与外部条件

| 差额或条件 | 对应任务与处理 |
| --- | --- |
| 固定原版会话split入口未启用 | #5补齐I02，原生位置最小增补并验收四会话分栏；#33确认不等于该能力完成 |
| 物理Windows IME、长历史/四会话性能 | #26实测；自动composition不替代物理候选窗口。性能按#1排除provider网络时间并记录机器/构建 |
| 19项继承发行材料缺口 | #27/#28按`third-party/inventory.json`与`third-party/README.md`逐项补齐/核验，严格发行检查通过后才能声明完整发布 |
| 真实API key/OAuth及模型图片/压缩 | #3/#7/#10/#28复验新链路；使用安全配置入口，不把密钥写入Issue/日志；旧模型成功记录只是参考 |
| llama.cpp模型、外部MCP、WSL/SSH、GitHub | #11/#19/#22/#23/#28及其交叉场景准备真实环境，不将可控端点代为完成 |
| 安装升级回退、PTY、后台/通知 | #16/#24/#27/#28在真实Windows产物上验证 |

执行早期检查环境可用性；只有确实需要用户操作的登录/设备/范围决定才提具体请求，并继续不依赖该条件的任务。把缺失条件、对应验收、已完成部分及恢复命令留在Issue中；真实验收不完整时保持该票及#28/#1开启。

## 9. 最终收口：#28 → #1

逐行核对52项能力、84故事、20场景都有实施Issue、合并PR、真实支持路径和最终集成版本证据；包括真实Pi文本/图片/文件读写/shell/停止/历史/树/扩展/provider/reload，以及OAuth/llama/MCP/GitHub/WSL/SSH。

复验Windows安装、使用、升级、回退、卸载和恢复，原生PTY及发行材料与包一致；补齐性能/IME/键盘/无障碍和原生交互对照。最终文档、快捷键、版本、来源、诊断、下载产物和提交相互对应。所有审查发现、CI失败及必需外部验收已解决，才能关闭#28与#1。

## 10. 可直接复制给后续 Agent 的指令

```text
在 axgiroud312-byte/pi-agent-gui 执行完整首版的剩余开发。
先读取最新主线 docs/delivery/full-development.md 和 next-context.md，
并按 AGENTS.md 读取产品目标、领域、tracker、来源、复用与原生验收文档。

#32/#36已合并完成；用户已明确确认实际原生界面，#33已关闭。
确认记录：GitHub #33 issuecomment-5787163874；底座主线59362a3。
先核对GitHub最新状态和本地未提交内容，在正确独立worktree中继续。

从#34开始，沿实际原生依赖完成#3–#27，再完成#28及父规格#1。
保留84故事、P01–P34、I01–I18、T01–T20完整范围。
保留已确认ZCode原生UI/状态/交互，在服务边界接Pi0.87.0；
Pi为Agent/工具/历史/队列权威，产品没有原引擎隐式回退。
旧资产只按固定提交选择迁入，在新原生链路重新验收。

使用已有授权维护Issue和依赖、独立分支/worktree、提交推送、PR；
接口稳定后可依赖内并行subagents，主Agent整合并复验。
每票按完整PR基线做独立Standards/Spec审查，修复且CI通过后合并、
回写证据并自动领取下一项就绪任务，不逐票问是否继续。

普通问题自行调查解决；缺少必要账户/设备或确需改变范围时提出具体请求，
同时继续不依赖该条件的工作，未验收的项目保持开启。
只记录实际结果；真实Pi、确定性provider、真实供应商及Windows实机证据分开。
跨上下文时更新恢复入口和Issue，保持同一目标继续，直到最终验收完整交付。
```

建议技能：实施票用`implement`；收到PR反馈时用`gh-address-comments`；GitHub CI失败时按`gh-fix-ci`适用流程；跨上下文用`handoff`；只有遇到新的领域/架构决定才用`domain-modeling`。按实际可用技能及其说明选择，已有规格/票无需重新拆票。
