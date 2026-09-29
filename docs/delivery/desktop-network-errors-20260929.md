# 桌面 Pi 联网与对话内错误反馈

日期：2026-09-29。[Issue #41](https://github.com/axgiroud312-byte/pi-agent-gui/issues/41)。Parent: #1；回归关联 #3、#10、#34。

## 用户报告与范围

同一用户在 Pi TUI 可以调用模型，桌面发送后无回复。用户要求调查根因，并将连接/模型失败直接显示在对话中。

## 初步证据

- 用户桌面会话的 Pi JSONL 已记录输入，随后四条空内容 assistant 消息以 `stopReason=error`、`errorMessage=fetch failed` 结束。
- TUI 使用 Pi 0.87.1，桌面固定 Pi 0.87.0；版本差异本身尚不能认定为原因。
- `buildHostProcessEnv` 将 shell 的 HTTP(S) 代理和 CA 环境清洗，并保存在 `ZCODE_TOOL_ENV_PASSTHROUGH_JSON`；Pi 启动边界未恢复这些网络配置。终端环境有本地 HTTP(S) 代理。
- 旧在线 GUI 测试显式写入 Pi `settings.json.httpProxy`，未覆盖只有 shell 代理的真实启动方式。
- Pi 空内容失败消息没有独立时间线行；当前运行错误主要通过 composer 错误区展示。

## 实施与验收

- 在 Pi 子进程边界恢复宿主保存的网络环境，保持显式环境值与 Pi 自有配置规则，不全局取消 ZCode 的环境清理。
- 真实固定 Pi 的受控代理回归：没有代理不可达的模型，经桌面传递的代理可达；不依赖给测试 profile 额外写代理。
- 模型失败在对应对话轮次显示清晰错误，空内容错误与冷启动历史均可见；不重复占据输入区。
- 保留当前会话恢复、重试/停止和非模型错误反馈，验证失败后可继续发送。
- 定向合同、类型检查、相关完整 Pi 回归、真实 GUI 与可运行桌面产物验证；不把受控模型当成在线模型。

## 结果

### 根因与修复

- 已用先红后绿合同证明：宿主保留了 shell 代理的副本，但 Pi 未恢复它，因而桌面与终端网络环境不同。现在仅在 Pi 子进程边界恢复代理/CA；显式环境值优先，宿主自己的环境清理继续保留。
- Pi 的空内容错误原先只进入当前控制状态，不产生对话行。现在以 `assistantText.error` 保留独立错误事实，显示“模型连接失败”/“模型请求失败”和可展开详情；冷恢复仍从 Pi 消息生成，恢复成功按 Pi 权威历史对齐。
- 只隐藏当前轮次已有同一错误的输入区错误条，扩展错误、投递不确定等继续显示。
- CLIProxyAPI 补测发现另一入口缺口：新任务先读静态认证目录，忽略已预热 Pi 的扩展模型；初次读取早于预热完成时，后续工作区配置也没有触发重读。`422d166` 改为读取同一工作区仍存活的 Pi 子进程目录，并在工作区配置更新后刷新。不会为查模型重跑扩展 factory，也不把其它工作区的运行时模型带进来。
- 来源：沿用 `zai-org/ZCode@872ad960de7ec172591f7e1952f7849229f94521` 的 RowShell、Alert 和原生时间线（Apache-2.0，现有 NOTICE 保留）；没有引入新的第三方组件源码。将错误从 composer 移到对话，是本次用户明确要求的交互差异，不宣称与原版错误位置相同。

### 已执行验证

证据根：`C:/Users/niilo/AppData/Local/Temp/opencode/`。

| 检查 | 结果 |
| --- | --- |
| 新增代理继承、空内容错误先红测试 | 旧实现 2 项失败；修复后通过 |
| `node --import tsx --test` 定向消息、网络、真实重试与 UI guard | 通过 |
| 全部 `packages/services/test/pi-*.test.ts`，`--test-concurrency=1` | `pi-issue41-suite.log`：268/268，通过，无 skip/cancel；完整 TAP 已落盘，原父 shell 完成通知丢失，不宣称取得其 exit code |
| `pnpm run typecheck` / `pnpm run lint` | 通过；lint 只有既有警告 |
| `pnpm --filter @zcode/desktop build:no-runtime-assets` | 通过；随后 renderer 重建纳入 `Connection error` 分类 |
| `node scripts/pi-network-error-gui-smoke.mjs --output …/pi-issue41-gui-b` | 环境代理传递、失败对话行、详情、无重复输入区错误、冷重启及恢复后真实 Pi 请求通过；页面错误/强杀/残留均为零 |
| `PI_GUI_TEST_MODEL=gpt-5.5 node scripts/pi-online-provider-gui-smoke.mjs --output …/pi-issue41-online-codex-55` | 桌面 → 固定 Pi → 真实 openai-codex 回复通过；仅 shell 代理，未在 Pi profile 注入 httpProxy；凭据副本已删除 |
| `pnpm run architecture:check -- --changed` | 0 violations |
| 临时 `pi-issue41-cliproxy-probe.mjs`，只复制用户 CLIProxyAPI 扩展和配置 | 固定 Pi 0.87.0 RPC 实际 `cliproxyapi/gpt-6-luna` 返回精确标记，凭据副本删除；这是 RPC 验证，不冒充包内 GUI |
| 旧 `20260928` Windows 包运行同一 network-error GUI smoke | 预期红测：输入区显示 `Connection error.`，时间线没有错误行；截图 `pi-issue41-old-package-red/failure.png`，正常退出且无残留 |
| `f4045a06` Windows unpacked：`pi-issue41-packaged-network-final` | 包内代理继承、错误详情、冷重启、恢复续发 PASS；0 页面错误、0 强杀、0 残留 |
| `f4045a06` Windows unpacked：`pi-issue41-packaged-codex-final` | 真实 `openai-codex/gpt-5.5` 回复 PASS；凭据副本已删除，清洁退出 |
| 扩展目录新增真实 Pi 回归，`pi-auth-service.test.ts` | 先红后绿；新任务能读同工作区已运行扩展模型、跨工作区不泄漏、factory/PID 不变，完整该文件 4/4 PASS |
| `pi-issue41-source-cliproxy-selected` | 最终源码从新任务直接选 `CLIProxyAPI / GPT 6.0 Luna`，真实回复与 Pi JSONL 的 provider/model 均 PASS；清洁退出，凭据副本删除 |
| 目录增量后 `pnpm run typecheck` / `pnpm run lint` / `pnpm run architecture:check -- --changed` | PASS；0 lint error / 69 既有 warning，0 architecture violations |
| `422d166` 全部 `packages/services/test/pi-*.test.ts`，`--test-concurrency=1` | `pi-issue41-suite-final.log`：268/268 PASS，0 fail/cancel/skip，完整 shell 完成通知已收到 |
| `422d1666` 最终包 `pi-issue41-final-422d166-network` | 断网错误行/详情、无重复输入区错误、冷重启、代理恢复后续发 PASS；2 次 CONNECT / 1 次恢复模型请求 |
| `422d1666` 最终包 `pi-issue41-final-422d166-codex` | 真实 `openai-codex/gpt-5.5` 回复 PASS，只继承 shell 代理，凭据副本删除 |
| `422d1666` 最终包 `pi-issue41-final-422d166-cliproxy` | 新任务正常选 `cliproxyapi/GPT 6.0 Luna`，真实回复及 Pi JSONL 的 `cliproxyapi/gpt-6-luna` 身份 PASS，凭据副本删除 |

最终三组包内 GUI 均 `pageErrors=[]`，所有退出阶段 `graceful=true`、`forced=[]`、`survivors=[]`。已查看实际截图，确认错误在对话中、旧输入区重复错误条消失。

### 最终交付

- 目录：`D:/Temp/pi-agent-gui-network-fix-422d166-20260929/`，启动入口 `Launch-Network-Fix.cmd`。
- 包内元数据：3.14.1 / `422d1666` / Pi 0.87.0；完整源码 `422d166691c8f1701e7c745eaa6789409ace5d6f`。本次提供 unpacked 预览，没有新建 NSIS 安装器或正式 Release。
- `win-unpacked/Pi Agent IDE Preview.exe` SHA-256：`e3939183b41ac8dba1c5db188004c4d0e9c0d05e08a3748912de82993a12d753`。
- `win-unpacked/resources/app.asar` SHA-256：`35bbcb6c363d4b3d5b88b6e2f0b5306fd7aa350911e6d0c5d0487e35ceb907dc`。
- 同目录 `artifact-manifest.json` 保存元数据、哈希及三组报告路径；`user-launch.json` 记录实际打开结果。源码之后的提交仅更新文档，不冒充包内编译提交。
- 已打开实际新版窗口（主进程 PID 31372），通过其独立 CDP 窗口确认已选 `cliproxyapi/GPT 6.0 Luna`；未在用户真实 profile 发送测试请求。截图 `pi-issue41-user-preview-ready.png`。
- 启动入口使用独立桌面 profile `%USERPROFILE%/.pi-agent-ide-network-fix-preview`，读取原 Pi profile `%USERPROFILE%/.pi/agent`；未提供代理环境时沿用本机已验证的 `http://127.0.0.1:7897`，已有显式代理值优先。这是本机预览启动设置，不宣称实现系统代理/PAC 自动发现。

### 用户验收：通过

2026-09-29，用户在新版打开并交付后明确回复：**“ok，这个任务算是完成了”**。验收对象为上述 `422d1666` Windows 预览包；本任务按完成关闭 Issue #41。PR #42 移出 Draft、保留待合并，本次不改变包内源码或已有验证结果。

### 诊断边界

- 用户 TUI 默认 `cliproxyapi/gpt-6-luna`，本机配置指向 `http://127.0.0.1:8317`；失败桌面会话选择的是 `openai-codex/gpt-6-luna`，不能视为同一个渠道。
- 两次隔离 `openai-codex/gpt-6-luna` 在线检查停在模型菜单中无该项，未发送请求；第二次工具执行中断，清理记录有 1 个强制退出。它们不计为通过。已有 GPT-5.5 在线成功不能代替 Luna 或 CLIProxyAPI 验收。
- 原始失败进程环境没有现场抓取，因此已证实的是可复现的代理传递缺陷与修复后的连接成功，不能仅凭 `fetch failed` 排除所有其他网络因素。
- 最终包技术验证、实际打开和本任务用户验收已完成；此前未验证的独立 provider/安装器边界仍按本报告记录。
- CLIProxyAPI 探索中出现过静态菜单无目录、把模型 ID 当可见名称（实际为 `GPT 6.0 Luna`）、误导航到可销毁预热会话和未选模型就提交等失败。这些结果不算通过；最终源码采用正常新任务选择模型再发送，真实成功路径以上一表为准。

源码修复提交 `f4045a0`、扩展模型入口 `422d166`，分支 `issue-41-pi-network-errors`，PR [#42](https://github.com/axgiroud312-byte/pi-agent-gui/pull/42)。本轮已自行审查网络白名单/显式值优先、Pi 消息事实/稳定行 ID、冷恢复、重试校正及非模型错误保留；增量核对同工作区/活跃 PID 与文件身份、无重复扩展执行、React 请求序号与作用域保护。当前无可调用的 `/code-review` 技能，不把自审称为独立审查。

### 工具执行中断与恢复

排查证实 OpenChamber 自带后台与另一独立 OpenCode 2.0.18 服务都处理过同一会话，并记录 `No tool output found for function call`；尚不能据此断言双后台是唯一根因，也没有证据支持先前“服务重启”的说法。另有错误浏览器客户端选择、中文输出解析及重复 patch 的执行问题。

用户明确授权后，通过独立 CLI 的 `service stop` 停止 PID 26568，核对只剩 OpenChamber 自带 PID 14448；没有修改配置或数据库。此前暂停时中断的包 `D:/Temp/pi-agent-gui-network-fix-20260929/` 不交付；随后在全新 `D:/Temp/pi-agent-gui-network-fix-final-20260929/` 完成 `f4045a06` 阶段打包和包内验证。

补齐扩展目录后的最终候选另在 `D:/Temp/pi-agent-gui-network-fix-422d166-20260929/` 从精确源码重建。旧 `f4045a06` 包保留为阶段验证证据。
