# #14 原生文件编辑增量证据（未完成整票）

基线：`issue-34-native-pi-rpc@c483200`；实现分支：`issue-14-native-file-flow`。本增量继续使用固定 ZCode 原生 `PreviewPane` 与 Side Pane 标签，来源 `zai-org/ZCode@872ad960de7ec172591f7e1952f7849229f94521`（Apache-2.0，现有仓库 NOTICE 保留）。新增的编辑代码是本项目实现，未迁入旧 `issue-14-file-editor@ea845ae` 的自建前端。

## 已实现的局部结果

- 从现有文件树或 Pi `read` 工具文件链接打开 Side Pane 文本预览后，顶部铅笔按钮进入同一标签内的文本编辑。图片、PDF、Office、二进制、超过 256 KiB 的文本及远程文件不提供此入口；现有预览和外部编辑器入口保持。
- Host 以工作区根目录和真实路径检查编辑目标，读取有界 UTF-8 快照。保存必须携带由文件身份、修改时间和 SHA-256 内容组成的版本；磁盘变化时明确报 `FILE_CHANGED`，保留用户草稿，不覆盖外部内容。保存使用同目录临时文件和替换；并发 GUI 保存按路径串行。该机制覆盖常见外部改动，仍不等同于跨进程原子 compare-and-swap。
- 未保存文本写入应用 profile 的浏览器本地存储，按工作区与文件路径隔离。关闭编辑、切标签或重启后重新打开时可恢复；磁盘版本变化时必须显式比较并选择放弃草稿或保留草稿继续编辑。持久化失败显示警告，当前草稿仍可复制或直接保存。草稿在本机 profile 中为明文，隐私清理与完整恢复仍需 #27 统一验收。

## 测试与可观察证据

先新增 `packages/services/test/file-optimistic-save.test.ts`：红灯为 `readEditableText is not a function`（2 例）；新增 `packages/ui/test/editableFileDraft.test.ts`：红灯为模块不存在（2 例）。实现后：

| 检查 | 结果 |
| --- | --- |
| `node node_modules/tsx/dist/cli.mjs --test packages/services/test/file-optimistic-save.test.ts packages/ui/test/editableFileDraft.test.ts` | 4/4 PASS；中文空格文件、同字节数外部改写、二进制/大文件/越界路径、草稿作用域和损坏记录 |
| `pnpm run typecheck` | PASS |
| 定向 `pnpm exec oxlint` | 0 errors / 0 warnings |
| `pnpm --filter @zcode/desktop run build:no-runtime-assets` | PASS |
| `node scripts/pi-native-gui-smoke.mjs --output D:\Temp\pi-agent-file-editor-gui3-20260927` | PASS；原生 GUI → Host → 固定 Pi 0.87.0 的受控 `read`、文本编辑冲突与保存、草稿跨第三次 Electron 启动恢复；pageErrors=[]，三次进程清理 forced=[] / survivors=[] |

GUI 受控模型是隔离 loopback fixture，**不是在线 provider**。隔离 worktree 安装使用 `pnpm install --offline --ignore-scripts`，Electron 二进制只读指向主工作树安装，旧 CLI storage bundle 从 `c483200` 主工作树复制到隔离 worktree；本次桌面 Host 和 Renderer 则是此分支构建。原始报告：`D:\Temp\pi-agent-file-editor-gui3-20260927\pi-native-gui-report.json`。截图：[外部改动冲突](save-conflict.png)、[显式保存后](saved.png)、[重启恢复草稿](draft-after-restart.png)。

## 尚未满足的 #14 条件

- 文件引用目前是文件路径 mention；尚未证明发送时冻结文件内容，若 Pi 晚些时候读取，文件可能已经变化。需解决引用快照/发送语义，不能把路径标签误报为内容快照。
- 本次 GUI 覆盖 Pi 工具回链与文本编辑；文件树直接引用到 Pi 输入、中文/空格/缺失/大文件的完整 GUI 矩阵、图片 MIME、未知格式打开路径和包内运行仍需逐项验证。
- 固定原版与产品在编辑状态的同状态成对截图尚无；铅笔按钮是 #14 必要的新入口，记录在 `native-ui-parity.md`，待最终视觉复核。
- #14 保持 OPEN；在线 provider、实际 Windows 安装和用户验收均未由此增量覆盖。
