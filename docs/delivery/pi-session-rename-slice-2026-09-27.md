# #9 Pi 会话重命名切片（2026-09-27）

范围：P10/P11 中的会话重命名。沿用 ZCode 原生侧栏任务行、右键菜单与重命名 Dialog；Pi 0.87.0 的 `set_session_name` 和 JSONL `session_info` 是名称事实来源。没有复制上游 UI 源码；原生操作入口未改变。

## 复现与修复

- 红测：`node --import tsx --test packages/services/test/pi-history-rename-admission.test.ts`。旧实现先写侧栏任务索引，再把 Pi RPC 失败吞掉，测试因“预期拒绝但返回成功”失败；测试日志显示已写索引并广播标题事件。
- 第二个红测与原生 GUI 首轮运行暴露另一断点：纯 Pi CLI 历史没有旧 ZCode task-index 行。Pi RPC 已把新名称写进 JSONL，随后旧索引写入失败，界面仍报错。Pi 模式现在等真实 `renameSession` ACK，并从 Pi 会话摘要读回准确名称；直接广播原生任务标题事件，不创建旧 Agent 任务行。拒绝时保留旧标题。重命名 Dialog 在失败时保留输入并显示失败提示，不再产生未处理 Promise rejection。旧 ZCode Agent 的尽力同步路径保持原语义。
- 固定 Pi 0.87.0 合同：CLI 写入带 `session_info` 的 JSONL，原生 Host 冷启动该 session 并重命名，关闭后由 `SessionManager.open/list` 回读同一 session ID、同一文件与新名称。定向测试 3/3 PASS（约 5 秒）。实际受控 Pi 进程，不含在线推理。
- `pnpm run typecheck` PASS；定向 oxlint 0 error（`node.ts` 与 `TaskList.tsx` 的既有未使用项警告）；`pnpm --dir packages/desktop run build:no-runtime-assets` PASS；`node --check scripts/pi-session-rename-gui-smoke.mjs` PASS。

## 原生 GUI 证据

- 隔离源码构建 `scripts/pi-session-rename-gui-smoke.mjs --output D:\Temp\pi-session-rename-gui3-20260927` PASS。报告：`D:\Temp\pi-session-rename-gui3-20260927\pi-session-rename-gui-report.json`。原生侧栏重命名后，固定 Pi 0.87.0 的 CLI JSONL 回读名称为 `Renamed in native GUI`，完整关闭并重启后同一 session 标题仍在；`pageErrors=[]`。两轮 Electron/Host/Pi 进程清理均 `graceful=true`、`forced=[]`、`survivors=[]`；命令行再次枚举无本隔离构建残留。
- 前两次 GUI 红测均因旧 task-index 写入而失败，报告分别在 `D:\Temp\pi-session-rename-gui-20260927`、`D:\Temp\pi-session-rename-gui2-20260927`；它们也均正常退出且无残留。通过的第三次运行使用上述修复后的隔离构建。

## 仍需验证
- 目录排序、筛选、确认删除、fork/clone、历史编辑/重试、导入导出与用户主动分享仍是 #9 的开放验收项。本切片不代表 #9 或 V04/V05/V10 全部通过。
- `PiSessionLease` 仅协调本产品 Host；外部 Pi CLI 不使用该锁。后续删除流程不得凭本锁声称外部 CLI 不在写入。
