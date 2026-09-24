# #34 Windows CI：原版 / Pi 产品断言映射

状态：本轮用户已批准按 Agent 边界分流测试；独立审查、最新提交 Windows CI、逐屏视觉复核仍是合并关卡。只收尾 #34，不实现或关闭后续能力票。

## 为什么不能只删除 `/compact`

最新失败日志来自 `280e01e` 的 Windows PR run [35825880290](https://github.com/axgiroud312-byte/pi-agent-gui/actions/runs/35825880290) 和 push run [35825878291](https://github.com/axgiroud312-byte/pi-agent-gui/actions/runs/35825878291)。旧 smoke 不仅要求 ZCode `/compact` 菜单，还调用 `Read(file_path)` / `AskUserQuestion` 并要求原 Agent 等待界面。这些不是 Pi 的同名能力。

固定真实 Pi 0.87.0 的 `packages/services/test/pi-rpc-commands.test.ts` 验证：`get_commands` 包含实际扩展 `llama` 与显式模板，不含 TUI 内建 `compact/model/settings/help`；压缩是独立 `compact` RPC（空历史有真实 manual compaction 事件及失败）；把 `/compact` 作为 `prompt` 会原样送给模型，不会触发压缩；实际模板能展开。受控的是模型 HTTP 端点，不是 Pi 进程或工具。

当前适配没有把 Pi `get_commands` 投影到 GUI，**GUI 空菜单不代表 Pi 命令目录为空**，也不代表压缩 GUI 完成。

## 逐项保留与替换

| 原断言 / 用户能力 | 原版 `--baseline original` | Pi 产品 `--baseline product` / 补充门禁 | 状态边界 |
| --- | --- | --- | --- |
| 引导、中文、品牌和厂商入口 | 原版引导保持；不要求 Pi 品牌 | 原生引导、中文、品牌/账户排除、BYOK 表单及配置入口保留全部断言 | 不等于 Pi 认证设置已完成 |
| 工作区文件夹选择、真实 Git 目录 | 原断言保留 | 同一原生 chooser 与真实临时目录 | GUI → 实际宿主 |
| 双尺寸 / 明暗主题 / 空态 | 四组合全部保留 | 四组合全部保留 | 不用 DOM 通过冒充视觉逐屏通过 |
| Lexical、换行、合成 IME、草稿、焦点 | 原断言保留 | 同样保留 | 物理 IME 留在 #26 |
| `/compact` 建议、键盘选择、Escape | 原断言及截图原样保留 | 真实 Pi 命令合同 + GUI `/` 草稿/Escape 不发送、不假称压缩；不伪造 `/compact` 建议 | Pi 资源菜单和压缩 GUI 明确未完成：#10/#12，不计 PASS |
| `@README` 文件建议和选择 | 原断言保留 | 原断言保留 | 不宣称全部附件/引用已送入 Pi |
| 权限模式文案 | 原版 Build / Plan 等原路径保留于固定隔离源码 | Pi 工具栏同位置明确“Pi 工具直接执行”，提示当前没有逐项审批；不提供无法执行的权限选项，服务拒绝 Plan/yolo 等不支持约束 | S1 安全修复；不是新增审批或 Plan 能力 |
| 模型选择、流式运行反馈 | 旧 Agent + 独立受控端点 | 固定真实 Pi + 独立 profile/模型端点；原生停止按钮与四组合运行态 | Pi profile 测试预配置被明示，不冒充 UI→Pi 认证写入 |
| PTY 真命令、磁盘结果、终端 resize / 关闭 | 全部保留 | 全部保留 | 原生非 Agent 宿主能力未删除 |
| 文件树、预览、双标签拖动/切换/关闭、Side Pane resize | 全部保留 | 全部保留；补充 Pi Read 芯片→同工作区文件验证 | 标签与分栏不是一回事 |
| 原 Agent `Read(file_path)` → 文件结果 → 时间线 | 原调用及折叠/展开断言保留 | 请求必须提供真实 Pi `read` 而非 `Read`；模型发出 `read(path)`，Pi 读取实际文件并回传标记；原生工作历史折叠/展开保留 | 不使用 mock 工具结果 |
| `AskUserQuestion`、等待四组合、选项结果 | 原断言及全部四张等待图保留 | 明确记录 unavailable；不会发一个不存在的工具再伪造成功 | Pi 扩展 UI #13（P25/P26）未完成；不算本票通过能力 |
| HTTP 400、原生错误、反馈 GitHub URL、新请求恢复 | 原断言保留 | 全部保留，错误来自 Pi 实际模型请求 | 反馈不自动发送诊断 |
| 停止真实活动流 | 原断言保留 | 原生按钮→Pi 停止→HTTP 连接关闭→composer 恢复 | 其他取消类别由对应后续票完整验收 |
| 任务菜单 / 会话 split | 固定原版入口禁用的事实保留 | 同样禁用，未激活隐藏 pane/store | #5 未完成，未算为可用分栏 |
| 新任务、快捷命令面板、侧栏恢复 | 原断言保留 | 全部保留 | 补充两条已建立 Pi 会话来回切换不重发 |
| JSONL 重启恢复、滚动跟随/手动锚点/返回最新 | 独立固定原版滚动对照报告 | 新增 CI `pi-native-gui-smoke.mjs`：真实 Pi 文本/read/stop，重启同 JSONL，模型请求数不增加，三阶段滚动、文件芯片、双会话 | 不用旧原版历史作为 Pi 证据 |
| 原版/产品身份与清理 | 固定源码/旧 Agent 身份保留 | Pi 0.87.0 `rpc-entry`、完整包文件与构建摘要，真实进程清理，准确报告受控模型 | 不再把产品标为 NOT Pi |

## 两个产品测试入口

```powershell
node scripts/native-desktop-smoke.mjs --baseline product
node scripts/pi-native-gui-smoke.mjs --output test-results/pi-native-gui
```

原版入口继续为 `node scripts/native-desktop-smoke.mjs --baseline original --app-root <固定原版工程>`；不得把产品工程传作原版，来源断言必须通过。原版完整旧 Agent smoke 不被产品 CI 假冒运行；此前 #32 原版实际证据和本轮独立原版交互报告分别保留。产品 CI 同时执行以上两项，并上传两者的报告/截图。任何一项失败都使 job 失败，没有 `continue-on-error`、测试排除或失败过滤。

## 新发现的 Pi Windows 隔离边界

分流后的首次完整 GUI 操作全部成功，但守卫发现 Pi 启动会尝试清理共享安装旁的 `node_modules/.pi-native-quarantine`。没有放宽文件守卫，也没有忽略这项失败。使用固定 Pi 文档的 `PI_PACKAGE_DIR`，将完整 Pi 包复制到测试 sandbox：源码仍由实际生产入口执行，包资源/自更新清理目录属于隔离副本；native smoke 对安装包与副本所有文件逐字节哈希比对。放置私有 quarantine 哨兵，断言真实 Pi 清理哨兵，且共享目录越界写入仍为零。此设置只属于测试 fixture，不改变产品数据目录或用户 Pi 配置。

## 当前本地结果（不是最新 CI 通过）

- 服务测试 54/54（包括真实 Pi 命令合同）、fixture 根目录 32/32 / package cwd 31/31；provenance 回归 25/25。
- 分流后 native GUI `D:/Temp/pi34-closeout/split-product-smoke-5/`：18 组动作、48 张图通过；四组合 empty/running/error/file-preview，真实 Read / PTY / 停止 / 恢复 / 键盘等。没有给未支持 waiting 或 Pi 命令菜单记 PASS。
- 补充 Pi GUI `D:/Temp/pi34-closeout/pi-product-smoke-current/`：文本、实际 read、停止、重启无重发、两会话、滚动、标签/关闭/resize 通过；`filesystemBlocked=[]`、退出无幸存。
- 尚需最终增量审查、最新提交 Windows CI，以及独立视觉复核。图片读取当前返回 `Image reading is disabled`，不得据这些操作/截图文件宣称逐屏已审查。
