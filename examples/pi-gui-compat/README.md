# 固定 Pi 扩展 GUI 兼容样例

本样例使用 `@earendil-works/pi-coding-agent@0.87.0` 的公开扩展 API，代码为本项目原创；没有复制 Pi 或旧原型的扩展源码。Pi 包的许可证为 MIT，版本和上游来源见 [`docs/references/upstream-and-ui.md`](../../docs/references/upstream-and-ui.md)。

把 [`extension.ts`](extension.ts) 放入受信任项目的 `.pi/extensions/`，或在启动固定 Pi RPC 时使用 `--extension <extension.ts>`。加载后在同一会话输入：

- `/gui-compat-demo`：依次选择、确认、输入、编辑；成功时由 Pi 保存一条原始 custom message，并发出通知。每一步取消都不会写入成功结果；status 和字符串 widget 在结束时清除。
- `/gui-compat-image`：保存一条包含文字、PNG 图片和原始 details 的 custom message。GUI 时间线经 Pi 引用按需读取图片，不在行快照中复制 base64。
- `/gui-tui-only`：RPC 下明确发出 `TUI_ONLY_IN_RPC` 警告并结束。在 Pi 的交互式 TUI 下才调用 `ctx.ui.custom()`；这段组件代码不声称有 GUI 等价实现。

样例不会自行请求在线模型，也不创建第二个 Pi 会话。`registerMessageRenderer()` 仅影响 Pi 交互式 TUI 的呈现；GUI 必须按原始 custom message 内容显示，不能因缺少这个 renderer 丢弃消息。`ctx.hasUI` 在 RPC 下也是 `true`，因此扩展应以 `ctx.mode === "tui"` 守卫组件、直接终端输入及其它 TUI 专属调用。

固定 Pi 合同测试：

```powershell
node node_modules/tsx/dist/cli.mjs --test packages/services/test/pi-extension-compat-sample.test.ts
```

该测试在真实 Pi RPC 子进程内验证四类回答、取消、原始 custom message、status/widget 清理，以及复杂 TUI 调用的无 RPC 请求边界。`pi-extension-message-service.test.ts` 另验证原生服务的图片引用和工作区隔离。它们不代替原生 GUI、在线 provider 或安装包验证。GUI 当前可见类别及待实现项见 [`兼容表`](../../docs/delivery/pi-extension-ui-compatibility.md)。
