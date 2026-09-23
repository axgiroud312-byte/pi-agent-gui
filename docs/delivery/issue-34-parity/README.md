# #34 原生操作对照：已取证，待独立逐屏复核

原版证据：[已确认的 #32 原版/产品 26 对基线](../issue-32-parity/index.html)，固定原版 `zai-org/ZCode@872ad960de7ec172591f7e1952f7849229f94521`；#33 用户已确认原生界面。Pi 产品证据：此目录下截图，以及本地独立运行报告 `C:\Users\niilo\AppData\Local\Temp\opencode\pi-34-packaged-final\pi-native-gui-report.json`。产品来自 #34 工作树于 2026-09-23 构建的未签名 Windows x64 包，通过其实际 `win-unpacked` 可执行文件启动，隔离应用 profile、Pi profile、工作区；模型由受控本地端点回答，工具由固定 Pi 0.87.0 子进程执行。

| 同一操作面 | 原版入口/截图 | Pi 产品操作及本目录截图 | 已确认事实 / 待复核差异 |
| --- | --- | --- | --- |
| 原生会话流与停止 | #32 基线 `original-1280x800-dark-running.png`、`original-1280x800-dark-waiting.png`，及 #32 停止操作记录 | 原生新建任务→发送；`pi-native-streaming.png` 捕捉模型文本**中间态**；原生停止按钮→`pi-native-stopped.png` | 产品原生按钮可见、停止后状态“已停止”及 `PI_STOP_PARTIAL`；两张图不是原版同视口/同主题的逐像素比较。 |
| Read 工具工作历史 | [原版 1280×800 深色 Read 展开图](../issue-32-parity/original-1280x800-dark-read-tool-expanded.png) | 选 Pi 会话→展开原生“工作历史”→`pi-native-1280x800-dark-restored.png` | 原生 Read 卡可见，状态 `completed`、文件 `README.md`；Pi 的卡片被原生历史默认折叠，脚本必须实际点击展开。消息数量/模型文案不同，**尚待独立视觉复核**。 |
| 文件 Side Pane | [原版 1920×1080 深色文件预览](../issue-32-parity/original-1920x1080-dark-file-preview.png) | 工具卡文件芯片→`pi-native-read-preview.png` | 原生 Side Pane 打开 *Pi 会话工作区* README，包含 `NATIVE_PARITY_PREVIEW`；曾误开应用仓库 README，已修正并有回归断言。 |
| 双视口/明暗与恢复 | #32 基线对应尺寸/主题的 `original-*-empty.png` / `original-*-running.png` | `pi-native-{1280x800,1920x1080}-{light,dark}-restored.png` | 四组合的侧栏、原生 composer、完成态工具卡可见；每张有实际像素尺寸；此轮使用**恢复后历史**，不能冒充和原版空白/运行态同状态的像素对照。 |

报告记录 `streamPartialVisible=true`、`nativeToolCardVisible=true`、`restoredToolCardVisible=true`、`readPreviewMarkerVisible=true`、`restartReplayed=false`、`pageErrors=[]`、两次退出无幸存。只显示工具卡、按钮或截图不代表在线供应商、旧引擎所有入口、原版滚动锚点/标签/多分栏体验已验收。原版拆分在 #32 构建中未启用，按 #5 后续处理；**本票独立 Standards/Spec 审查须逐屏/逐操作复核并记录缺陷，不以本表代替结论**。
