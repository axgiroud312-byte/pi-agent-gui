# 统一 Pi 模型设置

[Issue #43](https://github.com/axgiroud312-byte/pi-agent-gui/issues/43)。Parent: #1；关联 #7、#10、#41。2026-09-29 用户授权：“先把 PR #42 合入 main，再开始统一模型设置。”

## 目标与范围

PR #42 已合入 main，merge `d4285e69e3b2566d71ff426042185cefb48c0558`。本任务开始时，桌面模型设置仍并列旧 ZCode provider 配置与 Pi 认证，前者不控制 Pi 推理。本次统一到 Pi 的 `models.json`、`auth.json`、`settings.json`，保持原生设置导航、提供商两栏及聊天模型菜单。

## 验收

- 桌面“模型设置”与聊天“管理模型”进入同一 Pi 页面，不再呈现旧 provider 写入入口。
- 提供商认证和模型目录同屏；内建、自定义与当前会话扩展提供商来自 Pi。扩展 provider 保留固定 Pi 的实际认证兼容边界。
- 自定义提供商的 ID、地址、API 协议和模型 ID 可新增、编辑、删除，写入当前 Pi profile 的 models.json；保留未编辑的扩展字段、模型参数与凭据，不复制密钥到 renderer。
- API key/OAuth 继续由 Pi 公共认证流程管理；保存模型配置后刷新 Pi 与聊天目录，准确区分已保存与会话同步失败。
- 高级 Pi 用户/项目设置保持原有冲突检测、来源和启动选项；模型选择不写回旧 provider_config.json。
- 外部改动冲突、坏 JSON、字段保留及配置保存后实际 Pi 请求有回归。原生 GUI 实测配置→认证→模型选择→回复，附截图及清洁退出证据。

## 来源

沿用 `zai-org/ZCode@872ad960de7ec172591f7e1952f7849229f94521` 原生设置、Button/Input 与两栏入口（Apache-2.0，现有 notices）；Pi `@earendil-works/pi-coding-agent@0.87.0` / `16787ad5b2dc748047f314ca1bfe7708f30f54f3` 的公开 ModelRuntime 与 models.json 文档（MIT）。不迁入旧原型界面。

## 状态

统一页面已实现，必要本地检查与精确源码包内 GUI 已通过，新版已打开到模型设置页，等待用户试用。#43 OPEN、PR #44 Draft，未自动合并或关闭。真实 OAuth 现场流程仍由 #7 跟踪，不以本任务的已有凭据或受控模型代替。

## 实施与验证记录

- 桌面只渲染 `PiModelSettingsSection`；保留原生 Settings 导航、返回、两栏、Button/Input/Select 和聊天模型菜单。提供商按已配置优先排序；高级用户/项目 JSON 设置折叠在同一页。
- 自定义连接使用当前 Pi agentDir 的 models.json，保存带 SHA-256 版本检测、目录锁、临时文件、固定 Pi 公共 ModelRuntime 离线验证和原子替换。模型 ID 确定后保持 provider 身份；编辑地址、API 与模型清单时按 ID 保留原模型参数，apiKey、headers、OAuth 及其它字段不投影到编辑器。
- 认证仍由 PiAuthManager 的同一 auth.json / ModelRuntime 操作；扩展提供商仍使用原有运行时目录与能力边界。配置已提交但会话忙时返回 `synchronized=false`，界面显示已保存/待刷新，空闲刷新仍复用原 Pi PID。
- 自审检查了配置字段保留、CAS、坏 JSON、Pi 校验失败、创建重名、会话同步失败、异步读取和卸载后的写回、认证/目录刷新事件；没有可用 `/code-review` 技能，不将自审记为独立审查。

本机证据根：`C:/Users/niilo/AppData/Local/Temp/opencode/`。

| 检查 | 结果 |
| --- | --- |
| `pi-model-config.test.ts` | 2/2：秘密不回传、参数保留、实际 Pi 目录读取、外部冲突、删除不动 auth、无效配置不覆盖 |
| `pi-model-config-service.test.ts` | 1/1：忙碌时保存成功/同步失败，停止后刷新同一 Pi 子进程；初次测试漏传 Stop execution ID，修正测试后通过 |
| `pi-auth-service.test.ts` | 4/4 PASS |
| `pnpm run typecheck` / `pnpm run lint` / architecture | PASS，lint 0 errors / 69 既有 warnings，architecture 0 violations |
| 旧 output 新 GUI 先红 | `pi-issue43-gui-red`：旧设置无统一入口，预期失败；清洁退出 |
| `pi-model-settings-gui-smoke.mjs` | `pi-issue43-gui-a`：新增提供商→Pi models.json→API key→可选目录→实际固定 Pi 回复、冲突/参数保留、管理模型回到同页、旧配置文件未改；0 页面错误/强杀/残留 |
| `pi-auth-extension-gui-smoke.mjs` | `pi-issue43-auth-gui`：认证保存/登出、坏目录修复、扩展提供商不重跑 factory、扩展交互 PASS，清洁退出 |
| `pi-settings-gui-smoke.mjs` | `pi-issue43-settings-gui-b`：高级设置保存、冲突、项目来源/信任、启动选项及真实 RPC PASS，清洁退出 |
| 全部 `packages/services/test/pi-*.test.ts`，`--test-concurrency=1` | `pi-issue43-suite.log`：271/271 PASS，0 fail/cancel/skip；已收到完整 shell 完成通知 |
| 精确源码 Windows unpacked 构建 | `pi-issue43-build-final.log`、`pi-issue43-package.log`：production / preview / win x64，PASS；包内 3.14.1 / `dabbed5e` / Pi 0.87.0 |
| 包内统一设置 GUI | `pi-issue43-packaged-final/pi-model-settings-gui-report.json`：7 个流程检查 PASS，1280×800 / 1920×1080 明暗 4 张截图已逐张目视，0 页面错误/强杀/残留 |

源码 GUI 使用受控本地模型，不代表真实在线 OAuth。一次并行源码 GUI 运行争用固定调试端口，settings runner 启动超时；其进程随后已不存在，改为串行重跑通过。产品编译 output 之外的用户窗口未停止。

## 交付

- 产品源码 `dabbed5e2ca23a5252e72abb28dc0660b1adc97a`，Draft PR [#44](https://github.com/axgiroud312-byte/pi-agent-gui/pull/44)。随后仅改截图脚本及交付文档，产品字节仍对应该提交。
- Windows x64 unpacked：`D:/Temp/pi-agent-gui-model-settings-dabbed5-20260929/`。双击 `Launch-Model-Settings.cmd` 启动；本次不含新 NSIS 安装器或正式 Release。
- 同目录 `artifact-manifest.json` 保存 exe、app.asar、启动器 SHA-256、构建元数据与报告路径。`user-launch.json` 记录实际打开的窗口；`user-model-settings.png` 为用户原 Pi profile 的模型页截图。
- 新桌面 profile：`C:/Users/niilo/.pi-agent-ide-model-settings-preview`；Pi profile：用户原 `C:/Users/niilo/.pi/agent`。页面已选 OpenAI Codex，已识别原有 OAuth 状态及 CLIProxyAPI 扩展提供商。仅打开页面和选择提供商，未发送用户 profile 的测试提示或编辑其模型/认证配置。
- 启动时主 PID 52436，CDP 57795；这是留给用户试用的窗口。测试窗口已全部正常退出。启动器沿用已验证的本机代理，仅在 HTTP(S)_PROXY 未显式指定时补上。
- 包内验证命令：设置 `NATIVE_PI_PACKAGED_EXE` 为该 exe，执行 `node scripts/pi-model-settings-gui-smoke.mjs --output C:/Users/niilo/AppData/Local/Temp/opencode/pi-issue43-packaged-final`。本次受控 provider 经真实固定 Pi 收到回复；未将受控推理或已有 OAuth 状态记为新在线授权验收。
