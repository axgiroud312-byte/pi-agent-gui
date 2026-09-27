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

## 2026-09-28 当前主分支增量（HEAD `0e44cad`，非统一验收）

| 能力 / Issue | 当前可核证事实 | 独立未完成项 |
| --- | --- | --- |
| P02、P03 / #4 | `d581cc1`、`d1cd064` 令队列撤回编辑先保留 IndexedDB 原图文，拒绝/过期 ACK、草稿冲突、重启或 Pi 接受发送未落盘时不退休唯一副本；`b4693fc`、`0715953` 仅在固定 Pi revision、运行状态、书签、JSONL 与逐文件复核稳定后回收无引用 queue-media。纯测 6/6、会话删除 4/4。主分支原生 GUI `D:/Temp/pi-queue-main-415003e-20260928-b/pi-queue-gui-report.json` 通过两 lane、重排、Stop、立即发送、含图撤回/重启/恢复/精确 SHA；页面错误和进程残留均零。 | 更长压力、扩展等待全部 Stop 状态、最终包内 GUI 与统一用户验收未做；受控离线模型不等于在线 provider。 |
| P05、P15、P18、P19 / #3、#7 | `06c2365` 令 Pi 未给费用时 token/cache 仍可查；`f44a5d1` 让首次建会话前的模型目录读取固定 Pi ModelRuntime，会话后由 RPC 接管。认证固定 Pi 9/9。在线原生 GUI `D:/Temp/pi-online-provider-gui-main-20260928-d/pi-online-provider-gui-report.json` 经已有 OAuth 隔离副本实际运行 `openai-codex/gpt-5.5`，GUI 有回复、Pi JSONL `stop` / 15 output tokens，凭据副本已删除、无页面错误/残留。 | 用户现场 browser/device/manual OAuth 登录/登出、动态扩展 provider OAuth、真实 API key 账号、费用与最终包内 UI 未据此验收。 |
| P29 / #12 | `99dfad0` 使用固定 Pi 公开包目录对同身份 user/project 双作用域执行 fail-closed 更新检查。固定 Pi/纯测 9/9，原生 GUI `D:/Temp/pi-package-scope-main-f5a17e5-20260928-b/pi-package-update-scope-gui-report.json` 两行均警告且禁用更新、Pi generation 未变化、无更新调用或进程残留。 | 真实 npm/Git ref 更新、全部来源/重载诊断与包内 GUI 未跑；拒绝危险更新不是“更新成功”。 |
| D06 / #27 | `f5a17e5` 精确构建期补丁规避 electron-builder 26.8.1 `multiUser.nsh` 本机 `System.dll c0000005`；静态 5/5、typecheck、隔离 3.14.1 unpacked+NSIS 构建通过。诊断版 3.14.0 已在隔离目标实际安装并留下 HKCU Preview 注册。 | 最终源码 3.14.1 的包内 GUI、安装、覆盖升级、卸载、数据保留及用户验收都未跑。 |

固定 Pi 0.87.0 主分支顺序全套初跑 `D:/Temp/pi-agent-gui-pi-suite-main-20260928.log` 为 **223/228**：#4 GC 后过时的删除测试断言已更新并单测 4/4；其余 4 个控制桥/耐久 admission/扩展/历史重试用例在隔离树已聚焦修正并 cherry-pick 为 `0e44cad`，仍须重跑整套。typecheck 与生产源码 build 已通过；完整 lint、delivery plan 本地/测试/`--github` 与最终 HEAD 回归后补。各 P/D/V 表的“待验收”指尚未由用户对最终统一版本验收，不否认本节局部工程证据。

## 2026-09-27 增量验证（局部证据，均非最终验收）

| 能力 / 场景 | 目前实测 | 未完成 / 不得宣称 |
| --- | --- | --- |
| P01、P04、D03 / V02 | 固定 Pi 0.87.0 + 离线受控模型：原生 GUI 图片选择经 Host 分块上传，模型收到真实 PNG，Pi JSONL 的 user row 图片可预览并在重启后恢复。测试 `pi-native-image-upload.test.ts` 与 `scripts/pi-native-gui-smoke.mjs`。 | 拖入/粘贴各自完整矩阵、未知消息、在线模型图片仍未验收；本表的旧包尚未包含下方新草稿修复。 |
| P02、P03 / V03 | GUI 运行中纯文本自动路由到 Pi 队列；Stop 先清队列，再取消运行；返回的文本在 GUI/重启后只读可见、不自动重发。运行中图片入队被拒且保留草稿及 Stop，避免 `clear_queue` 仅返文本而静默丢图。 | 双队列逐项编辑/删除/重排/立即发送、图片队列的无损取回、shell/retry/compaction/扩展等待的 GUI Stop 矩阵均**未完成**（#4）。 |
| D06 / V01 | 本次生产源码入口及隔离的 Windows unpacked 包均通过原生 GUI→宿主→固定 Pi 图片/队列/停止/恢复，进程树检查无幸存；本地 TypeScript、lint、Pi 单测及桌面 production build 通过。NSIS 未安装产物已生成并通过依赖/大小检查。 | **未实际安装** NSIS、覆盖升级、卸载、在线 provider 或用户实际验收（#27/#28）；当前预览包不能当作统一最终交付。 |
| P18、P19、P33 / V06（#7 局部） | 固定 Pi 0.87.0 `ModelRuntime` 的 API key 保存/解析/登出与合成 OAuth 回调/刷新/取消合同通过；真实 Pi RPC 子进程同一 PID 在保存 key 后经公开桥 1.1.0 刷新模型快照，登出后恢复原模型可见性。原生 Settings 页接入非秘密状态和输入。测试 `pi-auth-manager.test.ts`、`pi-auth-service.test.ts`。 | 在线 provider 推理、真实 OAuth 账号/人工回调、扩展注册 provider 的认证、原生 GUI/包内 UI 与用户验收未完成；保存成功不可冒充在线模型成功。 |
| P27 / V09（#8 局部） | 固定 Pi 同一 RPC 会话扩展连续发出 select/confirm/input/editor，宿主对四类请求回传，拒绝非法选项与 Stop/重载后旧回答；原生弹窗保留正文、预填、多行和取消。测试 `pi-extension-native-interaction.test.ts`、`piExtensionProjection.test.ts`。 | notify/status/widget/title/editor text 未投影；复杂 TUI factory 无 RPC 等价合同。GUI、包内及键盘/焦点待验，逐类边界见 [兼容表](pi-extension-ui-compatibility.md)。 |

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
| #13：P23、P26 / V09（局部） | 隔离源码原生 GUI `D:/Temp/pi-extension-state-gui-20260927-d/pi-extension-state-gui-report.json`：固定 Pi 0.87.0 + 离线受控模型，启动通知/状态/widget/标题/输入建议可见，显式应用草稿、动态工具启停后的 Pi 读回及 reload 清理旧状态均通过；`pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`。真实 Pi 顺序测试与纯合同覆盖键控清除、去重、内部回复保密。 | 尚无包含本批次的包内 GUI；扩展建议输入采用显式应用以保护现有草稿。覆盖工具、输入变换、provider、复杂 TUI 和多扩展交错生命周期未逐项验收；P23/P24/P26 不标完成。 |
| #5：P01、D03 / V02、V04 | `D:/Temp/pi-agent-integrated-postsnapshot-20260927/pi-native-gui-report.json`：当前源码 `87a25b5` 的快速关窗文本快照已在生产入口原生 GUI 重跑。选择、粘贴、拖入，两个项目的同名未发图片与文字跨完整重启独立恢复；分别发送后固定 Pi 收到各自 SHA-256 原字节。第一项目两会话切换不重放，文件草稿及布局也恢复。`error=null`、`pageErrors=[]`，所有退出 `graceful=true`、`forced=[]`、`survivors=[]`，私有 Pi 包清理通过。 | 会话/项目删除后图片生命周期、文字单侧写失败、首次发送同时添加附件及最终包内复测仍开放。 |
| #6：P13、P24 / V05、V09 | `66e1763` 将 tree/entries、书签、跳转、reload 接到同一 Pi 的公开扩展 bridge；定向真实 Pi 合同与独立原生 GUI 已通过。 | fork/clone 与扩展完整生命周期、包内 GUI 仍开放。 |
| #9：P10、P11、P17 / V04 | `46c3e73` 用固定 Pi `SessionManager.list` 发现 CLI JSONL 历史；隔离 GUI `D:/Temp/pi-cli-history-gui3-20260927/pi-cli-history-gui-report.json` 验证 CLI→GUI→CLI 同一 session ID/JSONL 续接，退出无残留。定向测试 5/5 中包含实际固定 Pi 历史恢复。 | 主分支整合后的 GUI 复测、目录管理、fork/clone/编辑/重试、导入导出与主动分享仍开放。 |
| #10：P05、P06、P07、P08、P19、P28、P31、P32、P34、D05 / V06、V08 | `9fc89ef`、`bd5d373`、`b576b25` 把固定 Pi 的用户/项目 `settings.json`、生效值来源、信任/离线/会话目录展示在原生设置页；JSON 编辑保留未知字段，用原始字节 SHA、Pi 锁目录及原子替换防并发覆盖。隔离 GUI `D:/Temp/pi-settings-gui4-20260927/pi-settings-gui-report.json` 验证保存、外部改动冲突、未信任项目和固定 Pi 新会话推理，`error=null`、`pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`；整合后定向测试 10/10 和 Pi 包路径回归 1/1 PASS。 | 主分支整合后的 GUI 复测、全部设置字段与实际在线 provider/OAuth 行为仍待验证。 |
| #14：D04 / V11 | `8910b33` 的有界 UTF-8 编辑与 SHA 版本冲突保护已在同一次 `green8` 原生 GUI 中验证：未保存草稿切换/重启恢复、外部改动阻断覆盖、用户明确比较后保存。 | 文件引用、更多预览类型和最终包内 GUI 未完成。 |
| #12：P21、P22、P24、P29、P30、P32 / V08（隔离分支待整合） | 固定 Pi 0.87.0 的公开扩展桥与 `DefaultPackageManager` 已接原生会话资源入口；顺序真实 Pi 测试验证全局 Skill、项目模板与上下文、参数展开、文件版本冲突、system prompt 替换/追加、本地包启停/过滤/卸载，以及临时 Git daemon 固定 tag 包的安装/卸载。没有另建资源加载器；重载后命令目录由 Pi 再读。 | 生产 GUI/原版成对截图尚未运行；真实 npm 包、Git 固定 ref 更新、资源加载错误全类、theme/provider 目录刷新与旧 context 诊断仍需补证；在线 provider/包内/安装器/用户验收独立待验。 |
| #25：P27、P28 / V09（代表样例） | 固定 Pi 0.87.0 的真实 RPC 子进程运行 `examples/pi-gui-compat/extension.ts`；四种回答在同一 PID 继续，取消不记成功，status/widget 发送清理事件。原始 custom message 的文字、图片引用与 details 在原生行 live/restore 保留，工作区隔离读取图片字节；独立不兼容探针确认 `hasUI=true` 仍不能使用 `custom`，组件 factory 无请求，主题切换返回失败。逐类边界见 [兼容表](pi-extension-ui-compatibility.md)。 | #13 的 GUI 状态展示、工具 image/details、两会话与 Stop/reload 清理、包内 GUI 和用户验收未验证；不宣称复杂第三方 TUI 零适配。 |

`660999f` 时主分支 `pnpm run typecheck`、`pnpm run lint`（0 error / 70 既有 warning）、`pnpm run build:bootstrap`、固定 Pi 顺序 127/127、delivery plan、本地测试 7/7 和 `--github` 均通过。#10 整合后定向测试已通过；完整 Pi 顺序、类型/静态、原生 GUI 和最终包内回归须在后续集成后重跑。离线受控模型、在线 provider、实际 GGUF/router、NSIS 安装和用户验收仍是独立结果。

## 2026-09-27 21:19 主分支新增实测（覆盖上方旧的“尚未整合/GUI 未运行”描述）

| 能力 / Issue | 当前主分支证据 | 尚待完成 |
| --- | --- | --- |
| #5：P01、D03、D06 / V02、V04 | `b25afc5`、`0b237ee` 增加图片草稿的全 profile 数量/容量边界、单侧文字写失败时同 scope 保留、首发接受后按图片 ID 迁移，失败 chip 不会成为 ready 发送。定向测试 `composerImageDraftStorage`、`composerAttachmentPromotion` 与带 UI tsconfig 的 `composerDraftStoreFailure` 均绿。主分支 `D:/Temp/pi-main-full-postresources-20260927/pi-native-gui-report.json`：选择/粘贴/拖入、未发送图重启原字节恢复、两项目同名图隔离、两会话与布局、真实 Pi 发送和 Stop 通过；`pageErrors=[]`、退出无残留。 | 包内复测、异常断电边界、用户验收仍开放。 |
| #7：P18、P19、P33 / V06 | `D:/Temp/pi-auth-main-integrated-20260927/pi-auth-extension-gui-report.json`：原生 Settings 保存/隐藏/登出 API key，固定 Pi 同一会话观察刷新；页面错误、强制退出和进程残留均为零。 | 在线 provider 真实推理与账号、人工 OAuth 回调、包内及用户验收未做。 |
| #8：P25、P27 / V09 | 同一 GUI 报告：固定 Pi 扩展 select/confirm/input/editor 四类交互返回预期值，原生弹窗与取消可见；完整进程清理。 | notify/status/widget/title/editor text 在 #13；复杂 TUI factory 明确不承诺原样运行；键盘/焦点、包内仍待测。 |
| #9：P10、P11、P17 / V04 | `e729e5c`、`760232f` 在 Pi JSONL ACK 后重命名，无旧任务索引也可成功；`6532beb` 将原生会话纳入命令中心搜索。隔离 GUI `D:/Temp/pi-session-rename-gui3-20260927/`、`D:/Temp/pi-session-search-gui2-20260927/` 均无页面错误或残留。 | 主分支 GUI 复测、确认删除、fork/clone、导入导出、分享、正文检索未完成。 |
| #10：P05–P08、P19、P28、P31、P32、P34、D05 / V06、V08 | `D:/Temp/pi-settings-main-integrated-20260927/pi-settings-gui-report.json`：主分支原生 GUI Pi 设置保存/外部冲突/未信任与固定 Pi 推理，`error=null`、`pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`。 | 全字段、在线 provider/OAuth 及包内仍待验。 |
| #11：P20 / V07 | `736ea53` 把同一 Pi 会话实时模型目录接到原生菜单；`D:/Temp/pi-llama-main-postresources-20260927/pi-llama-gui-report.json`：加载/经固定 Pi 推理/卸载各 1 次，`pageErrors=[]`，进程全部正常清理。 | 本地 HTTP/SSE router fixture 不是实际 llama-server/GGUF；真实模型、下载/断线 GUI 矩阵、包内仍待验。 |
| #12：P21、P22、P24、P29、P30、P32 / V08 | `1398a6a`、`197e853` 保留 Pi 原生资源与包管理，默认树视图不披露资源内容。`D:/Temp/pi-resources-main-integrated-green2-20260927/pi-resources-gui-report.json`：原生 GUI 模板编辑与重载、停启、本地包安装/过滤/卸载。2026-09-28 隔离增量先红测确认缺少更新状态，固定 Pi 源码确认离线更新静默返回及固定 npm 版本跳过，后在版本化桥中拒绝无操作更新，资源页显示离线/固定版本/固定 Git ref 的准确状态；固定 Pi 合同 5/5、typecheck、定向 lint 0/0、桌面 production build、`D:/Temp/pi-resources-update-gui-20260928-a/pi-resources-gui-report.json` 均通过，GUI `pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`。 | 在线 npm 实际更新、Git ref 变更、资源加载错误全类、theme/provider 目录刷新、原版成对截图、包内及用户验收仍待测。固定 Pi 的 Git update 会在自管 clone 的 ref 变动时执行 reset/clean，本轮遵守用户保护要求未运行；不将固定 ref 安装/卸载算作更新。 |
| #26：P28、D03、D05 / V12（隔离分支待整合） | IME 候选 Enter、Chromium `keyCode=229` 与 `compositionend` 紧邻 Enter 的红测先失败，修复后定向测试通过；保留原生 Lexical 输入框并只在其 contenteditable 阻断误提交。最终隔离源码 GUI `D:/Temp/pi-ime-gui-20260927-d/pi-ime-gui-report.json`：固定 Pi 0.87.0、1280×800 深色和 1920×1080 浅色，候选 Enter 不发送且草稿保留，随后普通 Enter 与显式按钮各发送中文原文；`pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`。 | 物理中文 IME、原版成对截图、弹窗焦点、快捷键全路径、包内与用户验收仍开放。 |
| #26：长历史/工具输出滚动与焦点（隔离分支待整合） | 内层滚轮误将时间线标记为用户离底的红测先失败，修复后定向测试 4/4、UI typecheck、定向 lint 与桌面 production build 通过。`D:/Temp/pi-long-scroll-gui-20260927-e/pi-long-scroll-gui-report.json`：固定 Pi 0.87.0 经 24 回合历史、真实 bash 120 行输出及 24 帧续流；内层滚动 2340→2270 时外层保持跟随，外层滚轮上滚后续流不夺回阅读位置，返回最新恢复吸底；1280×800 深色与 1920×1080 浅色下 Ctrl+M 打开模型菜单、Escape 焦点回到 composer，`pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`。 | 这是确定性 loopback provider 与单机样本；更大历史规模、更多弹窗/快捷键/焦点路径、物理 IME、原版成对截图、包内及用户验收仍待测。 |
| #26：Pi 弹窗焦点/快捷键（隔离分支待整合） | 固定 Pi 0.87.0 的 select/confirm/input/editor 连续交互先在 select 初始焦点及结束后 BODY 复现红测；改用原生 Dialog 并限制 Ctrl+M 作用域，结束后仅恢复到可用控件。`D:/Temp/pi-dialog-focus-gui-20260928-n/pi-dialog-focus-gui-report.json`：select 首项自动聚焦、Shift+Tab/Tab 困在弹窗、Ctrl+M 不穿透、Escape 由 Pi 取消 select/input、confirm=false、editor 预填后回传多行编辑，最终旧基线 composer 为 `contenteditable=false` 时焦点稳定回退模型按钮；`pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`。定向快捷键 1/1、UI typecheck、定向 lint 和 production build 均通过。 | 焦点回退不修复旧基线 extension slash 命令后的 `noRun` 会话闭锁；主分支对应语义修复整合后须重跑 composer 可编辑焦点。其余弹窗/快捷键矩阵、原版成对截图、物理 IME、包内及用户验收仍待测。 |

此轮主分支固定 Pi 顺序测试 160/160、typecheck、桌面 production build、交付计划本地/7 项测试/`--github` 均通过；lint 为 0 error / 70 既有 warning。#12 首次 GUI 报告 `pi-resources-main-integrated-20260927` 在异步保存未完成时读旧 generation，修正测试等待后重跑绿色。上述源码 GUI 与本地受控模型证据均不得替代在线 provider、实际 GGUF、包内 GUI、NSIS 安装或用户验收；P/D/V 总表仍为待最终统一验收。

## 2026-09-27 23:30 后续整合与待复验

| 能力 / Issue | 已验证的技术增量 | 尚待完成 |
| --- | --- | --- |
| #4：P03、P07、P08、P09 / V03 | 主分支 `324a344` 直接使用固定 Pi `bash`，原生 GUI `D:/Temp/pi-shell-main-first-20260927/pi-shell-gui-report.json` 验证真实输出/退出码、后续模型只收到未排除的 shell 上下文、长命令 Stop 及进程清理。手动压缩 Stop 的固定 Pi 延迟摘要合同 `pi-manual-compaction-fixed.test.ts`、启动竞态测试 `pi-manual-compaction-stop.test.ts` 通过；`D:/Temp/pi-manual-compact-main-20260927/pi-manual-compact-gui-report.json` 从原生 `/compact` 经固定 Pi 0.87.0 请求摘要，Stop 取消摘要且保留前两轮历史，没有后续重试。自动 retry 的固定 Pi 退避取消合同 `pi-retry-stop-fixed.test.ts` 1/1 PASS；`D:/Temp/pi-retry-stop-main-20260928-a/pi-retry-stop-gui-report.json` 验证首个 503 后原生 Stop、延迟过后无第二次模型请求，`pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`。 | 自动 overflow 压缩、扩展等待 Stop 矩阵、更长压力、包内 GUI、用户验收仍开放。 |
| #9：P11 / V04 | `a33a4a0`、`4d54ba4` 让原生侧栏对冷 Pi JSONL 做真实确认删除，删除后非关键清理失败不误报未删除。隔离最终源码 GUI `D:/Temp/pi-session-delete-gui6-20260927/pi-session-delete-gui-report.json` 验证取消/活动保护、仅删除选中 JSONL、重启不复活、三次进程退出无残留；主分支定向固定 Pi/删除测试 8/8 通过。 | 主分支整合后 GUI 与包内复测、外部 CLI 与最终 unlink 的极短竞争窗、fork/clone/导入导出/主动分享及用户验收仍开放。 |
| #13、#25：P23–P27 / V09 | `2485cf7`、`7b5c8ce` 已整合 Pi 扩展状态/widget/标题/动态工具和原始 custom 消息、图片/details、shell 历史行；合并时保留资源隐私过滤。整合后定向固定 Pi 测试 14/14、typecheck、相关 lint 通过；隔离 GUI `D:/Temp/pi-extension-state-gui-20260927-d/pi-extension-state-gui-report.json` 通过且无页面错误/进程残留。 | 主分支与包内 GUI、工具图片/details、扩展多会话交错/Stop、复杂 TUI 逐类最终验收仍开放；复杂 TUI 不宣称零适配。 |
| #26：P28、D03、D05 / V12 | `6dc84e7` 已整合 Lexical 中文 IME 提交保护；隔离最终源码 GUI `D:/Temp/pi-ime-gui-20260927-d/pi-ime-gui-report.json` 在 1280×800 深色/1920×1080 浅色与固定 Pi 下验证候选 Enter 不发送、普通 Enter/按钮发送中文原文；`pageErrors=[]`、`forced=[]`、`survivors=[]`。 | 物理 IME、主分支/包内 GUI、滚动/长历史/焦点矩阵、原版同状态截图和用户验收仍开放。 |
| #14：D03、D04 / V11 | `82eb531` 将原生文件 mention 的工作区内有界 UTF-8、图片与目录快照加入同一次 Pi prompt；图片原字节与 MIME、引用文本、JSONL 历史均由固定 Pi 保存，发送后磁盘变动不篡改历史。缺失/越界/超大/不支持引用在投递前给本地化失败横幅，乐观清空失败后 Lexical 草稿恢复；会话标题不包含内部 snapshot 尾注。隔离最终源码 GUI `D:/Temp/pi-file-reference-gui-20260928-h/pi-file-reference-gui-report.json` 含真实 Pi、冷重启、预览、错误草稿保留，`pageErrors=[]`、两轮 `graceful=true`、`forced=[]`、`survivors=[]`；隔离固定 Pi 1/1、主分支纯测试 8/8 PASS。 | 原版成对截图、Office/其它媒体与未知格式外开、主分支/包内 GUI、用户验收仍开放。 |

这些技术证据仍是源代码与离线受控模型验证，不能替代在线 provider、真实 GGUF/router、安装器或最终人工验收。后续整合须重跑完整 Pi 顺序、typecheck、lint、delivery 校验和生产包验证。
## 2026-09-28 #9 导入、导出与主动分享增量（隔离分支，非最终验收）

| 能力 / 场景 | 已观察结果 | 仍待完成 |
| --- | --- | --- |
| P16 / V10 | 固定 Pi 0.87.0 合同使用 `get_last_assistant_text`、`export_html`、`SessionManager.forkFrom`：原始 JSONL 导出逐字节一致，Pi HTML 内嵌完整会话数据可解码审阅，导入新 Pi ID 后 `get_state.model` 恢复并经 Pi 推理，源文件成功/拒绝时均不变；未知 entry 字段保留。本地假发布器验证分享确认前零外发、确认后上传的 HTML Buffer 与预览原字节一致。`pi-session-transfer.test.ts` 3/3、`pi-fork-clone.test.ts` 1/1、`piModelCatalog.test.ts` 3/3。生产源码入口原生 GUI 报告 `D:/Temp/pi-agent-gui-fork-clone-20260927/test-results/native-parity/product/pi-session-transfer-gui-report.json`：复制、JSONL/HTML 导出、完整分享预览和导入后推理通过；`pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`。 | 真实 GitHub 登录/Gist 外发未执行，用户须逐字审阅可能含 system prompt、工具输出和凭据的完整 HTML，勾选后才能创建持链接者可访问的秘密 Gist。分享预览限 8 MiB，导入仅接受 Pi 0.87 当前 v3 JSONL；Windows 导出目标继承用户所选目录 ACL。包内 GUI、在线 provider、原版同状态视觉与统一人工验收未完成。 |

本增量 `pnpm run build:bootstrap`、`node node_modules/typescript/bin/tsc -b packages/services packages/ui --pretty false`、lint 与差异检查通过。上述受控 loopback 模型的推理不算在线 provider；P16/V10 总表仍为待最终验收。

## 2026-09-28 01:34 主分支整合与固定 Pi GUI 复验（仍非最终验收）

| 能力 / Issue | 本次已验证 | 仍开放 |
| --- | --- | --- |
| #13、#26：P27、D03 / V09、V12 | `29a1a9d` 的红测复现：Pi 已确认扩展命令处理完成，原生快照仍把无 Agent 回合的命令标为未完成，输入框变只读。修复后假 Pi 合同和固定 Pi 0.87.0 原生 GUI `D:/Temp/pi-dialog-focus-main-fixed-20260928/pi-dialog-focus-gui-report.json` 通过：四类连续弹窗的焦点与取消语义、命令后 composer 可编辑并获焦点、同一 Pi 会话下一条模型输入成功；`pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`。首次红色 GUI 留在 `D:/Temp/pi-dialog-focus-main-integrated-20260928/`。 | 原版成对截图、更多第三方扩展和包内 GUI 待验证；复杂 TUI 限制仍依兼容表。 |
| #4：P07、P08 / V03 | `9d664fa` 加入受控 400 超窗模型 fixture。固定 Pi 合同 1/1 和生产源码入口原生 GUI `D:/Temp/pi-auto-compact-main-20260928/pi-auto-compact-gui-report.json` 通过：第三轮真实 Pi 自动请求摘要，Stop 取消 held summary，没有迟到重试，前两轮及触发超窗的用户历史保留；GUI `pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`。定向 admission+auto 合计 18/18、typecheck、全仓 lint 0 error/69 既有 warning、production build 均通过。 | 包内 GUI、长时压力及其它运行态矩阵待最终复验；受控模型不等于在线 provider。 |
| #9：P16 / V10 | `200a51c` 已整合前表的原生 Pi JSONL/HTML 导入导出、复制及明确确认后 secret Gist 分享实现；主分支纯测试 4/4、typecheck、lint、production build 通过。隔离精确源码 GUI 证据仍见前表，源 JSONL 未被改写。 | 主分支整合 GUI、真实 GitHub Gist 发布、包内及人工验收分别待验证。 |
| #27：D01、D02 / V01 | `9bfbaf2`、`8be4045` 已整合本地诊断预览和独立复制/打开 GitHub 操作；预览只含本地白名单版本，不带主机名、目录、日志、会话 ID 或凭据。隔离固定 Pi GUI `D:/Temp/pi-diagnostics-gui-20260928-b/pi-diagnostics-gui-report.json` 验证剪贴板等于预览（Windows 换行归一化）、只有显式点击才外开，`pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`。主分支纯测试 4/4、typecheck、lint、production build 通过。 | 主分支整合/包内 GUI、Windows NSIS 实际安装、覆盖升级、卸载和人工验收未完成。 |

## 2026-09-28 #25 扩展工具原始结果增量（已整合主分支，非最终验收）

| 能力 / 场景 | 已观察结果 | 仍待完成 |
| --- | --- | --- |
| P27 / V09：公开扩展工具的图文与 details | 先以 `pi-message-rows.test.ts` 红测复现工具图像/details 在原生行丢失，再由固定 Pi 0.87.0 真实子进程执行 `examples/pi-gui-compat/extension.ts` 的 `gui_rich_probe`：Pi JSONL 保留文字、PNG 原字节和 details；原生行只传不含图像字节的 opaque ref，冷投影一致，错误行/工作区拒读。隔离生产源码 GUI `D:/Temp/pi-rich-tool-gui-20260928-c/pi-rich-tool-gui-report.json` 验证模型确实调用工具并收到 PNG、原生工具组展开后有序文字/解码图像/details 可见；`pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`。旧公共分享投影遇富工具行先拒绝；Pi HTML/Gist 路径展示完整内容，须由用户预览并明确确认。 | 当前只验证一个代表工具；两会话交错、Stop/reload、非消息 entry、复杂第三方 TUI、原版同状态成对截图、包内 GUI、在线 provider 与用户验收仍开放。 |

`1c78fd6` 已将此切片整合进主分支；主分支纯投影 9/9、UI 行 3/3、typecheck、lint（0 error / 69 warning）及 delivery plan 本地校验通过。隔离树固定 Pi 新合同 1/1、既有扩展样例 4/4、桌面 `build:no-runtime-assets`、delivery plan 7 项测试和 `--github` PASS。GUI 首两轮 a/b 是测试文案与模型请求记录形状的断言失误，均正常退出且无残留，未当作产品失败。受控 loopback 模型不是在线 provider，源码入口 GUI 不是包内 GUI；整合后 GUI 尚需复验。

## 2026-09-28 #10 设置来源与并发冲突修正（已整合主分支，非最终验收）

| 能力 / 场景 | 已观察结果 | 仍待完成 |
| --- | --- | --- |
| P31、P32 / V06、V08 | 固定 Pi 0.87.0 的 `SettingsManager` 对缓存预热与默认项目信任只读用户文件，入口 HTTP proxy 也只读用户文件；项目同名键现在保留原文并提示未生效。原生 Settings 生效值表按 `/retry/enabled` 等叶子显示用户/项目来源。用户/项目未知字段的作用域保存保持不变；在临时文件准备后注入外部写入，提交前第二次 SHA 检查拒绝覆盖并保留外部原字节。红测先复现，隔离树定向 13/13 与 `build:bootstrap` PASS；`D:/Temp/pi-settings-scope-gui-20260928-b/pi-settings-gui-report.json` 经原生 GUI、Host、固定 Pi 子进程验证来源、未知字段、外部写冲突和不受信项目，`pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`。`ecd801b` 已整合，主分支新增纯测试 3/3 与 typecheck PASS。 | 主分支整合后 GUI、包内 GUI、在线 provider、全部设置字段及用户验收未复验。Pi 锁可协调遵守锁的写者；不遵守锁的外部写者在最终 SHA 检查与 rename 之间仍有极短竞争窗，不能宣称跨进程绝对 CAS。 |

## 2026-09-28 02:26 #3 模型与 thinking 整合、#4 图片缓存审查（非最终验收）

| 能力 / Issue | 本轮结果 | 仍开放 |
| --- | --- | --- |
| #3：P05、P06、P15 / V02、V06 | `802c8e2` 至 `28b4871` 整合模型搜索、未知 context 明示、Pi session token/cache/费用、原生搜索焦点和选模后 thinking 目录刷新。隔离固定 Pi 0.87.0 原生 GUI `D:/Temp/pi-model-thinking-gui-20260928-e/pi-model-thinking-gui-report.json`：完整键盘搜索，真实选模推理，`off/minimal/low/medium/high` 与下一请求 `reasoning_effort=minimal`，退出 `graceful=true`、`forced=[]`、`survivors=[]`。主分支服务 22/22、UI 4/4、typecheck、lint 0 error/69 既有 warning、完整桌面源码 build PASS。 | 主分支整合后 GUI、最终包内、在线 provider/计费真实性、用户验收待做；显示的费用是固定 Pi 返回的测试 fixture 值。 |
| #4、#9：队列图片私有缓存 / V03、V04 | 独立只读审查指出确认删除 Pi JSONL 后 `queue-media` 原字节仍残留。`pi-session-delete.test.ts` 先红再绿；`2dac7d1` 在已确认的冷会话删除前，仅清除该 session 下本 Store 生成的图片文件，另一会话图片不动。测试 3/3、定向 lint 0/0、typecheck PASS。 | 队列项取回编辑后的图片仍由 composer 引用，不能按 Pi 队列快照立即删；同一只读审查发现 ACK 后切会话/新草稿及重启会丢图文，#4 正在独立红绿修复。缓存按会话持有期间的回收边界仍需验。 |

## 2026-09-28 #9 历史编辑与重试增量（已整合主分支，非最终验收）

| 能力 / 场景 | 已观察结果 | 仍待完成 |
| --- | --- | --- |
| #9：P11、P17 / V04 | `ad02452` 整合固定 Pi 0.87.0 合同：真实旧图片 entry 的 base64 原字节被同一 Pi 新回合接收，旧 JSONL 原字节前缀不变；纯文字编辑只回填原生 composer，显式发送后才有新模型请求；扩展取消不产生回合。主分支固定 Pi 与纯合同合计 5/5、typecheck、定向 lint 0/0、完整桌面 build 与 delivery plan 本地校验通过。整合后的原生 GUI `D:/Temp/pi-history-edit-retry-main-20260928-a/pi-history-edit-retry-gui-report.json` 验证 Pi 同一 JSONL 历史重试、编辑预填和显式发送，`pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`。隔离源码 GUI 另见 `D:/Temp/pi-history-edit-retry-gui-20260928-a/pi-history-edit-retry-gui-report.json`。 | Pi 固定版本 `fork` 仅返回文字，图片 fork 仍入 Pi 前拒绝；图片与未知 content 不进入纯文字编辑器。树跳转与 prompt 两个公开调用之间的失败需要检查当前 leaf；包内 GUI、原版成对截图、在线 provider 和统一人工验收仍待做。 |

## 2026-09-28 #7 本地认证目录错误与设备码期限（隔离分支，非最终验收）

| 能力 / 场景 | 已观察结果 | 仍待完成 |
| --- | --- | --- |
| P18、P19 / V06 | `pi-auth-manager.test.ts` 先以 2 项红测复现认证运行时首次创建失败后永久缓存拒绝，以及损坏 `models.json` 时自定义 provider 静默消失；第三项红测复现 `device_code.expiresInSeconds=0` 被当作没有期限。修复后 Pi 0.87.0 进程内 6/6 PASS，自定义 `models.json` provider 的认证解析使用 Pi 公开接口且 key 不进入 renderer。真实 Pi RPC 子进程 `pi-auth-service.test.ts` 2/2 PASS，确认同一 profile 的 custom provider 与保存/登出后目录同步。隔离生产源码 GUI `D:/Temp/pi-auth-recovery-gui-20260928-b/pi-auth-extension-gui-report.json` 通过 API key 保存/隐藏/登出、目录损坏警告、修复后 custom provider 恢复和四类扩展交互，`pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`；产品错误状态截图 `pi-auth-catalog-error.png`。typecheck、lint 0 error/69 既有 warning、`build:bootstrap`、delivery 本地/7 项测试通过。 | 首轮隔离 GUI `D:/Temp/pi-auth-recovery-gui-20260928-a/` 因该工作树缺 gitignored Agent bundle 在 storage preparation 阶段失败，运行 `pnpm --dir packages/desktop prepare:agent-bundle` 后重跑全绿；不把首次失败归为认证逻辑。扩展运行时动态 `registerProvider` 的 OAuth 登录不在独立宿主 `ModelRuntime` 的公开目录中，不能声称可用。设备码实际时钟跨期 GUI、在线账号、真实人工 OAuth 回调/推理/登出、包内 GUI、原版同状态成对截图与用户验收未完成。 |

## 回填要求

每项填写实际原生 GUI/Pi 版本、提交、测试命令、结果和证据链接；在线 provider、可控模型、包内运行、实际安装与用户验收分别标明。P27 的限制按 #8/#25 逐类明示，不将复杂 TUI 不支持写为已全面兼容。

#15–#24 因范围调整退出，并非交付。旧 I01–I18/US01–US84/T01–T20 仅作 [历史追溯](archive/scope-before-2026-09-27/README.md)。最终范围每项完成且 #28 通过后，才可能关闭 #1。
