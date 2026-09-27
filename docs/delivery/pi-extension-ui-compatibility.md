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
| `notify` | 单向 `extension_ui_request` | 控制桥的专用通知已关联并隐藏；一般扩展通知尚未进入用户可见通知面 | #13/#25 投影及防重复/隐私测试 |
| `setStatus` | 单向 key/text，可清除 | 尚未在原生状态区投影 | #13/#25 keyed 生命周期与退出清理 |
| `setWidget` 的 `string[]` | 单向行内容/位置，可清除 | 尚未在原生面板投影 | #13/#25 布局、长文本和清理 |
| `setTitle`、`setEditorText` | 单向标题/输入文本 | 尚未映射到原生会话标题与草稿 | #13/#25 保留用户草稿和标题来源优先级 |
| `setWidget` 的组件 factory、`custom`、`setHeader`、`setFooter`、`setEditorComponent` | RPC 无可序列化的 TUI 组件/焦点合同 | 不提供通用 TUI 渲染器，不声称 GUI 等价 | 代表扩展逐项适配，或明确说明不可用 |
| raw terminal input、主题对象、autocomplete factory、working indicator | 交互模式的终端对象/回调没有对应 RPC UI 消息 | 不声称 GUI 等价 | #25 代表扩展兼容边界复核 |

固定 Pi 真实会话测试 `packages/services/test/pi-extension-native-interaction.test.ts`
覆盖同一 PID 的连续四种请求、非法回答、Stop、取消及公开桥 reload 后拒绝旧回答。
`packages/ui/test/piExtensionProjection.test.ts` 覆盖方法、placeholder、正文和 prefill
投影。上述不是原生 GUI 目视或包内运行证据；两项证据须独立补充。

服务不建立第二个 Agent loop 或请求队列。Pi 的 `extension_ui_request`、
`extension_ui_response` 与会话运行状态仍是唯一事实来源；原生 dialog 只是单次回答入口。
