# 重建前的旧成果与处置

资产盘点日期：2026-09-22。当前原生底座已由PR #37合并为`59362a3`，#33确认完成；下面是旧资产快照。**保留这些分支和worktree，按模块审查复用。** 本表记录来源和已有证据，不是新原生Pi工程的完成状态。

## 已合并的旧基础

- 历史原型主线：`46c34f18011030024225cf71fd3e829dc31a57b4`，PR #31（#2/#30 CLOSED）。
- 该历史提交尚未导入原生ZCode，是自建Electron/shadcn/assistant-ui原型；当前原生主线不以其前端为底座。
- 实际检查提交 `b3dfa3e`：39 runtime/host、2 real-Pi contracts、8 Electron E2E、Windows NSIS 和打包真实 Pi smoke 通过。可复用协议、错误恢复和隔离测试；不证明原生交互一致。
- [历史 CI](https://github.com/axgiroud312-byte/pi-agent-gui/actions/runs/35672418605)、[测试证据](https://github.com/axgiroud312-byte/pi-agent-gui/actions/runs/35672418605/artifacts/10671832965)、[旧开发包](https://github.com/axgiroud312-byte/pi-agent-gui/actions/runs/35672418605/artifacts/10671168594)。CI artifacts 有保留期限。

## 未集成的功能资产

worktree 父目录：`C:\Users\niilo\AppData\Local\Temp\opencode`。以下提交实际存在；尚未经过新路线的独立集成验收。

| Issue / 分支 | Worktree | 固定提交 | 复用方向及边界 |
| --- | --- | --- | --- |
| #3 `issue-3-rich-conversation` | `pi-conversation-3` | `8071778ded4effb253b4dc7fa9d8e1a23f208c25` | 图片/RPC/消息/工具/模型/压缩/统计合同；原生 Lexical/时间线取代旧展示层 |
| #6 `issue-6-tree-bridge` | `pi-bridge-6` | `43289a0586a76a6cd1b9cb2720fbe4d4f44fdf2e` | 公共扩展树桥、标签、工具目录、reload及真 Pi 测试；UI 迁到原生入口 |
| #7 `issue-7-provider-auth` | `pi-auth-7` | `bde41fcb3a5ad1c7e8d5a75ff31f835708e82f37` | ModelRuntime 管理/认证/cancel 合同；原生设置接入；真实账户完整验收仍缺 |
| #8 `issue-8-tui-compat` | `pi-tui-8` | `7d9e4079d020c881b0ade5393d29053b547543ba` | 同进程 TUI 宿主、固定 CLI 补丁、生命周期及 headless合同；不等于全 P27 |
| #14 `issue-14-file-editor` | `pi-editor-14` | `ea845ae72711e7f6892a7863a7baafb255a098b9` | 文件版本/草稿/冲突/上下文测试；先比较原生服务再决定迁入缺额 |
| #16 `issue-16-real-terminal` | `pi-terminal-16` | `2e17056093ce580d24ed3f31ff7b513ae6fa7a59` | PTY进程/ABI/取消/日志及Windows验收；保留原生终端UI与服务入口 |
| #32 `issue-32-zcode-workbench` | `pi-zcode-32` | `fb2939cf1b50cdf5ea458e8e9bc650ce439959fe` | 样式和组件来源研究、许可文件；**不是原生底座，也不是已通过的交互基线** |

证据分别在各 worktree 的 `docs/delivery/issue-*-evidence.md`（认证为 `issue-7-auth-evidence.md`）。旧测试计数/截图属于这些提交，迁入后必须复验。旧 #32 之前的本地“完成”评论保留作历史，当前正文和重建评论覆盖其路线。

另有 #2 的 `issue-2-rpc-transport`、`issue-2-renderer`、`issue-2-e2e` 工作树，内容已进入 #31，不重复领取。`integration/first-release` 停在 `46c34f1`，不继续旧批次整合。

## 已知外部验收差额

- 旧主线真实 `openai-codex/gpt-5.5` 文本成功（449 tokens）；`aio-codex/gpt-5.4-mini` 为 Connection error，未通过。
- #3 分支报告真实文本/read/model/thinking通过；图片报告 image reading disabled、压缩 session too small。确定性 provider 的图片/压缩成功不替代真实验收。
- #7 分支尚缺用户完成的真实 API-key/OAuth 登录、刷新/推理和登出闭环。
- 上述都是旧路线证据；新原生产品需要自己的真实链路和运行证据。

## 固定上游来源

已有源码研究 clone：`C:\Users\niilo\AppData\Local\Temp\opencode\zcode-source-872ad96`，HEAD `872ad960de7ec172591f7e1952f7849229f94521`，**sparse checkout，仅部分UI源码**。它不能直接当成完整可构建导入；新实施应核对并取得全部必要固定源码、lockfile、资源与第三方声明。

## 迁入规则

保留来源提交 → 对照新原生模块职责 → 选择需要的 Pi 实现/测试 → 记录移植边界和许可 → 在原生服务适配中集成 → 重新验收与审查。共享旧 App/preload/样式修改不整批 cherry-pick；也不删除未检查的旧工作。
