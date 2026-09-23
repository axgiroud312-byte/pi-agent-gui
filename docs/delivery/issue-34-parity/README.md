# #34 原生操作对照：已取证，待独立逐屏复核

原版证据：[已确认的 #32 原版/产品 26 对基线](../issue-32-parity/index.html)，固定原版 `zai-org/ZCode@872ad960de7ec172591f7e1952f7849229f94521`；#33 用户已确认原生界面。Pi 产品证据：此目录下截图，以及本地独立运行报告 `C:\Users\niilo\AppData\Local\Temp\opencode\pi-34-interaction-probe-10\pi-native-gui-report.json`。产品来自 #34 工作树于 2026-09-23 构建的未签名 Windows x64 包 `pi-34-bundle-interaction/`，通过其实际 `win-unpacked` 可执行文件启动，隔离应用 profile、Pi profile、工作区。此次报告明确记录模型端点 `http://127.0.0.1:64315/v1`（本次运行的临时端口），`openai-completions` 的本地确定性受控服务；**不是在线真实供应商推理**。模型负责输出工具调用意图，实际 `read` 由固定 Pi 0.87.0 子进程在工作区执行；模型收到了文件内容。

| 同一操作面 | 原版入口/截图 | Pi 产品操作及本目录截图 | 已确认事实 / 待复核差异 |
| --- | --- | --- | --- |
| 原生会话流与停止 | #32 基线 `original-1280x800-dark-running.png`、`original-1280x800-dark-waiting.png`，及 #32 停止操作记录 | 原生新建任务→发送；`pi-native-streaming.png` 捕捉模型文本**中间态**；原生停止按钮→`pi-native-stopped.png` | 产品原生按钮可见、停止后状态“已停止”及 `PI_STOP_PARTIAL`；两张图不是原版同视口/同主题的逐像素比较。 |
| Read 工具工作历史 | [原版 1280×800 深色 Read 展开图](../issue-32-parity/original-1280x800-dark-read-tool-expanded.png) | 选 Pi 会话→展开原生“工作历史”→`pi-native-1280x800-dark-restored.png` | 原生 Read 卡可见，状态 `completed`、文件 `README.md`；Pi 的卡片被原生历史默认折叠，脚本必须实际点击展开。消息数量/模型文案不同，**尚待独立视觉复核**。 |
| 文件 Side Pane | [原版 1920×1080 深色文件预览](../issue-32-parity/original-1920x1080-dark-file-preview.png) | 工具卡文件芯片→`pi-native-read-preview.png` | 原生 Side Pane 打开 *Pi 会话工作区* README，包含 `NATIVE_PARITY_PREVIEW`；曾误开应用仓库 README，已修正并有回归断言。 |
| 双视口/明暗与恢复 | #32 基线对应尺寸/主题的 `original-*-empty.png` / `original-*-running.png` | `pi-native-{1280x800,1920x1080}-{light,dark}-restored.png` | 四组合的侧栏、原生 composer、完成态工具卡可见；每张有实际像素尺寸；此轮使用**恢复后历史**，不能冒充和原版空白/运行态同状态的像素对照。 |
| 流式滚动与手动上滚 | 固定原版 `ConversationTimeline.tsx`/`timelineScrollAnchor.ts` 具有跟随与用户滚动保护；#32 原版运行只检查流式显示，**未实际量测滚动** | Pi 产生首段 100 行及后续 18 帧；`pi-native-scroll-follow.png`、`pi-native-scroll-manual.png`、`pi-native-scroll-latest.png` | 产品真实 GUI：自动跟随底部 gap≈0；手动上滚后 top≈3px，在后续四帧到达仍≈3px、底部 gap 由≈700 增至≈749px；原生“返回最新”可见且点击后 gap≈0。**原版同动作运行对照未完成**；尝试在新临时副本离线恢复原版运行依赖遭 `ENOSPC`，已删除仅该失败副本，不能凭源码推断原版实测通过。 |
| Side Pane 文件标签与拖动 | #32 固定原版 `panels.mjs:39–76` 的双文件标签打开、拖拽重排、点击切换、分隔条 -75px 调整均实际通过 | Pi 分别 `read` README 和 hello → 点击原生文件芯片 → `pi-native-tabs-drag.png` | 一次点击文件芯片在“工作历史”展开动画完成后创建/激活第二标签；拖动后次序变为 `hello.txt, README.md`，切回 README，面板宽度由≈740 增到≈815px。未修改原生前端；探针在 Radix 折叠动画完成前点芯片曾丢一次点击，已与原版测试相同等待 350ms，再两次打包入口通过。此等待只是测试时序，不证明真实用户快速点击不会遭遇竞态。 |
| 会话切换 | #32 原版 `navigation.mjs:27–53` 实测新任务草稿与旧任务恢复，没有两个已建立会话反复切换 | 新建第二 Pi 会话并发送文本，在原生侧栏点旧会话、再点新会话；`pi-native-session-switch.png` | 两个不同 Pi session ID 各自恢复原内容，切换未新增任何模型请求；超出 #32 原版已实测范围，标注为产品新增对照，不能冒充原版二会话验收。 |
| 会话 split 与拖拽 | 固定 #32 原版右键中 split 项不可用，见 `evidence.json` 的 `unavailable` | Pi 会话右键同一任务菜单；`pi-native-conversation-split-unavailable.png` | 产品同样出现但禁用 split 入口，**未**私自启用底层隐藏 pane/store；Side Pane 标签拖拽不能替代会话 split。后续 #5 实现与验收，不记作 #34 已支持。 |

报告记录 `streamPartialVisible=true`、`nativeToolCardVisible=true`、`restoredToolCardVisible=true`、`readPreviewMarkerVisible=true`、`helloFirstClickVisible=true`、`restartReplayed=false`、`pageErrors=[]`、两次退出无幸存。只显示工具卡、按钮或截图不代表在线供应商、旧引擎所有入口、原版滚动锚点/多会话或多分栏体验已验收。原版拆分在 #32 构建中未启用，按 #5 后续处理。**本票独立 Standards/Spec 审查和原版流式滚动实际运行对照仍待完成**，不以本表代替结论。
