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
| `npm test` | 39 通过，0 失败；真实外部子进程与临时文件系统 |
| `npm run test:contract` | 2 通过，真实 Pi npm CLI，无模型凭据 |
| `npm run build` | 通过；renderer 主 chunk 567 kB，已如实保留 Vite 体积提示 |
| `npm run test:e2e` | 8 通过；真实 Electron/宿主，RPC 子进程边界替身 |
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

## 独立两轴审查与修复

基线 `3749c24329fb2d5aef7a15d3ab366903d10a516f`，覆盖 PR #31 的全部提交。首轮 Standards 发现单写者限制、IPC 原始错误绕过脱敏和发送资格的前后端分歧；Spec 发现固定版 compaction 事件名和无运行的扩展输入卡住。

修复集中在关联 #30：

- 宿主为新会话分配原生 UUID，禁止 profile 绕过其会话/模式控制；原生会话文件采用排他 lease，规范路径解析，关闭后释放。第二个宿主不能写入相同文件。
- `canSubmit` 和阻塞原因由宿主投影；关闭、启动失败和投递未知不再仅凭 `phase=error` 显示可发送。
- IPC rejection、诊断与错误字段统一脱敏；含引号的 JSON 凭据字段也覆盖，GUI 回归证明合成密钥不显示。
- 使用固定版 `compaction_start/end`，保留失败，成功 overflow 恢复消除旧错误。
- prompt 接受后查询真实 state；固定版在普通 prompt 的 preflight 回调后同步标记会话运行。被扩展处理且没有 Run 的输入返回 idle，不伪造 settled。真实打包 Pi 的 `/llama` 被加入回归。
- 第二轮复查进一步修复：先脱敏嵌套诊断字符串再序列化；重叠 lease release 等待同一清理 Promise；Pi 自行超时的扩展对话按真实无 Run 状态恢复 idle。对应宿主与 Electron 回归已通过。

最终本地 `npm run check` 实际整体通过（39 runtime/host、2 真 Pi 合同、8 Electron E2E）。`8e68a43` 的本地 NSIS 重建和实际打包 `/llama` smoke 已通过；后续修复由新 CI 重新打包验收。

首轮 GitHub Windows CI（修复前的 `bc5ee31`）实际通过：[run 35671083789](https://github.com/axgiroud312-byte/pi-agent-gui/actions/runs/35671083789)。修复仍需重新审查和 CI，通过后才合并。
