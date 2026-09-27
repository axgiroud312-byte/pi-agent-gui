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

### #6 原生服务移植记录（2026-09-27，隔离分支待整合）

对照旧 `43289a0` 的 `pi-bridge-extension.ts`、`bridge-controller.ts` 和真 Pi 测试，保留了版本化 slash command、`get_commands` 发现、notify 关联结果、会话代次和 `reload` 后新绑定确认这些公共 API 用法。本次在原生 `PiSessionSupervisor` 的一会话一 Pi 进程及 JSONL 租约下重写为 `packages/services/src/pi-agent/pi-control-{protocol,bridge,bridge-extension}.ts`；旧 App、preload、session switch/newSession 和自建 UI 没有移植。树与 entries 由 Pi RPC 读取，跳转用 `ExtensionCommandContext.navigateTree`，标签用 `pi.setLabel`，重载用 `ctx.reload`。`PiTreeDialog` 接入原生 `SessionPane`，并以原生 `ComposerRestoreRequest` 恢复用户输入文本。

跳转后若不产生新消息，Pi 0.87.0 的内存叶子在进程重启时会回到 JSONL 最末条。因此成功跳转后使用公开 `pi.appendEntry` 在当前分支写入不参与模型上下文的自定义导航节点；重启回归验证书签和当前分支都由 Pi JSONL 恢复。固定 Pi 0.87.0 来源为仓库已声明的 `@earendil-works/pi-coding-agent`，版权与许可证沿用 `THIRD_PARTY_NOTICES.md` 的 Pi 声明。受控本地 provider 的测试结果不计在线 provider 或 GUI 视觉验收。

### #12 原生资源管理增量（2026-09-27）

沿用上述 `pi-control` 桥及原生 `SessionPane`、Dialog/Button，没有迁入历史原型的资源界面。固定 Pi `@earendil-works/pi-coding-agent@0.87.0` 的公开根导出 `DefaultPackageManager`、`SettingsManager`、扩展 `pi.getCommands()` / `ctx.getSystemPromptOptions()` / `ctx.reload()` 和 RPC `get_commands` 是实现依据；包的安装、移除、更新与过滤交给 Pi，自身只加版本化控制与文件哈希冲突保护。Pi `config-selector` 的 `+/-` 资源覆盖规则仅作为行为参考，未复制源码。固定来源为 [Pi v0.87.0](https://github.com/earendil-works/pi/tree/16787ad5b2dc748047f314ca1bfe7708f30f54f3/packages/coding-agent)，许可证 MIT，声明仍见 `THIRD_PARTY_NOTICES.md`。临时 Git 测试仓库、受控本地模型和源代码 UI 编译不等于最终桌面 GUI/在线 provider/包内验收。

另有 #2 的 `issue-2-rpc-transport`、`issue-2-renderer`、`issue-2-e2e` 工作树，内容已进入 #31，不重复领取。`integration/first-release` 停在 `46c34f1`，不继续旧批次整合。

### #7/#8 原生认证与扩展交互移植记录（2026-09-27，隔离分支待整合）

对照旧 #7 `bde41fc` 的 ModelRuntime 认证、取消和凭据状态测试，仅沿用固定 Pi 公开 API 的做法；旧私有 loopback、旧 Settings UI 和自有 provider 状态源没有移植。新实现是 `packages/services/src/pi-agent/pi-auth-manager.ts`，使用 Pi 0.87.0 `ModelRuntime` 管理 RPC 子进程实际 `PI_CODING_AGENT_DIR` 内的 `auth.json` / `models.json`，在原生 Settings 的模型提供商页显示非秘密状态。认证写入后由版本化公开控制桥在同一 Pi RPC 会话调用 `ctx.modelRegistry.refresh({allowNetwork:false})`；不能把宿主侧保存成功冒充为在线推理通过。公开桥版本从 1.0.0 增至 1.1.0，Pi 协议版本仍为 1。

对照旧 #8 `7d9e407` 的 TUI 兼容研究，本次只移植 RPC 可序列化的 `select`、`confirm`、`input`、`editor` 交互合同和真 Pi 顺序测试；旧 headless TUI 宿主、CLI 补丁、组件渲染器和第二会话没有移植。原生 `V4InteractionDialogs` / `V4UserInputDialog` 复用已有弹窗路径，具体类别边界见 [扩展 UI 兼容表](pi-extension-ui-compatibility.md)。这些增量代码使用固定 Pi 的公开接口；版权与许可证沿用 `THIRD_PARTY_NOTICES.md` 的 Pi 声明。

### #13 扩展状态和工具原生移植记录（2026-09-27，隔离分支待整合）

对照旧 #8 `7d9e407` 的 TUI 兼容研究，只取固定 Pi 0.87.0 RPC 可序列化的
`notify`、`setStatus`、`setWidget(string[])`、`setTitle`、`setEditorText`；
没有移入旧 headless TUI 宿主或组件 factory。原生 `SessionPane` 底部 dock 复用现有
`Button`、弹窗、空草稿恢复门禁；公开桥在同一 Pi 会话读回动态工具目录与启用状态。
`setEditorText` 采用显式应用，避免覆盖未发送草稿；这与 TUI 自动写编辑器有差异。
Pi 的 MIT 来源及固定版本见 `THIRD_PARTY_NOTICES.md` 与
[上游参考](../references/upstream-and-ui.md)，原生组件来自当前 ZCode 底座。

### #9 Pi fork/clone 原生纵向切片（2026-09-27，隔离分支待整合）

沿用原生 `SessionPane`、`PiTreeDialog` 和 V4 命令/会话选择，不迁入旧原型的会话列表或 Agent 状态。固定 Pi 0.87.0 公开 RPC 的 `get_fork_messages`、`fork(entryId)`、`clone()`、`get_state` 与 Pi JSONL 是分支事实；Host 只维护原生命令回执、进程及文件租约。Pi 成功替换会话后，旧 RPC 进程完整退出再恢复新会话，防止同一进程写着 child 却仍用父会话身份。取消返回 `noop`，不创建 child；不确定的交付阻止自动重试。Pi 来源与 MIT 声明见固定上游参考及 `THIRD_PARTY_NOTICES.md`。

图片 fork 沿用同一原生会话树和 Lexical composer：Pi 仍独占分支事实；Host 从固定 Pi 的 `get_entries` 按用户选中的 `entryId` 和图片块序号取原 JSONL 字节，经带同源会话身份的分块引用恢复到 child 的现有 IndexedDB 草稿。没有搬入旧原型附件系统，也没有增加 Agent 队列。重复图片及 off-branch entry 必须按精确 entry ID 读取，不能按图片字节搜索当前行；重启和显式发送由原生 GUI 验证。冷 Pi session 确认删除后，清理的仍是现有本地文字与图片草稿存储。

### #9 Pi 导入、导出与主动分享纵向切片（2026-09-28，隔离分支待整合）

继续沿用原生 `SessionPane`、Dialog/Button、文件/目录选择器和会话选择，未迁入旧原型的分享 UI 或任务索引。固定 Pi 0.87.0 公开 RPC 的 `get_last_assistant_text`、`export_html`、根导出 `SessionManager.forkFrom` 和 Pi JSONL 是实现来源；Pi TUI `/share` 的 `gh gist create --public=false` 仅作为外发协议参考，GUI 不调用私有 TUI 组件。Pi MIT 声明见 `THIRD_PARTY_NOTICES.md`。宿主仅做受限 JSONL 字节/版本/树校验、原文件未变化校验与本地导出复制；分享保留 Pi HTML 原字节，必须由用户预览和勾选后才调用 `gh`。测试注入本地发布器，不会产生远程 Gist；Windows 目标目录的 ACL 由用户选择，不能把 POSIX `0600` 宣称为 Windows ACL 隔离。

### #10 Pi 设置来源修正（2026-09-28，隔离分支待整合）

继续复用原生 Settings 两栏、现有 Pi JSON 编辑器和固定 Pi 0.87.0 根导出 `SettingsManager`、`ProjectTrustStore`；没有迁入旧路线设置页或另建配置存储。依据固定包的 `settings-manager.js` 全局 getter 与 `main.js` 的 HTTP proxy 引用，项目文件中的 `cacheWarming`、`defaultProjectTrust`、`httpProxy` 不投影为实际生效值，但原始文件保留。嵌套值按现有 `sourcePaths` 逐叶展示来源，避免把混合用户/项目的 `retry` 总体标成项目来源。Pi MIT 来源及许可证见 [上游参考](../references/upstream-and-ui.md) 和 `THIRD_PARTY_NOTICES.md`；固定版本之外的设置语义尚未承诺。

### #9 Pi 历史编辑与重试纵向切片（2026-09-28，隔离分支待整合）

保留原生 `PiTreeDialog`、`SessionPane`、Lexical composer 和 V4 命令 ledger。固定 Pi 0.87.0 的公开 `get_entries`、扩展 `ctx.navigateTree` 和 RPC `prompt` 是唯一历史与回合来源；没有移植旧原型的行复制、Agent loop 或队列。编辑仅将可无损表示的纯文字交给原生 composer，图片和文件快照明确阻止；重试从 Pi 原 entry 取图文并在同一 Pi 会话分支上发出。公开控制桥版本由 1.2.0 提升到 1.3.0，`mode: retry` 明确不把图片误当文字编辑。Pi 来源及 MIT 声明见固定上游参考与 `THIRD_PARTY_NOTICES.md`。

## 已知外部验收差额

- 旧主线真实 `openai-codex/gpt-5.5` 文本成功（449 tokens）；`aio-codex/gpt-5.4-mini` 为 Connection error，未通过。
- #3 分支报告真实文本/read/model/thinking通过；图片报告 image reading disabled、压缩 session too small。确定性 provider 的图片/压缩成功不替代真实验收。
- #7 分支尚缺用户完成的真实 API-key/OAuth 登录、刷新/推理和登出闭环。
- 上述都是旧路线证据；新原生产品需要自己的真实链路和运行证据。

## 固定上游来源

已有源码研究 clone：`C:\Users\niilo\AppData\Local\Temp\opencode\zcode-source-872ad96`，HEAD `872ad960de7ec172591f7e1952f7849229f94521`，**sparse checkout，仅部分UI源码**。它不能直接当成完整可构建导入；新实施应核对并取得全部必要固定源码、lockfile、资源与第三方声明。

## 迁入规则

保留来源提交 → 对照新原生模块职责 → 选择需要的 Pi 实现/测试 → 记录移植边界和许可 → 在原生服务适配中集成 → 重新验收与审查。共享旧 App/preload/样式修改不整批 cherry-pick；也不删除未检查的旧工作。
