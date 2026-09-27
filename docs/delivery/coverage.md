# Pi 能力与必要桌面体验验收账本

当前合同为 [范围](pi-first-scope.md)、[scope.json](scope.json) 与 [tickets.json](tickets.json)。编号用于追踪，不以固定数量替代真实验收。任务覆盖不代表功能完成；历史原型证据不能自动计入原生 GUI。

#34 已有本地闭环与增量修复证据；图片与队列的旧局部修复见 `1337c33`。本轮未发送图片恢复改动见下方最新增量记录，仍未取得用户验收；#1/#28 和下列能力最终验收仍未完成。受控模型并不等于在线 provider。

实现路径图例：R = Pi RPC；B = 公开扩展桥；H = 必要本地宿主；C = 固定版本兼容适配。路径是实施方向，不是已支持声明。

## 能力与实施责任

| ID | 用户能力 / 适配路径 | 实施 Issue | 当前验收 |
| --- | --- | --- | --- |
| P01 | 文本 / 图片 prompt、Skills 与模板展开；R：`prompt` | #34, #3 | 待逐项验收 |
| P02 | 转向、后续、双队列与投递模式；R：`steer`、`follow_up`、两种 mode 设置、`clear_queue` | #4 | 待逐项验收 |
| P03 | 停止 Agent、shell 与重试；R：`abort`、`abort_bash`、`abort_retry` | #34, #4 | 待逐项验收 |
| P04 | 状态、消息、流式 thinking、工具和扩展消息；R：`get_state`、`get_messages` 及所有标准事件 | #34, #3 | 待逐项验收 |
| P05 | 模型枚举、搜索、选择、循环与 scoped models；R：`get_available_models`、`set_model`、`cycle_model`；B/H：scope 与默认值 | #3, #10 | 待逐项验收 |
| P06 | thinking 等级、循环、预算及默认值；R：`get_available_thinking_levels`、`set_thinking_level`、`cycle_thinking_level`；H：设置 | #3, #10 | 待逐项验收 |
| P07 | 自动重试开关、退避与失败展示；R：`set_auto_retry`、retry 事件；H：完整参数 | #3, #10 | 待逐项验收 |
| P08 | 手动 / 自动压缩、摘要及 overflow 恢复；R：`compact`、`set_auto_compaction` 和 compaction 事件 | #3, #10 | 待逐项验收 |
| P09 | 用户 shell、带 / 不带模型上下文的执行；R：`bash`、`abort_bash`，按固定版本支持 `excludeFromContext` | #4 | 待逐项验收 |
| P10 | 创建、切换、重命名会话；R：`new_session`、`switch_session`、`set_session_name` | #34, #5, #9 | 待逐项验收 |
| P11 | Pi 会话目录查询、排序、筛选、重命名与确认删除；Pi 原生 JSONL 索引/公开管理接口；不增加自有归档回收站 | #9 | 待逐项验收 |
| P12 | fork、clone、历史输入编辑和分支重试；R：`get_fork_messages`、`fork`、`clone`；B：树导航 | #6, #9 | 待逐项验收 |
| P13 | 全树、增量 entries、书签、过滤和树跳转；R：`get_tree`、`get_entries`；B：`navigateTree`、`setLabel` | #6, #9 | 待逐项验收 |
| P14 | 当前上下文、原始历史、context edits 与摘要检查；R/B：entries、上下文投影与公开扩展钩子 | #3, #9 | 待逐项验收 |
| P15 | token / cache / 费用 / 上下文与会话信息；R：`get_session_stats`；B：可用附加诊断 | #3, #9 | 待逐项验收 |
| P16 | 复制、HTML / JSONL 导出、导入及 gist 分享；R：`get_last_assistant_text`、`export_html`；H/B：原生格式与分享流程 | #9 | 待逐项验收 |
| P17 | 持久 / 临时会话、自定义存储与 CLI 续接；R 启动参数、H：索引及会话所有权 | #34, #5, #9 | 待逐项验收 |
| P18 | 本地 API key、OAuth、自定义 provider 认证与登出；Pi 公开认证接口；在线模型/OAuth 保留，非远程工作区 | #7 | 待逐项验收 |
| P19 | 内建与自定义 provider、headers、协议、动态模型目录；H/B：Pi 模型配置及 `registerProvider` 能力 | #7, #10 | 待逐项验收 |
| P20 | llama.cpp router 配置、模型下载 / 加载 / 卸载；H/B：Pi provider 与 router 管理能力 | #11 | 待逐项验收 |
| P21 | 上下文指令、system prompt 替换 / 追加与来源；H/B：Pi 资源解析、公开 prompt 输入查询 | #6, #12 | 待逐项验收 |
| P22 | Skills、模板的发现、创建、编辑、调用及来源；R：`get_commands` / `prompt`；H/B：资源管理 | #12 | 待逐项验收 |
| P23 | 全部内建工具、自定义工具、覆盖工具及动态启停；R：工具事件；B：工具枚举与 active tools | #6, #13 | 待逐项验收 |
| P24 | 扩展命令、生命周期、输入变换、自定义消息和 provider；R/B：公开扩展机制 | #6, #12, #13 | 待逐项验收 |
| P25 | 选择 / 确认 / 输入 / 多行编辑等扩展交互；R：完整 `extension_ui_request/response` | #13 | 待逐项验收 |
| P26 | 通知、状态、widget、标题、输入区文本；R：全部 fire-and-forget UI 方法 | #13 | 待逐项验收 |
| P27 | 公开扩展 UI 的 GUI 等价交互与兼容边界；必要交互由公开接口/版本化适配承接；复杂 TUI 逐类说明限制，非任意第三方零适配 | #8, #25 | 待逐项验收 |
| P28 | 主题、快捷键、显示偏好、帮助、changelog 与退出；H/B/C：GUI 等价交互和兼容映射 | #10, #25, #26 | 待逐项验收 |
| P29 | npm / Git / 本地包安装、卸载、更新、固定版本与资源过滤；H：Pi 包管理命令；B：重载 | #12 | 待逐项验收 |
| P30 | 资源热重载、临时扩展与精确资源加载选项；B：`reload`；H：本地启动选项 | #6, #12 | 待逐项验收 |
| P31 | 完整 Pi 设置、网络、重试、缓存、图片与工具配置；H：表单 + schema 感知的高级配置 | #10 | 待逐项验收 |
| P32 | Pi 既有项目信任、启动离线、遥测和更新设置；H/B：实际 Pi 设置与启动策略 | #10, #12, #27 | 待逐项验收 |
| P33 | Pi 版本、模型目录刷新、维护与诊断/bug 报告；Pi 公开维护能力与必要宿主入口；用户主动更新/外发，不建设云更新平台 | #7, #27 | 待逐项验收 |
| P34 | 影响 GUI 的本地启动、环境及 CLI 会话互通选项；映射 cwd/存储/资源/Pi 路径等；interactive/print/JSON 仍用 Pi CLI，不另造 profiles 产品 | #10 | 待逐项验收 |
| D01 | 本地项目选择与最近目录；复用原生 ZCode 桌面组件与本地服务，按 Pi 必要使用路径验收 | #34, #5 | 待逐项验收 |
| D02 | 原生会话切换、标签、布局和交互；复用原生 ZCode 桌面组件与本地服务，按 Pi 必要使用路径验收 | #34, #5, #26 | 待逐项验收 |
| D03 | 输入框、草稿、图片与文件引用；复用原生 ZCode 桌面组件与本地服务，按 Pi 必要使用路径验收 | #3, #5, #14, #26 | 待逐项验收 |
| D04 | 本地文件预览与必要编辑保存；复用原生 ZCode 桌面组件与本地服务，按 Pi 必要使用路径验收 | #14 | 待逐项验收 |
| D05 | 必要设置、中文输入、键盘和可用性；复用原生 ZCode 桌面组件与本地服务，按 Pi 必要使用路径验收 | #10, #26 | 待逐项验收 |
| D06 | 可靠启动、Windows 交付和保存恢复；复用原生 ZCode 桌面组件与本地服务，按 Pi 必要使用路径验收 | #34, #5, #27 | 待逐项验收 |

## 最终场景

| 场景 | 内容 | 实施 Issue | 结果 |
| --- | --- | --- | --- |
| V01 | 本地项目→实际 Windows exe→Pi 启动、退出与恢复 | #34, #5, #27 | 待最终验收 |
| V02 | 文本/图片/thinking/工具真实流式输入输出与错误 | #34, #3, #13 | 待最终验收 |
| V03 | 双队列、取回、停止、重试、压缩及错误恢复 | #3, #4, #13 | 待最终验收 |
| V04 | 两个本地会话隔离、CLI 历史互续、草稿保存恢复 | #34, #5, #9 | 待最终验收 |
| V05 | 真实树/书签/分支/fork/clone、摘要和取消 | #6, #9 | 待最终验收 |
| V06 | 真实 provider 认证、模型/thinking、作用域和配置 | #7, #10 | 待最终验收 |
| V07 | Pi llama.cpp router 管理及真实模型会话 | #11 | 待最终验收 |
| V08 | Skills/模板/上下文/包/trust/启动参数与重载 | #6, #10, #12 | 待最终验收 |
| V09 | 扩展必要交互、生命周期与明确兼容限制 | #8, #13, #25 | 待最终验收 |
| V10 | 会话导入/导出/复制与用户主动分享 | #9 | 待最终验收 |
| V11 | 文件引用、预览、工具文件回链及保存冲突 | #14 | 待最终验收 |
| V12 | 原生 UI、中文/键盘/长记录、打包及诊断 | #26, #27 | 待最终验收 |

## 2026-09-27 增量验证（局部证据，均非最终验收）

| 能力 / 场景 | 目前实测 | 未完成 / 不得宣称 |
| --- | --- | --- |
| P01、P04、D03 / V02 | 固定 Pi 0.87.0 + 离线受控模型：原生 GUI 图片选择经 Host 分块上传，模型收到真实 PNG，Pi JSONL 的 user row 图片可预览并在重启后恢复。测试 `pi-native-image-upload.test.ts` 与 `scripts/pi-native-gui-smoke.mjs`。 | 拖入/粘贴各自完整矩阵、未知消息、在线模型图片仍未验收；本表的旧包尚未包含下方新草稿修复。 |
| P02、P03 / V03 | GUI 运行中纯文本自动路由到 Pi 队列；Stop 先清队列，再取消运行；返回的文本在 GUI/重启后只读可见、不自动重发。运行中图片入队被拒且保留草稿及 Stop，避免 `clear_queue` 仅返文本而静默丢图。 | 双队列逐项编辑/删除/重排/立即发送、图片队列的无损取回、shell/retry/compaction/扩展等待的 GUI Stop 矩阵均**未完成**（#4）。 |
| D06 / V01 | 本次生产源码入口及隔离的 Windows unpacked 包均通过原生 GUI→宿主→固定 Pi 图片/队列/停止/恢复，进程树检查无幸存；本地 TypeScript、lint、Pi 单测及桌面 production build 通过。NSIS 未安装产物已生成并通过依赖/大小检查。 | **未实际安装** NSIS、覆盖升级、卸载、在线 provider 或用户实际验收（#27/#28）；当前预览包不能当作统一最终交付。 |

本地原始输出位于 `test-results/pi-*.log`、`test-results/native-parity/product/`（ignored，非提交证据）；`1337c33` 的隔离增量包位于 `D:/Temp/pi-agent-gui-preview-20260927-b/`（不是最终用户试用包）：`win-unpacked/Pi Agent IDE Preview.exe` 已实际运行，`Pi Agent IDE Preview-3.14.0-win-x64_TEST.exe` 仅已生成、未安装。对应实现与差异见 `packages/services/src/pi-agent/`、`scripts/native-smoke/` 及 [原生 UI 差异登记](native-ui-parity.md)。受控模型不等于在线供应商。下表所有“待逐项验收”维持原状。

## 2026-09-27 当前开发增量：#5 未发送图片（`77481f1`，技术回归，非最终验收）

| 能力 / 场景 | 已观察结果 | 仍未完成 |
| --- | --- | --- |
| P01、D03、D06 / V02、V04 | 先用生产入口 Windows 原生 GUI 复现：会话草稿文字重启后存在、未发送图片消失。修复后将图片原始字节和哈希存入 profile IndexedDB，按工作区/会话保存顺序索引；同一会话及新建任务的图片和文字在完整退出/重启后恢复，发送时受控模型通过固定 Pi 收到原字节。源文件选择器选图后被修改，模型仍收到选择时字节；损坏一张图片时另一张独立恢复、损坏张阻断发送并可手动移除。脚本 `scripts/pi-native-gui-smoke.mjs`，通过证据 `D:/Temp/pi-agent-draft-corrupt-green2-20260927/`；页面异常、强制退出、进程残留均为零。 | 尚需两项目两会话同名图、粘贴/拖入、会话删除/项目移除的存储生命周期、单侧文字存储失败和打包应用复测。用户未验收。 |
| P01、P03 / V02 | 延迟浏览器读图后立即按 Enter 的红测曾把纯文字送到模型；同步 admission 门禁后桌面 GUI 阻止了这次错误发送。图片落盘失败变成失败 chip，不再作为 ready 图发送。 | 强制关机/崩溃发生在落盘之前的行为仍需单独界定；Stop/队列多状态矩阵未完成。 |
| P01 / V02 | 单张 20 MiB 的 base64 Pi JSONL 经真实子进程边界通过；32 MiB record 上限与按总量预核算相配。两张 13 MiB 图在读入前按聚合限制拒绝。 | 多张大图不能放入同一条 Pi 0.87.0 JSONL prompt；发送前错误须在最终 GUI 中确认草稿保留。 |

上述改动尚未形成最终 Windows 包；历史 `D:/Temp/pi-agent-gui-preview-20260927-b/` 不能代表它。所有 P/D/V 总表状态继续保持“待逐项验收”。

## 2026-09-27 后续集成证据（截至 `46c3e73`，仍非最终验收）

上方“图片入队拒绝、队列只读”描述是 `1337c33` 时的历史状态；以下实测取代该限制。固定 Pi 0.87.0 的原始 RPC 仍只返回文本，因此 `af924d4` 等提交给**同一 Pi 进程**加载版本化公开扩展，用 Pi 内存中的带 ID、revision 和原始图片引用的双队列作为权威；宿主没有第二条执行队列。

| 能力 / Issue | 实测与证据 | 仍开放 |
| --- | --- | --- |
| #4：P02、P03 / V03 | `D:/Temp/pi-queue-gui-main-20260927/pi-queue-gui-report.json`：生产入口原生 GUI→Host→固定 Pi→离线受控模型。相同文本的两张不同图片按 Pi ID 分别排入 follow-up；取回编辑保留原字节；steering/follow-up 分别重排、立即发送、Stop 后保留、手动恢复按 Pi 顺序执行。重启后 Pi 内存队列为空，恢复副本明确提示、没有自动重发。两轮完整退出 `graceful=true`，`forced=[]`、`survivors=[]`，`pageErrors=[]`。5 项定向真实 Pi/投影测试通过。 | shell、retry、compaction、扩展等待各运行态 Stop 矩阵及更长压力测试未完成；重启恢复副本不是活队列，用户需显式重新提交。 |
| #5：P01、D03 / V02、V04 | `D:/Temp/pi-agent-integrated-green8-20260927/pi-native-gui-report.json`：选择、粘贴、拖入，两个项目的同名未发图片与文字跨完整重启独立恢复；分别发送后固定 Pi 收到各自 SHA-256 原字节。第一项目两会话切换不重放，文件草稿及布局也恢复。`pageErrors=[]`，所有退出无强杀/幸存。 | 快速关窗文本快照加固仍待在当前源码重新跑 GUI；会话/项目删除后图片生命周期、文字单侧写失败、首次发送同时添加附件及最终包内复测仍开放。 |
| #6：P13、P24 / V05、V09 | `66e1763` 将 tree/entries、书签、跳转、reload 接到同一 Pi 的公开扩展 bridge；定向真实 Pi 合同与独立原生 GUI 已通过。 | fork/clone 与扩展完整生命周期、包内 GUI 仍开放。 |
| #9：P10、P11、P17 / V04 | `46c3e73` 用固定 Pi `SessionManager.list` 发现 CLI JSONL 历史；隔离 GUI `D:/Temp/pi-cli-history-gui3-20260927/pi-cli-history-gui-report.json` 验证 CLI→GUI→CLI 同一 session ID/JSONL 续接，退出无残留。定向测试 5/5 中包含实际固定 Pi 历史恢复。 | 主分支整合后的 GUI 复测、目录管理、fork/clone/编辑/重试、导入导出与主动分享仍开放。 |
| #14：D04 / V11 | `8910b33` 的有界 UTF-8 编辑与 SHA 版本冲突保护已在同一次 `green8` 原生 GUI 中验证：未保存草稿切换/重启恢复、外部改动阻断覆盖、用户明确比较后保存。 | 文件引用、更多预览类型和最终包内 GUI 未完成。 |

当前 `pnpm run typecheck`、`pnpm run lint`（0 error / 70 既有 warning）、`pnpm run build:bootstrap` 与上述 5 项定向测试通过；完整 Pi 顺序回归、delivery GitHub 校验及最终包内回归要在后续集成后再跑。离线受控模型、在线 provider、实际 GGUF/router、NSIS 安装和用户验收仍是独立结果。

## 回填要求

每项填写实际原生 GUI/Pi 版本、提交、测试命令、结果和证据链接；在线 provider、可控模型、包内运行、实际安装与用户验收分别标明。P27 的限制按 #8/#25 逐类明示，不将复杂 TUI 不支持写为已全面兼容。

#15–#24 因范围调整退出，并非交付。旧 I01–I18/US01–US84/T01–T20 仅作 [历史追溯](archive/scope-before-2026-09-27/README.md)。最终范围每项完成且 #28 通过后，才可能关闭 #1。
