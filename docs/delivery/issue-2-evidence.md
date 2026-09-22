# #2 / #30 — 基础工作区与 RPC 证据

## 交付范围

完整 GUI → sandboxed preload → 宿主 → 独立 Pi JSONL 子进程。实际本地目录、工作区/启动配置持久化、固定版本探测、文本消息增量与最终校正、Pi 运行阶段、错误恢复及多进程隔离。

引擎固定 Pi 0.87.0；Electron 44.4.3、React 19.3.0、assistant-ui 0.15.21。没有另建模型循环。来源与许可证随变更登记在根 notices。

## 实际执行

机器：Windows `10.0.26200` x64，Node `24.14.0`，npm `11.9.0`。

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过，包含 52 能力/84 故事/20 场景覆盖检查 |
| `npm test` | 35 通过，0 失败；真实外部子进程与临时文件系统 |
| `npm run test:contract` | 2 通过，真实 Pi npm CLI，无模型凭据 |
| `npm run build` | 通过；renderer 主 chunk 567 kB，已如实保留 Vite 体积提示 |
| `npm run test:e2e` | 7 通过；真实 Electron/宿主，RPC 子进程边界替身 |
| `npm run package:win` | 通过，生成 Windows NSIS 开发安装包 |
| `npm run package:dir` | 通过，含随附 Pi 的 Windows 目录产物 |
| `npm run test:package` | 通过；实际打包 exe → 随附真实 Pi 0.87.0 → 原生 session/PID；缺失认证真实失败 |

首次 E2E 因 Electron 二进制下载未使用既有环境代理而失败。执行 `node --use-env-proxy node_modules/electron/install.js` 后安装成功，全部 E2E 重跑通过；没有跳过该检查。

## 协议与交互观察

- 提交未获回应时是 `submitting`；`prompt` 成功后是 `accepted`。`agent_end` 与成功重试均不标记整个运行完成，只有 `agent_settled` 收敛。
- UTF-8 跨块、CRLF/LF、U+2028/U+2029、尾部无换行、异常 JSON/UTF-8、stdout 大记录、stdin 背压、超时、重复/错误 ID 与 command、进程崩溃均有合同测试。
- 最终 `message_end` 替换临时流式文字；测试故意使最终回复不同于增量，GUI 和宿主一致。
- 两个独立进程中一个退出，另一个保持运行并完成；没有自动重启或重投递。
- 无效目录、缺失可执行文件、Pi 版本不匹配能编辑路径/配置后重试。输入被明确拒绝可纠正后提交，投递不确定时拒绝盲目重发。
- 打包应用启动实际 `app.asar` 中的 Pi 入口并返回原生 session ID；未借用开发 fixture 或外部全局 Pi。

## 截图与原始结果

本地与 CI artifact 保持同一目录结构：

- `test-results/e2e/workspace-text-acceptance--99a76--final-Unicode-message-wins-electron/01-accepted-not-settled.png`
- 同目录 `02-streaming.png`、`03-agent-end-not-settled.png`、`04-settled.png`。
- 各错误/重试/崩溃场景目录内有关键状态 PNG、RPC 双向记录和宿主日志。
- `test-results/contract/real-pi-rpc.json`。
- `test-results/package/real-pi-packaged-ready.png`、`real-pi-auth-recovery.png`、`result.json`。

已检查 1280×800 完成态及真实打包 Pi 就绪截图，关键输入、错误恢复、状态和配置入口可见。

## 尚未作为通过报告的首版项目

此切片不等同于 P01/P04/I01/I18 全量完成。图片/工具/完整上下文在 #3，队列/停止在 #4，多会话布局/恢复在 #5，完整安装升级回退在 #27，真实模型和全部外部环境在 #28。没有以当前离线测试宣称真实模型调用或完整 Windows 安装验收通过。
