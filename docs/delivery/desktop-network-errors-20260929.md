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
- 来源：沿用 `zai-org/ZCode@872ad960de7ec172591f7e1952f7849229f94521` 的 RowShell、Alert 和原生时间线（Apache-2.0，现有 NOTICE 保留）；没有引入新的第三方组件源码。将错误从 composer 移到对话，是本次用户明确要求的交互差异，不宣称与原版错误位置相同。

### 已执行验证

证据根：`C:/Users/niilo/AppData/Local/Temp/opencode/`。

| 检查 | 结果 |
| --- | --- |
| 新增代理继承、空内容错误先红测试 | 旧实现 2 项失败；修复后通过 |
| `node --import tsx --test` 定向消息、网络、真实重试与 UI guard | 通过 |
| 全部 `packages/services/test/pi-*.test.ts`，`--test-concurrency=1` | `pi-issue41-suite.log`：268/268，通过，无 skip；运行期间 harness 重启，但完整 TAP 已落盘 |
| `pnpm run typecheck` / `pnpm run lint` | 通过；lint 只有既有警告 |
| `pnpm --filter @zcode/desktop build:no-runtime-assets` | 通过；随后 renderer 重建纳入 `Connection error` 分类 |
| `node scripts/pi-network-error-gui-smoke.mjs --output …/pi-issue41-gui-b` | 环境代理传递、失败对话行、详情、无重复输入区错误、冷重启及恢复后真实 Pi 请求通过；页面错误/强杀/残留均为零 |
| `PI_GUI_TEST_MODEL=gpt-5.5 node scripts/pi-online-provider-gui-smoke.mjs --output …/pi-issue41-online-codex-55` | 桌面 → 固定 Pi → 真实 openai-codex 回复通过；仅 shell 代理，未在 Pi profile 注入 httpProxy；凭据副本已删除 |

### 诊断边界

- 用户 TUI 默认 `cliproxyapi/gpt-6-luna`，本机配置指向 `http://127.0.0.1:8317`；失败桌面会话选择的是 `openai-codex/gpt-6-luna`，不能视为同一个渠道。
- 两次隔离 `gpt-6-luna` 在线检查停在模型菜单中无该项，未发送请求；第二次受 harness 重启影响，清理记录有 1 个强制退出。它们不计为通过。已有 GPT-5.5 在线成功不能代替 Luna 或 CLIProxyAPI 验收。
- 原始失败进程环境没有现场抓取，因此已证实的是可复现的代理传递缺陷与修复后的连接成功，不能仅凭 `fetch failed` 排除所有其他网络因素。
- 包内验证与用户打开新版的结果待补充。
