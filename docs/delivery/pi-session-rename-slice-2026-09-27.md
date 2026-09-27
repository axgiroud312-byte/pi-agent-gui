# #9 Pi 会话重命名切片（2026-09-27）

范围：P10/P11 中的会话重命名。沿用 ZCode 原生侧栏任务行、右键菜单与重命名 Dialog；Pi 0.87.0 的 `set_session_name` 和 JSONL `session_info` 是名称事实来源。没有复制上游 UI 源码；原生操作入口未改变。

## 复现与修复

- 红测：`node --import tsx --test packages/services/test/pi-history-rename-admission.test.ts`。旧实现先写侧栏任务索引，再把 Pi RPC 失败吞掉，测试因“预期拒绝但返回成功”失败；测试日志显示已写索引并广播标题事件。
- 修复：Pi 模式先等 `renameSession` 的真实 ACK，成功后才更新任务索引与 UI；拒绝时保留旧标题。重命名 Dialog 在失败时保留输入并显示失败提示，不再产生未处理 Promise rejection。旧 ZCode Agent 的尽力同步路径保持原语义。
- 固定 Pi 0.87.0 合同：CLI 写入带 `session_info` 的 JSONL，原生 Host 冷启动该 session 并重命名，关闭后由 `SessionManager.open/list` 回读同一 session ID、同一文件与新名称。测试 2/2 PASS（约 5 秒）。实际受控 Pi 进程，不含在线推理。
- `pnpm run typecheck` PASS；定向 oxlint 0 error（`node.ts` 与 `TaskList.tsx` 的既有未使用项警告）；`pnpm --dir packages/desktop run build:no-runtime-assets` PASS；`node --check scripts/pi-session-rename-gui-smoke.mjs` PASS。

## 仍需验证

- `scripts/pi-session-rename-gui-smoke.mjs` 已准备：CLI 历史在原生侧栏重命名→CLI 回读→完整关闭/重启后同名恢复、页面异常和进程清理。与其他桌面测试错开独占运行后补报告路径与结果。
- 目录排序、筛选、确认删除、fork/clone、历史编辑/重试、导入导出与用户主动分享仍是 #9 的开放验收项。本切片不代表 #9 或 V04/V05/V10 全部通过。
- `PiSessionLease` 仅协调本产品 Host；外部 Pi CLI 不使用该锁。后续删除流程不得凭本锁声称外部 CLI 不在写入。
