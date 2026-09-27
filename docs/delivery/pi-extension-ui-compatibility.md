# Pi 0.87.0 扩展 UI 在原生 GUI 的边界

2026-09-27；#8 的逐类开发记录，关联 #13/#25。版本与请求形状来自固定的
`@earendil-works/pi-coding-agent@0.87.0` 的 `core/extensions/types.d.ts` 和
`modes/rpc/rpc-types.d.ts`，不是对任意版本或任意第三方扩展的承诺。

| 公开 `ctx.ui` 类别 | 固定 Pi RPC | 本次原生 GUI 状态 | 仍需处理 |
| --- | --- | --- | --- |
| `select` | 带候选项的请求/响应 | 同一 Pi 会话投影到原生选择弹窗；只接受 Pi 给出的候选值，取消和旧请求拒绝；固定 Pi 测试通过 | 包内 GUI 与键盘/焦点复验 |
| `confirm` | 标题、正文、布尔响应 | 原生弹窗显示正文，确认/拒绝分别回传布尔值；固定 Pi 测试通过 | 包内 GUI 和文案复验 |
| `input` | 标题、placeholder、字符串响应 | 原生单行输入，空字符串按 Pi 值回传；固定 Pi 测试通过 | 包内 GUI 和 IME 复验 |
| `editor` | 标题、prefill、字符串响应 | 原生多行输入；按交互 ID 重建弹窗，防止上一请求的输入污染；固定 Pi 测试通过 | 包内 GUI、长文本与取消复验 |
| `notify` | 单向 `extension_ui_request` | 原生会话底部显示最近八条；同一 RPC ID 不重复，公开桥内部回复与生命周期标记不展示 | 原生 GUI、包内 GUI、通知溢出和隐私复核 |
| `setStatus` | 单向 key/text，可清除 | 按 key 更新/清除，随 Pi reload/shutdown 或进程退出清理 | 原生 GUI、包内 GUI、长文本和焦点复核 |
| `setWidget` 的 `string[]` | 单向行内容/位置，可清除 | 只将可序列化文本放在原生 composer 上方或下方；按 key 更新/清除，随 Pi 生命周期清理 | 原生 GUI、包内 GUI、狭窄窗口复核 |
| `setTitle`、`setEditorText` | 单向标题/输入文本 | `setTitle` 在扩展信息面显示，不改 Pi JSONL 会话名；`setEditorText` 显示原文并提供显式应用，空草稿门禁防止覆盖用户未发送内容 | 自动覆盖式 TUI 语义没有等价实现；原生 GUI、包内 GUI、长草稿/IME 复核 |
| `setWidget` 的组件 factory、`custom`、`setHeader`、`setFooter`、`setEditorComponent` | RPC 无可序列化的 TUI 组件/焦点合同 | 不提供通用 TUI 渲染器，不声称 GUI 等价 | 代表扩展逐项适配，或明确说明不可用 |
| raw terminal input、主题对象、autocomplete factory、working indicator | 交互模式的终端对象/回调没有对应 RPC UI 消息 | 不声称 GUI 等价 | #25 代表扩展兼容边界复核 |

固定 Pi 真实会话测试 `packages/services/test/pi-extension-native-interaction.test.ts`
覆盖同一 PID 的连续四种请求、非法回答、Stop、取消及公开桥 reload 后拒绝旧回答。
`packages/ui/test/piExtensionProjection.test.ts` 覆盖方法、placeholder、正文和 prefill
投影。上述不是原生 GUI 目视或包内运行证据；两项证据须独立补充。

#13 增量以固定 Pi 0.87.0 的 `extension_ui_request` 为唯一状态来源；公开控制桥 1.2.0
在 `session_start` / `session_shutdown` 发出内部生命周期标记。Host 在初始 `get_state`
前保留有界的启动期 UI 记录，并将同一会话的键控状态经 v4 snapshot/delta 显示。
`packages/services/test/pi-extension-ui-projection.test.ts` 用真实 Pi 子进程确认启动状态、
同一 PID 的动态工具开关读回、reload 换代和旧状态清除；
`pi-extension-ui-state.test.ts` 验证更新、清除、去重、内部通知保密与旧代 shutdown 不误删。
这些仍是自动合同。隔离源码原生 GUI 在
`D:/Temp/pi-extension-state-gui-20260927-d/pi-extension-state-gui-report.json`
确认可见状态、显式应用输入建议、Pi 动态工具启停读回和 reload 清理；
`pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`。
该证据不代表包内 GUI 或安装包验收。信息面采用原生底部 dock，
最终还需与固定 ZCode 原版做成对截图、窄窗口/明暗主题和键盘焦点复核。

工具目录和 active tools 从同一 Pi 公开桥的 `getAllTools()` / `getActiveTools()` 读取；
原生树弹窗只接收名称与描述，保存时走 Pi 的 `setActiveTools()` 并以 Pi 读回为准。
不把系统提示词、工具参数 schema 或 provider 密钥送入 renderer。动态工具能在下一次读取时出现；
运行中控制仍受 Pi idle 与会话 generation 门禁约束。覆盖工具、输入变换、provider 和错误边界
须按具体代表扩展继续验证，不能仅凭本切片声称 P23/P24 全部完成。

P23 同名覆盖的独立样例在 `examples/pi-gui-compat/tool-override.ts`：仅显式加载时用
Pi `registerTool({ name: "read" })` 覆盖内建 `read`。固定 Pi 合同确认模型工具目录与
原生工具选择器只列一个 `read`，其描述来自扩展，实际工具回合和 Pi JSONL/原生行
包含扩展 marker，目标文件的内建读取 marker 不出现。原生 Read 文件 chip 保留，
真实 Pi 结果在同一行的“Pi 工具结果”中默认折叠，用户展开后可读文字、图片、details
及错误；普通内建 read 不会自动铺满时间线。隔离 GUI 报告
`D:/Temp/pi-read-override-gui-20260928-c/pi-read-override-gui-report.json` 验证目录、
工具执行、展开、JSONL 与正常进程退出；在线 provider、包内 GUI 和其他同名工具仍待验。
该样例只作验证，不作为默认扩展。

服务不建立第二个 Agent loop 或请求队列。Pi 的 `extension_ui_request`、
`extension_ui_response` 与会话运行状态仍是唯一事实来源；原生 dialog 只是单次回答入口。

## #25 代表样例与明确不兼容边界

Pi 0.87.0 的 `input` 事件接受 `transform`（文字及图片）与 `handled`。原始 RPC `prompt`
对已处理且无 Agent 回合的输入只回成功，不能仅凭随后空闲的 `get_state` 猜测是哪种情况。
本仓库固定 Pi 0.87.0 补丁在同一次 preflight 回执中附 `disposition`；Host 仅在 Pi
明确报告 `handled` 时收口普通输入，不伪造用户消息或模型回合。代表样例同时覆盖
原图进入同一模型请求与 Pi JSONL，以及 `handled` 后输入区恢复。补丁缺失或回执
未知时保持待核对状态；动态扩展的转换逻辑本身不在 GUI 中重做。
对实际运行输入，Pi 回执另给扩展、模板与图像提示处理后的文本 SHA256；Host 仅以
Pi 的该值关联待完成输入，并在同次 ACK 后、下一次状态读取前持久化会话书签；不在 GUI 中重算转换。
固定 Pi 合同还验证模板展开后的下一条
输入可继续发送。`D:/Temp/pi-input-transform-gui-20260928-b/pi-extension-input-transform-gui-report.json`
记录隔离原生 GUI 的两个 Pi 会话、图片 MIME/字节 SHA、扩展重载和 `handled` 无模型调用；
`pageErrors=[]`，退出 `graceful=true`、`forced=[]`、`survivors=[]`。该报告使用受控
loopback 模型，不代表在线 provider 或包内 GUI。

队列/引导提交同样先进入固定 Pi 的公开 input handler：若它返回 `handled`，Pi RPC
成功回执没有 queue item ID。Host 仅在固定 `pi-gui-queue/1` 已证明实际排队必有稳定 ID、
且此回执确实没有其他字段时，返回明确的 `inputAccepted.delivery=startNow` 与
`pi.inputHandledByExtension`，由原生 GUI 提示“立即处理、没有入队”；该 ACK 在持久
admission 与 renderer 恢复账本中收口，不等待不会出现的队列项或用户 JSONL 行。
代表样例的图片处理通知记录 Pi input handler 收到的 MIME 和字节 SHA256。

可运行样例为 [`examples/pi-gui-compat/extension.ts`](../../examples/pi-gui-compat/extension.ts)，
使用方法见 [样例 README](../../examples/pi-gui-compat/README.md)。它在同一固定 Pi RPC 会话中
依次触发四种问答、status、字符串 widget、title 与 notify；结束时清除自身 status/widget，
并把原始 custom message 留在 Pi 历史。`/gui-compat-image` 另保留交错文字/图片和 details，
原生行用有作用域的 Pi 图片引用读取原始字节。`gui_rich_probe` 是 Pi 公开扩展工具，
模型调用后把交错文字/图片与原始 details 留在同一 Pi JSONL 的 toolResult 中；
原生工具行按同一引用读取图片。取消不会产生成功消息。`/gui-tui-only` 在 RPC 下
明确发出限制通知；真实 TUI 下才调用 `ctx.ui.custom()`。该样例使用 Pi 公开 API 和本项目原创代码，
没有移植旧 `pi-tui-8` 的 headless TUI 宿主或组件渲染器。

以下是固定 `@earendil-works/pi-coding-agent@0.87.0` **Pi RPC 行为**，不自动表示本 GUI 已完成映射：

| 类别 | Pi RPC 实际行为 | GUI 等价边界 |
| --- | --- | --- |
| `select` / `confirm` / `input` / `editor` | 请求带 ID，等待 `extension_ui_response`；取消返回 `undefined` 或 `false` | #8 的原生弹窗已接；请求归属、超时、Stop、reload 和包内 GUI 仍按 #13/#25 复验 |
| `notify`、`setStatus`、字符串数组 `setWidget`、`setTitle`、`setEditorText` | 发单向 RPC 事件；widget 可按 key 清空，并区分编辑器上/下方 | #13 正在映射；无返回值不能作为界面已显示的成功证明；`setEditorText` 须保护现有草稿 |
| `custom()` | RPC 直接返回 `undefined`，没有可回答请求 | 组件 modal/overlay 不能自动映射；扩展须提供普通问答替代或 `ctx.mode` 守卫后的可操作说明 |
| 组件 factory `setWidget` | Pi RPC 忽略 factory，不发事件 | 仅 `string[]` widget 有 RPC 路径；组件需扩展作者提供文本/结构化替代 |
| `setHeader` / `setFooter` / `setEditorComponent` | Pi RPC 不调用 factory，也不发事件 | 不复刻任意 TUI 布局、焦点和按键状态机；需要逐扩展适配 |
| `onTerminalInput`、autocomplete factory、working loader、隐藏 thinking label、工具展开 | RPC 为无操作或固定默认值 | 直接 stdio/ANSI 输入和终端装饰不能由 GUI 假装已经执行 |
| `setTheme` / 主题对象 | `setTheme()` 返回失败，主题目录查询为空 | GUI 主题由原生设置负责；扩展切换 Pi TUI 主题不代表 GUI 已换主题 |
| message / entry / tool renderer、Markdown transformer | 只在 Pi TUI 展示流程执行，不提供 RPC 组件协议 | 原生时间线保留 `display:true` custom message 及 toolResult 的有序文字、图片引用和 details；`display:false` 按 Pi 意图留在原始历史但不显示。非消息 entry 和复杂 TUI 布局仍需逐扩展验证 |

**判断守卫**：Pi 文档明确 `ctx.hasUI === true` 也适用于 RPC，因为四类问答和单向消息可用。
组件、直接终端输入、主题和 renderer 必须判断 `ctx.mode === "tui"`。复杂第三方扩展如果
只在 TUI 里实现交互，GUI 无法从不存在的 RPC 请求推断它需要什么输入；要支持它，需由扩展
提供公开的 RPC 交互替代，或另立有版本和许可记录的专用适配。首版不承诺通用 ANSI/TUI 引擎。

`packages/services/test/pi-extension-compat-sample.test.ts` 的固定 Pi 0.87.0 子进程测试验证：
四种回答后原始消息仍在 Pi 历史，取消不写成功消息，status/widget 发出清除事件；
独立不兼容探针证实 RPC 的 `hasUI=true`、`custom=undefined`、组件 factory 没有调用、
`setTheme` 返回失败，且不存在隐含 `custom`/组件 widget 请求。GUI 展示、两会话、
reload/Stop、包内运行和用户验收尚需与 #13 集成后验证。
`pi-message-rows.test.ts` 的红绿回归验证 custom message 在 live/restore 均保留有序文字、
图片引用和 details；`pi-extension-message-service.test.ts` 用真实固定 Pi 验证原生行图片字节
按会话/工作区读取。预览继续遵守现有 20 MiB 单图上限；更大的 Pi 原始数据仍在 JSONL，
GUI 的预览会明确失败。`pi-extension-rich-tool.test.ts` 的固定 Pi 0.87.0 合同验证工具注册与执行、Pi JSONL 的图文/details、冷投影和工作区/行范围图片读取；
`D:/Temp/pi-rich-tool-gui-20260928-c/pi-rich-tool-gui-report.json` 的生产源码原生 GUI 验证模型第二请求确实收到 PNG、展开原生工具组后图文/details 可见，且 `pageErrors=[]`、`graceful=true`、`forced=[]`、`survivors=[]`。
旧公共会话分享投影遇到这些原始 custom/tool 行先拒绝，避免未经审查的 details 或本地引用泄漏。#9 的 Pi Gist 分享是另一条路径：它导出完整 Pi HTML，会在外发前展示原文并要求用户显式确认；原始 details 和会话内容仍可能随 HTML 发布，不能把公共投影的拒绝保证套用到 Gist。
固定来源：
[`Pi 上游提交`](https://github.com/earendil-works/pi/tree/16787ad5b2dc748047f314ca1bfe7708f30f54f3/packages/coding-agent)
MIT，npm 0.87.0 的 `dist/modes/rpc/rpc-mode.js`、`rpc-types.d.ts`、`core/extensions/types.d.ts`；
项目采用的是公开包和类型，没有依赖 npm 未公开的深层导入。
