# #9 Pi 会话目录搜索切片（2026-09-27）

范围：原生命令中心的任务搜索能找到固定 Pi 0.87.0 写入的 CLI JSONL 会话。侧栏、命令中心、排序与结果点击沿用 ZCode 原生路径；没有引入前端历史副本或旧 Agent 回退。

## 复现与实现

- 红测：`node --import tsx --test packages/desktop/src/host/windowHostControllerSearch.test.ts`。真实 `SessionManager` 在临时目录写出带名称和消息的 CLI JSONL；原生 Controller 的无搜索列表已有同一 ID，但输入 `Pi CLI session` 搜索返回空。原因是搜索只查旧 task-index，纯 Pi 会话没有该行。
- 修复：Controller 把现有 sessions-index 投影中的标题命中与原 task-index 全文结果合并，以 endpoint、工作区、会话 ID 去重，并按原排序/分页规则返回。旧任务的正文命中与摘要继续保留；Pi CLI JSONL 和索引身份保持原样。
- 定向宿主测试：新搜索测试与原 Pi-only Controller 投影测试 2/2 PASS。测试同时确认旧 task-index 摘要结果未被覆盖。

## 原生 GUI 证据

- `pnpm --dir packages/desktop run build:no-runtime-assets` PASS；隔离脚本 `node scripts/pi-session-search-gui-smoke.mjs --output D:\Temp\pi-session-search-gui2-20260927` PASS。报告：`D:\Temp\pi-session-search-gui2-20260927\pi-session-search-gui-report.json`，截图同目录 `pi-session-search-open.png`。
- GUI 命令中心搜索找到 Pi CLI 会话并打开原始回答 `CLI_ANSWER`；退出后同一 JSONL 的旧内容不变、ID 不变。`pageErrors=[]`，Electron/Host/Pi `graceful=true`、`forced=[]`、`survivors=[]`，再次枚举隔离进程无残留。使用受控本地模型，不代表在线 provider 或用户验收。
- 首轮 GUI 失败仅因脚本用“搜索”精确 accessible name 定位，而按钮实际还包含快捷键提示。报告 `D:\Temp\pi-session-search-gui-20260927\pi-session-search-gui-report.json` 记录此脚本错误，进程亦正常退出；调整定位并以第二轮通过结果为准。

## 边界

- Pi-only 会话目前只按 sessions-index 标题查找；旧 task-index 的正文全文搜索仍用于旧任务。跨 Pi 消息正文全文检索、目录确认删除、fork/clone、导入导出和主动分享尚未由此切片完成。
