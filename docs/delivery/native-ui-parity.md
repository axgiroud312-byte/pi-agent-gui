# 原生 ZCode 界面与交互验收

> 2026-09-27：本页的界面对照方法继续有效，应用于 [当前范围](pi-first-scope.md) 中的功能；不因原生存在入口恢复额外 IDE/远程要求。远程 CI 已取消，以 CONTRIBUTING 的本地验证规则覆盖历史 CI 门槛。

> 2026-09-27 #34 更新：当前 production output 的 48 张截图与固定原版 26 张图已经独立目视复核，PI34-S1 提示和当前会话标题已核实。本页下方的“视觉待完成”“重启标题回归”是历史停点，现状以 [本轮收尾与验收报告](issue-34-closeout/closeout-2026-09-27.md) 为准。这里只更新 #34，不表示全部后续能力通过。

基线：`zai-org/ZCode@872ad960de7ec172591f7e1952f7849229f94521`。**原版和产品底座已真实运行，26对截图及操作见[本轮验收](issue-32-acceptance.md)；用户于2026-09-23确认实际界面，#33已关闭，见[确认记录](native-ui-confirmation.md)。** 以下标准继续用于后续Pi适配复验。

## 操作方法

1. 在独立数据目录实际启动原版 ZCode；记录源码提交、构建命令、运行平台、主题、缩放、字体、数据规模及执行环境。账户、模型和运行记录属于哪个应用必须明确。
2. 在新产品副本执行同一用户操作，记录入口 → 步骤 → 可见反馈 → 返回/取消/错误/恢复；标注由原 Agent 对照还是 Pi 产品执行。
3. 在 1280×800 与 1920×1080、明暗主题下，采集同一状态的原版/产品截图。时间、路径和真实动态内容可标记排除区域，不能掩盖结构性差异。
4. 每项差异分类为品牌、获准厂商排除、Pi 真实语义差异或缺陷；关联理由、源码、Issue、验证。仅有产品自身截图或 DESIGN.md 数值对照不算运行基线。
5. 第一个关卡提交成对截图和操作记录供用户确认。没有明确确认评论时保持关卡开启；自动测试或旧 #32 的截图不能代签。

## 必查交互面

| 交互面 | 原生保留内容 | 阶段 0 / 最终记录 |
| --- | --- | --- |
| 窗口与工作台 | 窗口框架、侧栏、会话 frame、Side Pane、底部终端、间距及拖拽分隔条 | 双视口/明暗主题运行对照已建立 / Pi后复验 |
| 工作区/任务/会话 | 新建、选择、命名、切换、列表组织、右键菜单、状态及多任务关系 | 工作区/任务导航与菜单已记录 / 全量复验待完成 |
| 标签与分栏 | 新分栏、拖动、关闭、焦点、布局保存/恢复 | Side Pane拖动/resize已验；原版会话split未启用 / #5补齐复验 |
| 输入框 | 原生 Lexical 输入、IME、换行/发送、草稿、附件、@引用、/命令、模型/thinking/mode 控件 | Lexical/合成输入/换行/@/命令已记录 / 图片、物理IME和Pi控件待验 |
| 会话时间线 | 用户/助手消息、Markdown/代码、thinking、工具行、展开/收起、滚动锚点、返回最新 | 文本/代码/Read工具展开已记录 / Pi完整消息待验 |
| 运行与交互 | 已接收、执行、排队、停止、等待、重试、压缩、失败恢复；Pi 差异有依据 | 原Agent运行/等待/错误/停止已记录 / Pi队列与恢复语义待验 |
| 文件与编辑/预览 | 文件树、打开方式、tabs、定位/选择/引用、保存/冲突、预览切换 | 原生文件预览/引用已记录 / 编辑保存冲突待验 |
| 终端 | 打开/切换/resize/关闭、后台命令、复制/引用输出、环境标识 | 真PTY及resize已记录 / 多终端、打包和远端待验 |
| Git 与交付 | 状态、Diff、评论、stage/commit、分支/worktree、Issues/PR/checks 入口 | 临时Git工作区用于对照 / 完整Git/GitHub闭环待验 |
| 设置与资源 | 原生导航/布局、认证/model、主题/密度/字号、资源目录与错误 | 设置、通用模型模板和主题已记录 / Pi认证与资源范围待验 |
| 键盘与反馈 | 快捷键、命令面板、焦点返回、菜单关闭、tooltip、状态文案及辅助提示 | 输入焦点/Escape/命令搜索已记录 / 全键盘与无障碍待验 |

阶段 0 只要求忠实运行并记录原生体验，不能把原 Agent 的执行计为 Pi 能力通过；后端替换后按相同用户路径复验全部范围。

## 差异登记模板

| ID | 原生入口/行为及证据 | 产品入口/行为及证据 | 分类与必要性 | 关联能力/Issue | 状态 |
| --- | --- | --- | --- | --- | --- |
| 示例（非验收记录） | 原版厂商 Coding Plan 入口 | 依已确认范围移除 | 厂商商业服务；通用模型认证保留 | P18/P19/P31 | 待实施验证 |

默认布局、组件、打开方式、操作顺序和反馈保留原版。确有 Pi 特有需求时，优先复用已有菜单、详情、设置或 Side Pane；原生工具没有通用审批时，不制造一个“授权成功”流程。功能缺失不得以差异登记绕过 #1。

## #6 Pi 会话树入口（增量，视觉待验）

| ID | 原生入口/行为 | Pi 产品行为 | 必要性 / 状态 |
| --- | --- | --- | --- |
| PI06-S1 | 原生会话 pane 的悬浮操作与 Lexical 输入框 | 同一 pane 左上原有悬浮操作区新增会话树按钮；弹窗显示 Pi RPC 的真实树、当前叶子及书签，可跳转并将可恢复文本交给原生 composer，也可重载扩展 | Pi 的树及书签是 #6 明确能力；保留 `SessionPane`、原生 Dialog/Button、composer 草稿通路。固定 Pi 0.87.0 的 bridge/service 自动测试及隔离原生 GUI→Host→Pi 专项操作通过，`D:/Temp/pi-auth-tree-gui-evidence-3/pi-tree-gui-report.json` 记录书签、换代与文本恢复且进程无残留。固定原版成对截图、双视口/明暗主题及键盘焦点仍待完整复验。 |

该入口只在本地桌面活动会话显示。Pi 0.87.0 的公共树跳转不返回图片附件原始草稿；包含图片的用户输入在跳转前明确拒绝，以免形成文本成功而图片丢失。树弹窗是 Pi 特有的必要入口，不代替 #9 的完整历史管理或 fork/clone。

## #9 Pi 临时会话入口（增量，待同状态原版对照）

| ID | 原生入口/行为 | Pi 产品行为 | 必要性 / 状态 |
| --- | --- | --- | --- |
| PI09-T1 | 原生 ZCode 新任务 pane 的悬浮操作区、同一 Lexical 输入与会话列表 | 新任务悬浮操作区增加“临时会话”切换；首条消息仍走原生 composer 与 Pi RPC，但固定 Pi 0.87.0 以 `--no-session` 运行，活动会话在同一区域标记“临时 · 历史不落盘”。关闭后从会话列表移除，不能续接、导出或主动分享；未发送草稿仍遵循普通草稿保存规则 | #9/P17。隔离原生 GUI `D:/Temp/pi-temporary-session-gui-20260928-c/pi-temporary-session-gui-report.json` 完成真实模型一回合、零 JSONL、重启不恢复与两次无残留退出；`temporary-draft-selected.png`、`temporary-run.png` 为产品单侧截图。自定义存储、同状态原版成对截图、包内运行与最终人工验收待做。 |

保留原生 `SessionPane`、悬浮操作区和 composer；新增的是 Pi 特有存储选择与状态标识。临时会话的 Pi 历史只归固定 Pi 进程所有，不建立宿主代理消息历史或第二队列。Pi 退出后输入路由改为不可继续发送，并从会话索引移除。临时 Pi 会话不支持需要持久 JSONL 的 fork/clone、导出和分享；当前会话树按钮仍可查看进程内条目，触发保存型分支会由服务明确拒绝。未改变原版源码或引入旧自建界面。

## #3 Pi 模型搜索与用量增量（隔离切片，待 GUI 对照）

| ID | 原生入口/行为 | Pi 产品行为 | 必要性 / 状态 |
| --- | --- | --- | --- |
| PI03-M1 | 保留原生 ZCode `ModelConfigSelect` 的触发器、供应商分组、快捷键和关闭后焦点路径 | Pi 目录非空时在同一菜单顶部增设搜索框；按供应商、显示名和真实 model ID 过滤，不另存模型目录。模型目录仍取同一 Pi RPC `get_available_models`，选中模型与 thinking 等级仍取 Pi 当前会话；Pi 在压缩后报告有效上下文 token 为 `null` 时显示“未知”，不伪装为 0。相邻原生 Popover 显示 Pi 历史累计 token/cache 与估计 USD，费用不冒充供应商账单 | #3/P05/P06/P14/P15；复用仓库原生控件，未移植旧 `issue-3-rich-conversation` 界面。搜索、`null`/`0` 与费用投影红绿合同已过；`scripts/pi-model-thinking-gui-smoke.mjs` 的固定 Pi、1280×800 深色/1920×1080 浅色 GUI 尚待独占时段运行。原版同状态成对截图、在线 provider、包内运行及用户验收未完成。 |

2026-09-28 费用未知回归：Pi 未提供 `costUSD` 时，原实现连同已知 token/cache 一起隐藏整个用量入口；现在仍显示同一 Popover，费用明确标为未知。隔离 React 渲染测试先红后绿，原版同状态对照、固定 Pi GUI 和包内运行仍由最终统一版本复验。

## #7/#8 原生设置与扩展弹窗增量（待 GUI 对照）

| ID | 原生入口/行为 | Pi 产品行为 | 必要性 / 状态 |
| --- | --- | --- | --- |
| PI07-S1 | 原生 Settings 的模型提供商页及两栏设置布局 | 在同一页增设“Pi 认证”分段，保留原有模型配置入口；Pi 分段显示固定版本 provider、API key/OAuth 登录、回调/设备码、解析、目录刷新与登出，不显示保存的 key/token。同一 Pi RPC 会话的模型快照通过公开桥刷新 | #7/P18/P19；固定 Pi 服务/认证合同通过，在线账号与授权回调、原版成对 GUI 和包内运行未验证。旧模型配置与 Pi 认证的关系需在 #10 统一设置范围 |
| PI07-S2 | 同一原生 Settings 模型提供商页的错误反馈 | Pi 0.87.0 `ModelRuntime.getError()` 只以非秘密布尔状态提示目录/认证错误，原始异常、`models.json` 内容和密钥不进入 renderer；修复本地配置后使用原有“刷新目录”入口重新加载。OAuth 设备码在已有认证卡片显示 Pi 给出的到期时间，包括零秒即过期。 | #7/P18/P19/V06；固定 Pi 进程内红绿合同 6/6、真实 Pi 子进程 2/2；隔离原生 GUI `D:/Temp/pi-auth-recovery-gui-20260928-b/pi-auth-extension-gui-report.json` 已实测目录错误、修复、自定义 provider 复现和进程清理，产品截图 `pi-auth-catalog-error.png`。设备码从有效到过期的真实时钟 GUI 流程、原版同状态成对截图、在线账号和包内运行待验；不声称原版有 Pi 设备码。 |
| PI07-S3 | 同一原生 Settings 的 Pi 认证两栏目录与 provider 详情 | 增加当前 Pi RPC 子进程已注册扩展 provider 的只读行、实际配置状态和明确的登录限制；忙碌、无会话、桥不可用与目录超限分别提示。扩展覆盖内建 provider ID 时隐藏该内建认证入口；每次认证动作前重新检查同一 Pi 子进程，运行中或检查失败时拒绝认证，避免对错误的 provider 保存凭据；不为查目录再次运行扩展 factory | #7/P18/P19/V06；固定 Pi 0.87.0 同 PID、运行中、缺桥和晚注册覆盖合同通过。隔离原生 GUI 最初完整通过；新增动作前检查后两次复跑中动态 OAuth 行、没有伪造登录按钮、刷新不重复执行 factory、既有 API key 保存/登出均通过，进程无强杀或残留，但随后 `/pi-ui-sequence` 输入遇到命令目录无匹配而禁用发送，完整脚本尚未复绿。Pi 0.87.0 扩展 `ModelRegistry` 与 RPC 无公开登录/登出命令，动态 provider 的 GUI 认证仍未实现；在线账号、包内运行、原版成对截图和人工验收待做。 |
| PI10-S1 | 原生 Settings 的两栏导航、Pi 设置 JSON 编辑器与生效值详情 | 生效值按嵌套叶子路径分别显示“用户/项目”来源；Pi 0.87.0 只从用户设置读取的 `cacheWarming`、`defaultProjectTrust`、`httpProxy` 若出现在项目文件则提示未生效，原始 JSON 仍保留 | #10/P31/P32；固定版本源代码和纯合同测试已核对。此增量的生产入口 GUI、固定 Pi 子进程、成对截图和包内运行待顺序复验，不据此签署视觉或全字段验收。 |
| PI08-S1 | 原生 v4 userInput 弹窗 | Pi 扩展的选择、确认、单行输入和多行编辑复用同一原生弹窗路径，按交互 ID 重建、显示正文/占位符/预填，Stop/取消由 Pi 请求与会话状态决定 | #8/#13/#25/P27；固定 Pi 0.87.0 的同 PID 顺序合同通过，原生 GUI、包内与键盘/焦点待验。其余 UI 类别逐项见 [兼容表](pi-extension-ui-compatibility.md) |
| PI13-S1 | 原生会话底部信息区和既有会话树弹窗 | Pi RPC 的通知、状态、文本 widget、终端标题投影到同一 pane；扩展建议输入需显式应用，复用现有空草稿门禁。树弹窗增加真实 Pi 工具目录和启用状态的复选入口 | #13/P23/P26；固定 Pi 0.87.0 服务合同和隔离源码原生 GUI `D:/Temp/pi-extension-state-gui-20260927-d/pi-extension-state-gui-report.json` 通过，退出无进程残留。包内及原版成对截图未跑。组件 factory 等复杂 TUI 无 RPC 可序列化合同，边界见 [兼容表](pi-extension-ui-compatibility.md) |
| PI13-S2 | 原生 Read 文件 chip 与工具组 | 固定 Pi 同名扩展 `read` 覆盖时，保留原生文件 chip；在同一工具行加默认折叠的 Pi 真实结果，展开后显示扩展文字、图片、details 与错误，不把普通内建读取正文自动铺满时间线。 | #13/P23；固定 Pi/服务/UI 合同与 `D:/Temp/pi-read-override-gui-20260928-c/pi-read-override-gui-report.json` 通过；原版同状态成对截图、其他同名工具和包内 GUI 待验。 |

这些是 Pi 语义需要的内容替换或输入类别扩展，仍须按本页方法做同状态原版/产品截图与操作复核；不能仅凭单侧产品图签署最终 UI 一致性。

## #26 原生输入 IME 边界（隔离切片，待主分支整合）

| ID | 原生入口/行为 | Pi 产品行为 | 必要性 / 状态 |
| --- | --- | --- | --- |
| PI26-S1 | 保留原生 Lexical contenteditable、聊天 form 与 Enter 发送路径 | 仅在该 contenteditable 的 IME 组合、Chromium `keyCode=229` 或紧邻 `compositionend` 的候选确认 Enter 上阻断提交；不影响工具栏/弹窗 Enter，随后普通 Enter 和显式按钮仍向同一 Pi 会话发送原文 | #26/D03/D05/V12；纯逻辑红测后修复。最终隔离源码的生产入口 GUI `D:/Temp/pi-ime-gui-20260927-d/pi-ime-gui-report.json` 在 1280×800 深色、1920×1080 浅色以固定 Pi 0.87.0 验证候选确认不发送、草稿保留、普通 Enter/按钮各发一次及进程清理。物理中文输入法、原版成对截图与包内运行仍待验。 |
| PI26-S2 | 保留原生 v4 时间线、工具输出的五行内层滚动和返回最新按钮 | 滚轮在可滚动的 Pi bash 输出内时只改变输出位置，仍由 Pi 续流驱动时间线吸底；滚轮在时间线自身时保留阅读锚点，返回最新显式吸底 | #26/V12；内层滚轮红测后修复。`D:/Temp/pi-long-scroll-gui-20260927-e/pi-long-scroll-gui-report.json` 在固定 Pi 0.87.0 的 24 回合历史、120 行工具结果及 24 帧续流中验证两个滚动所有权，并在 1920×1080 浅色验证 Ctrl+M 模型菜单及 Escape 后 composer 焦点；进程清理无残留。原版成对截图、更大历史规模、其余焦点/快捷键及包内运行仍待验。 |
| PI26-S3 | Pi 扩展 userInput 沿用原生 Dialog、Button、Input 与 Textarea | select/confirm/input/editor 的初始焦点、反向 Tab、Escape 取消及 Ctrl+M 模型快捷键作用域由同一弹窗控制；关闭后回到仍可用的原生控件，最终 Pi 状态若禁用 composer 则回退模型或会话树按钮 | #26/P27/V09/V12；原实现的 select 初始焦点和最终 BODY 均由固定 Pi GUI 红测复现，修复后 `D:/Temp/pi-dialog-focus-gui-20260928-n/pi-dialog-focus-gui-report.json` 验证四类连续交互的键盘路径、Pi 回答值与 500ms 后稳定焦点，且进程无残留。此隔离基线的扩展命令仍进入 `noRun`，composer 为 `contenteditable=false`；回退焦点不修复会话状态，主分支对应语义修复后须复跑可编辑 composer 恢复。原版成对截图、更多扩展交互、包内 GUI 与用户验收仍待验。 |

这是原有输入框的事件门禁修复，没有更改布局、控件或原版代码。GUI 使用合成 composition 事件与真实键盘 Enter，不能代替用户机器上物理中文输入法的最终试用。

## #34 安全语义差异（2026-09-24）

| ID | 原生入口/行为 | Pi 产品行为 | 必要性 / 状态 |
| --- | --- | --- | --- |
| PI34-S1 | composer 的 Build 权限模式及“变更前确认”提示 | 同工具栏位置显示“Pi 工具直接执行”，提示当前没有逐项审批；取消无法兑现的模式选择 | Pi RPC 不提供原版审批合同，不能让用户误以为写入会先询问。固定原版隔离工程不修改；完整 Plan/授权仍未实现。新构建 native smoke 的 18 组操作/48 图通过，独立视觉复核仍待完成；远程 CI 要求已于 2026-09-27 取消。 |

源码：`packages/ui/src/v4/composer/V4ComposerModeControls.tsx`、`i18n/locales/{zh-CN,en-US}.ts`。本轮报告 `D:/Temp/pi34-final-native-smoke-3/report.json`；完整语义分流见 [#34 断言映射](issue-34-ci-acceptance-map.md)。其余原生路径的局部通过不抵消当前重启列表标题回归。

## #3/#4 Pi 队列与停止的必要差异（增量，未最终验收）

| ID | 原生入口/行为 | Pi 产品行为 | 必要性 / 状态 |
| --- | --- | --- | --- |
| PI04-S1 | 输入区运行时有草稿时，原控制簇显示“发送/加入队列”，Stop 按钮被替换 | 在同一原生控制簇并排显示 Stop 和发送；图文入队由固定 Pi 0.87.0 的版本化队列兼容补丁处理，不以清空草稿换取 Stop | 旧截图 `test-results/native-parity/product/pi-native-busy-image-refused.png` 是补丁前的防丢失状态，不代表当前验收。新生产入口 GUI 脚本 `scripts/pi-queue-gui-smoke.mjs` 已写，仍待独占运行和原版同状态对照。关联 #3/#4。 |
| PI04-S2 | 原生队列可单项编辑、删除、拖拽与继续 | 保留原生队列面板；Pi steering 和 followUp 的同一权威快照都在面板中提供编辑、删除、立即发送及各 lane 内重排。steering 仍在时间线显示待引导状态；面板行加“引导/队列”标识，跨 lane 拖拽不暗中改变发送语义。Stop 在 Pi 内暂停，重启后只保留图文恢复证据，不伪装为可执行队列 | `packages/ui/test/{pendingGuideProjection,queueReorder}.test.ts` 的红绿测试及固定 Pi 服务队列测试验证投影与队列协议；生产 GUI、原版同状态视觉和最终用户试用仍待验。旧只读队列截图是补丁前历史证据。 |

## #5 未发送图片草稿恢复差异（开发增量，未最终验收）

| ID | 原生入口/行为 | Pi 产品行为 | 必要性 / 状态 |
| --- | --- | --- | --- |
| PI05-S1 | 原生附件 chip、移除按钮和输入区位置 | 继续复用同一 chip；选图保存期间阻止发送，重启后在原位置恢复图片。损坏/未保存的单张图显示原生失败态，保留文件名 tooltip，可移除后继续 | 防止文字绕过尚未落盘的图片、修复未发送图重启丢失；无新增工具栏。生产入口桌面宿主、固定 Pi 与受控模型的红绿回归见 `scripts/pi-native-gui-smoke.mjs`。打包版与最终人工对照仍待验。关联 #3/#5。 |

## #14 原生 Side Pane 文件编辑入口（增量，未最终验收）

| ID | 原生入口/行为 | Pi 产品行为 | 必要性 / 状态 |
| --- | --- | --- | --- |
| PI14-F1 | 固定原版 Side Pane 文件预览、标签和外部编辑器入口；#32 已实际运行文件预览与标签操作 | 复用同一 Side Pane，在顶部现有操作区增设铅笔按钮；文本编辑仍在该文件标签内，原有预览/外部编辑器路径保留 | #14 / D04 要求必要编辑保存。受控固定 Pi GUI 的冲突、显式保存和重启草稿截图见 [#14 增量证据](issue-14-native-editor/README.md)。原版与产品编辑状态的同状态成对截图尚未完成，不能以产品截图代替最终原生一致性验收。 |
| PI14-F2 | 原生文件树、Markdown/图片 Side Pane 标签、二进制/大文件提示和输入框 `@` 文件选择器 | 保留这些原生入口；选择中文空格文件后，发送时把限定的文本/目录快照和图片原字节纳入同一 Pi 0.87.0 输入及 JSONL。用户消息默认收起附加快照，会话标题只用用户正文 | #14 / D03 / D04 / V11。生产入口隔离 GUI `scripts/pi-file-reference-gui-smoke.mjs` 验证文件选择、固定 Pi、发送后磁盘变化、Markdown/图片预览、二进制与 256 KB 预览上限提示、缺失引用后草稿恢复和未送模型、重启恢复；报告 `D:/Temp/pi-file-reference-gui-20260928-h/pi-file-reference-gui-report.json`，两次进程清理均无 harness 强制结束或残留。原版同状态成对截图、未知格式外部打开路径、其它媒体/Office 类型及最终人工验收尚未完成。 |

PI14-F2 继续使用原生 `WorkspaceFileTree`、`PreviewPane`、`MentionPlugin` 与 v4 用户消息组件，来源为固定 [ZCode `872ad960`](https://github.com/zai-org/ZCode/tree/872ad960de7ec172591f7e1952f7849229f94521)，Apache-2.0，许可总表见 `THIRD_PARTY_NOTICES.md`。新增的是 Host 侧文件快照与 Pi 消息投影；没有引入旧自建文件预览或 Agent 执行循环。文件快照有 256 KiB 文本、20 MiB 单图、10 个引用和 Pi RPC 总记录上限；超界或缺失在 Pi 接收前失败，输入草稿保留。

## #27 原生问题上报与诊断预览（隔离切片，未最终验收）

| ID | 原生入口/行为 | Pi 产品行为 | 必要性 / 状态 |
| --- | --- | --- | --- |
| PI27-D1 | 保留原生帮助菜单、错误横幅等“问题上报”入口；原厂商反馈中心已按 Pi-first 范围退出 | 同一入口打开本地原生 Dialog，仅读 GUI 构建版本、提交及当前固定 Pi 公开桥版本；分别由用户点击复制诊断或打开 GitHub，预览本身不外发。About 文字导出不再含主机名 | #27/P33/V12 要求用户外发前可见且无凭据。纯白名单合同注入未知字段、堆栈、目录名、密钥样式值验证排除；隔离源码生产入口原生 GUI、固定 Pi 0.87.0 和受控推理在 `D:/Temp/pi-diagnostics-gui-20260928-b/pi-diagnostics-gui-report.json` 通过：实际页面预览与系统剪贴板按 Windows LF→CRLF 规范化后全文一致、外部边界仅在显式点击后收到裸 Issue URL，页面错误与残留进程均为零。原版同状态成对截图、包内运行及最终人工验收仍待做。 |

## #4 Pi shell 入口（开发增量，视觉待验）

| ID | 原生入口/行为 | Pi 产品行为 | 必要性 / 状态 |
| --- | --- | --- | --- |
| PI04-S3 | 原生会话 pane 标题栏悬浮操作区及 Dialog/Button/textarea | 同一区域新增 Pi shell 按钮；命令由当前固定 Pi RPC `bash` 执行，显示真实输出/退出码，勾选后通过 `excludeFromContext` 排除后续模型上下文，运行中复用会话 Stop | #4 / P03、P09 要求真实 shell 与停止。保留原生 pane 和控件，不建立通用终端管理平台；固定 Pi 合同和原生 GUI 已测：`D:/Temp/pi-shell-main-first-20260927/pi-shell-gui-report.json` 包含后续模型上下文差异、停止和进程清理结果。包内 GUI 与原版成对截图尚待验。 |
| PI04-S4 | 原生输入区 `/compact` 与会话 Stop 控件 | 手动压缩改由同一固定 Pi `compact` RPC 持有前台执行 ID，Stop 直接 `abort` 并等待 Pi 命令结束；取消后仍保留原会话历史 | #3/#4 / P03、P08、V03。固定 Pi 0.87.0 延迟摘要合同、启动竞态测试及生产入口原生 GUI `D:/Temp/pi-manual-compact-main-20260927/pi-manual-compact-gui-report.json` 已通过；包内和原版成对截图待验。 |
| PI04-S5 | 原生运行状态和输入区 Stop 控件 | Pi 自动 retry 退避期间仍保留原生 Stop；Stop 经固定 Pi `abort_retry` / `abort` 取消等待，不额外创建前端重试器 | #3/#4 / P03、P07、V03。`pi-retry-stop-fixed.test.ts` 和主分支原生 GUI `D:/Temp/pi-retry-stop-main-20260928-a/pi-retry-stop-gui-report.json` 验证首个受控 503 后停止且无迟到第二请求；包内及原版成对截图待验。 |

## #9 Pi CLI 运行期间历史发现（开发增量，视觉待验）

| ID | 原生入口/行为 | Pi 产品行为 | 必要性 / 状态 |
| --- | --- | --- | --- |
| PI09-C1 | 保留原生任务侧栏及命令中心搜索框，在搜索框内增加一个小型刷新按钮 | 工作区已打开时，搜索会重新读取固定 Pi 0.87.0 `SessionManager.list`；刷新按钮在空查询时也重扫当前工作区。新 CLI JSONL 的真实 ID、名称与时间进入已有 sessions-index，原始 JSONL 不被复制或改写；活动 Pi 会话不被磁盘冷扫描覆盖。 | 原先只在首次订阅扫描，CLI 后建的会话在 GUI 中不可见。固定 Pi 与桌面 Controller 已先红后绿；隔离源码原生 GUI `D:/Temp/pi-cli-live-history-gui-20260928-c/pi-session-search-gui-report.json` 通过（搜索、空查询刷新、打开、退出零残留）。包内、原版同状态成对截图及人工验收待测。多次搜索会产生只读目录扫描，长历史性能仍待最终回归。 |

## #9 Pi 会话确认删除（开发增量，视觉待验）

| ID | 原生入口/行为 | Pi 产品行为 | 必要性 / 状态 |
| --- | --- | --- | --- |
| PI09-D1 | 原生任务侧栏右键菜单和现有破坏性确认弹窗 | 在右键菜单加入“删除 Pi 会话…”；弹窗显示 Pi JSONL 当前名称、真实 session ID、工作区与文件路径。取消不写历史；活动会话拒绝；确认仅删除同一工作区、同一文件版本的冷会话 JSONL，保留其他工作区文件；成功后清理该 session 的本地文字和 IndexedDB 图片草稿 | Pi 原生历史就是 JSONL，旧 task-index 软删除会在 CLI 中留下原文件并造成假删除。隔离原生 GUI `D:/Temp/pi-session-delete-gui4-20260927/pi-session-delete-gui-report.json` 验证取消、活动保护、真实删除、重启不复活与三次完整进程清理；草稿清理的隔离单元合同已通过。固定原版同状态成对截图和最终人工验收仍待做。 |

## #9 Pi 原生分支与克隆（开发增量，源码 GUI 已测）

| ID | 原生入口/行为 | Pi 产品行为 | 必要性 / 状态 |
| --- | --- | --- | --- |
| PI09-F1 | 原生会话 pane 的会话树 Dialog/Button、原生会话切换及 Lexical 输入区 | 在真实 Pi 树选择用户 entry 后执行 RPC `fork(entryId)`；另有 `clone()` 复制当前活动分支。成功时 Pi 生成新 session ID/JSONL，Host 等旧 Pi 进程与文件租约释放后重新租赁新会话，原生 pane 切到 child；fork 的文字和选中 entry 的图片字节恢复到 child 持久草稿，由用户显式发送。扩展取消时显示取消且保持原会话。 | Pi 的分支文件身份与取消语义无法由前端行复制代替。固定 Pi 0.87.0 重复图片及离开当前分支的 entry 合同通过；原生 GUI `D:/Temp/pi-image-fork-gui-20260928-c/pi-fork-clone-gui-report.json` 验证原图、重启恢复、再次发送与进程清理。原版同状态截图、双视口/主题和人工验收仍待统一复验。 |

固定 Pi 0.87.0 的 `fork` 仅返回文字；Host 在 Pi 分支前按选中 `entryId` 验证原 JSONL 图片并返回受限 `pi-entry-image:entryId:partIndex` 引用和 SHA-256，不在命令回执中携带原图。新 child 先持久登记图片草稿；复制中断或字节不符时，重启后保留可见失败 chip，阻止只发送文字。源会话 JSONL 保留；删除 child 时才回收其本地草稿。图片超过 8 张、单张超过 20 MiB、未知内容块或受损 base64 会在 Pi 分支前拒绝。原版同状态视觉对照仍待统一验收。

Pi 的 `get_fork_messages` 文字列表不包含纯图片输入，但固定 Pi `fork(entryId)` 支持该用户 entry。Host 以 `get_entries` 的精确用户 entry 验证和读取，因此纯图片也作为未发送图片草稿恢复，不合成文字；原生树节点显示图片数量，方便区分原本都显示为“(empty)”的纯图片输入。

Pi 0.87.0 在 fork 目标的父链没有 assistant 消息时会返回 child 身份，却延迟写 child JSONL 到首次 assistant 回复。GUI 的未发送草稿不能依赖尚不存在的文件恢复；Host 在调用 Pi fork 前核对精确父链并拒绝此情形，保持源会话不变。已有 assistant 的父链可 fork 纯图片输入；首回合直接分支仍是固定 Pi 的产品边界。

## #9 Pi 历史编辑与重试（开发增量，源码 GUI 已测）

| ID | 原生入口/行为 | Pi 产品行为 | 必要性 / 状态 |
| --- | --- | --- | --- |
| PI09-H1 | 保留原生会话树 Dialog 与 Lexical 输入区，为历史用户 entry 增加“编辑此输入”和“从此输入重试” | 编辑经公开 `navigateTree` 回填纯文字，用户显式发送才产生新 Pi 回合；重试从 Pi `get_entries` 取原文字和图片，用同一 Pi 的公开树跳转和 RPC `prompt` 创建分支回合。原 JSONL 字节前缀保留，扩展取消则不发送。未知块、图片编辑和快照文本编辑明确拒绝。 | `pi-history-edit-retry-fixed.test.ts` 1/1 通过，生产入口 GUI `D:/Temp/pi-history-edit-retry-gui-20260928-a/pi-history-edit-retry-gui-report.json` 验证重试/编辑/显式发送，`pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`。Pi 0.87.0 的树跳转和发送不是单个原子 RPC；跳转后投递失败可保留原分支，但需从树检查当前 leaf 后再操作。包内、原版成对截图和用户验收仍待做。 |

## #9 Pi 会话导入、导出与主动分享（开发增量，源码 GUI 已测）

| ID | 原生入口/行为 | Pi 产品行为 | 必要性 / 状态 |
| --- | --- | --- | --- |
| PI09-T1 | 原生会话 pane 的悬浮操作区和 Dialog/Button | 在现有会话树旁增加“Pi 导入与导出”；直接读取当前固定 Pi 的最近助手回复、复制、原始 JSONL，调用同一 Pi RPC `export_html`，使用原生文件/目录选择器；导入经 Pi `SessionManager.forkFrom` 生成新 ID 并切换原生会话 | 保留原生控件和会话切换路径，导入源字节不可修改。固定 Pi 合同和生产入口 GUI `scripts/pi-session-transfer-gui-smoke.mjs` 均通过；导入后 Pi `get_state.model` 与公开模型目录重新初始化 Composer，且新会话确实完成一次 Pi 推理。原版同状态截图、双视口/主题、包内与人工验收仍待统一复验。 |
| PI09-T2 | 同一 Dialog 的二次确认区 | “预览分享内容”读取 Pi 渲染的完整 HTML，将 Pi HTML 内嵌的 Base64 会话数据解码为可检查文本，并保留完整 HTML 源码查看；预览不执行导出脚本。用户勾选后才运行 Pi 0.87.0 TUI `/share` 的 `gh gist create --public=false` 同协议回退路径，返回 Gist 与 Pi viewer 链接 | 外发 HTML 还含 system prompt、工具定义和潜在凭据。秘密 Gist 不被搜索，但持链接者可访问，没有私有访问控制。自动测试仅用注入的本地假发布器核对预览与外发字节，不创建真实 Gist；真实 gh 登录/外发必须单独验收。 |

JSONL 包含消息、工具结果和可能的秘密；Windows 导出文件继承用户所选目录的 ACL。分享预览限制 8 MiB，超过时只支持本地导出。导入目前仅接受 Pi 0.87 当前 v3 JSONL：公开 `forkFrom` 不先迁移旧 entry，却会写入 v3 头部，因此旧版本要先由 Pi CLI 在源的安全副本上完成迁移。Pi `forkFrom` 重建会话头部身份和格式，非头部 entry 的未知字段保留；源文件原字节在成功或拒绝导入时都保持不变。Pi 的 HTML 导出是当前分支，原始 JSONL 导出是整份历史，两者用途不同。

此入口复用原生侧栏和确认框。删除没有应用自建回收站；确认前后用 Pi 0.87.0 `SessionManager.list`、文件身份与内容摘要验证。产品进程之间的租约不约束独立 Pi CLI；外部 CLI 恰在最终检查和文件删除之间写入的极短竞态仍需由用户避免同时操作。

## #11 llama.cpp router 面板（开发增量，视觉待验）

| ID | 原生入口/行为 | Pi 产品行为 | 必要性 / 状态 |
| --- | --- | --- | --- |
| PI11-R1 | 原生会话 pane 标题栏现有悬浮操作区和 Dialog/Button 控件 | 同一区域增加 llama.cpp router 模型按钮；弹窗显示 router 真实五种状态、autoload/preset 是否可由 Pi 选择，以及加载、卸载、下载、取消和 SSE/轮询进度 | Pi 0.87.0 内置 `/llama` 仅 TUI 交互，RPC 会提示不可用，因此 GUI 需管理入口。保留原生 pane、Dialog/Button 和 Pi 原生模型选择控件。固定 Pi RPC + 本地 HTTP/SSE router 合同已测，生产入口隔离 GUI 脚本 `scripts/pi-llama-router-gui-smoke.mjs` 待运行。真实 GGUF 推理、固定原版成对截图及双视口/主题仍待验。 |

router 协议依据是固定 Pi 0.87.0 上游 MIT `src/extensions/llama/client.ts` 与 `provider.ts`，版本仓库提交 `16787ad5b2dc748047f314ca1bfe7708f30f54f3`；这些 `dist/extensions/llama/*` 文件不在 npm 包公开 exports。Host 的 `pi-llama-router-client.ts` 适配其 HTTP/SSE 协议，认证与模型目录刷新从 Pi 公共扩展 API 取得，推理继续由 Pi 内置 provider 发起。面板不把密钥传给 renderer，并拒绝含 URL userinfo 的地址。加载、下载和卸载有有界等待；超时显示当时 router 状态，用户可再查询和显式取消。取消在尚未返回的 POST 完成后再发 unload，避免常见先卸载后加载竞态。网络中断导致 POST 结果未知时不自动重发；router 若在断线后延迟提交，仍需重新查询确认，不能据本地超时宣称操作已终止。

## #12 Pi 资源入口（开发增量，视觉待验）

| ID | 原生入口/行为 | Pi 产品行为 | 必要性 / 状态 |
| --- | --- | --- | --- |
| PI12-R1 | 原生会话 pane 的悬浮操作区和 Dialog/Button 操作路径 | 在现有会话树按钮旁增加“Pi 资源”按钮；同一原生 Dialog 显示 Pi 当前命令、Skill、上下文、system prompt 文件与包来源，提供文件编辑、启停、过滤、安装/卸载/更新和重载。包行现在根据 Pi 0.87.0 实际更新语义显示固定 npm 版本、离线禁用或 Git 固定 ref 同步，避免把无操作的更新说成成功。 | Pi 的资源有独立作用域与重载语义，需要可见入口。沿用 `SessionPane`/原生组件；固定 Pi 0.87.0 自动测试 5/5，隔离生产源码 GUI `D:/Temp/pi-resources-update-gui-20260928-a/pi-resources-gui-report.json` 验证模板编辑/停启、本地包安装/过滤/卸载及新增禁用反馈，`pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`。这不是原版同状态成对截图；双视口/明暗主题和键盘焦点仍待验。 |

资源列表以当前 Pi 进程公开 `get_commands`、`getSystemPromptOptions` 和 Pi 包管理器解析为准。修改后调用同一 Pi 的 `ctx.reload()`，旧 session 历史上下文不会重写。复杂扩展 TUI 交互仍按 #8/#25 单独核对。
固定 Pi 的 `DefaultPackageManager.update` 会跳过固定 npm 版本，并在 `PI_OFFLINE=1` 时直接返回；新的版本化 bridge 在执行前拒绝这两种无操作更新。固定 Git ref 的“同步”只重取已配置 ref，不自动升到新 ref；本轮按用户保护要求没有实际执行 Git update，因为上游在自管 clone 发生 ref 变化时会运行 `git reset --hard` 与 `git clean -fdx`。更换 ref 应明确安装新 source；真实 npm 在线更新、Git ref 变更、资源加载错误全类及 theme/provider 目录刷新还需独立验证。

Pi 0.87.0 的公开 `update(source)` 没有作用域参数，会按包身份同时扫描用户和项目配置。资源面板的单行更新仅在该身份对应唯一配置时可用；重复身份或无法核实身份时显示影响范围并禁用，Host 仍以当前 Pi 设置复核并在更新前拒绝歧义。此警示是 Pi 包更新语义产生的原生 UI 差异。隔离原生 GUI `D:/Temp/pi-package-scope-gui-20260928-c/pi-package-update-scope-gui-report.json` 验证双作用域两行警示、禁用、代际不变及完整进程退出；固定 Pi 离线合同验证直接调用 Host 也会拒绝且不改设置。本轮未运行真实 npm 或 Git 更新；原版同状态成对截图仍待统一验收。

## #3/#9 当前上下文检查入口（P14，开发增量）

| ID | 原生入口/行为 | Pi 产品行为 | 必要性 / 状态 |
| --- | --- | --- | --- |
| PI03-09-C1 | 保留原生会话 pane 悬浮操作区、Dialog/Button 与原有会话树 | 在会话树旁增加只读“Pi 上下文检查”；四个分页视图分别展示固定 Pi 0.87.0 `get_entries` 原始历史、`get_messages` 当前消息投影、真实 `context_edit` 和压缩/分支摘要。每页最多 20 条；主进程截断文本，仅把图片 MIME/大小和工具名送到界面，隐藏图片数据、工具参数与任意 details。运行期间暂停读取，历史读前读后核对 Pi 状态与 entry ID。 | #3/#9/P14 需要把可回溯历史与当前投影分开；`get_messages` 不是最终 provider 请求原文，Pi 的 bash 排除标志和扩展钩子仍需提示。固定 Pi context edit/compaction 合同、服务投影测试、UI 静态渲染及隔离生产源码原生 GUI `D:/Temp/pi-context-inspector-gui-20260928-c/pi-context-gui-report.json` 已通过，后者验证原文/替换投影/context edit、无页面错误及进程清理。GUI 未实际压缩或输入图片；压缩和图片边界由固定 Pi/投影合同验证。原版成对截图、包内运行及用户验收待单独记录。 |

## #25 Pi 扩展原始消息行（开发增量，视觉待验）

#13/P24 输入变换沿用原生 Lexical composer 和会话时间线；用户提交的图文只进入同一
固定 Pi RPC `prompt`。Pi 扩展将其 `transform` 后，时间线显示 Pi 实际 JSONL 中的
变换后消息；`handled` 且无模型回合时只显示扩展通知并恢复输入区，不生成假用户行。
原版 ZCode 没有 Pi 扩展输入语义，这是必要的 Pi 兼容差异。隔离原生 GUI 截图在
`D:/Temp/pi-input-transform-gui-20260928-b/pi-input-transformed-first.png` 与
`pi-input-transformed-second.png`；同状态原版/产品截图待最终对照。

| ID | 原生入口/行为 | Pi 产品行为 | 必要性 / 状态 |
| --- | --- | --- | --- |
| PI25-E1 | 原生时间线的消息行、附件预览和可折叠详情 | 保留原生行与图片按需预览；新增 `Pi 扩展消息` 行，展示固定 Pi `display:true` custom message 的有序文字、图片和折叠 details。Pi TUI renderer 不经 RPC，不能直接移植为组件。 | #25 / P27 要求 renderer 不兼容时保留原始消息。固定 Pi 合同和服务图片读取已测；真实原生 GUI、原版同状态截图及包内运行待验。 |
| PI25-E2 | 原生工具组内的工具行、图片预览与可折叠详情 | 保留原生 `ToolCallBlock` 及工具组展开路径；固定 Pi 的 toolResult 有图像或 details 时，在同一工具行追加有序原始内容，按会话与行引用读取 Pi JSONL 中的图像，避免重复展示扁平文字。没有装载扩展 TUI 专属 `renderResult` 组件。 | `pi-extension-rich-tool.test.ts` 固定 Pi 合同和隔离生产源码 GUI `D:/Temp/pi-rich-tool-gui-20260928-c/pi-rich-tool-gui-report.json` 通过；原生工具组展开后图文、PNG 解码及 details 可见，退出无残留。原版同状态成对截图、包内 GUI 与用户验收仍待做。 |

## 用户关卡记录

- 关卡 Issue：[#33](https://github.com/axgiroud312-byte/pi-agent-gui/issues/33)，前置导入 [#32](https://github.com/axgiroud312-byte/pi-agent-gui/issues/32)。
- 原版提交/构建：`317d286` 未改动的原生packages/CLI，4975源码文件与固定上游一致；实际生产构建及19组操作通过。
- 产品提交/构建：`0de01e26b86f7bc2ed023623516a0907f848819d`（`issue-32-native-zcode-fix`）；源码/产物摘要、19组操作/53张截图见 `issue-32-parity/evidence.json`，实际生产构建、默认profile入口、真实工具/终端和UI路径验证通过。
- 成对截图与操作记录：[26对图集](issue-32-parity/index.html)；全部必需空/运行/等待/错误/预览状态覆盖两视口和明暗主题。
- 用户确认链接：[2026-09-23明确确认](https://github.com/axgiroud312-byte/pi-agent-gui/issues/33#issuecomment-5787163874)，#33 CLOSED；原话和版本见[native-ui-confirmation.md](native-ui-confirmation.md)。

阶段0检查面已由上述证据覆盖；原版未启用的会话拆分、物理输入法和最终Pi/安装/远端能力在验收文档中明确未通过，不能将表中的最终复验自动标为完成。
