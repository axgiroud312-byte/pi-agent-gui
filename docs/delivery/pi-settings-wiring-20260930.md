# 前端配置必须真实接入 Pi

2026-09-30 用户要求：**“我希望所有在前端配置的，你都能实际接入 pi 实际的配置接口。”**

Parent: #1；本轮在 #43 / 当前分支继续实施，关联 #10、#12。不将此指令当成旧试用包的人工验收，也不自动合并、关闭或正式发布。

## 接入合同

- 前端的 Pi 配置必须读取当前 Pi profile / 项目实际文件，通过既有 Host → Pi 公开 API、版本化扩展桥或 Pi 原生配置文件写入，并验证 Pi 读取或实际运行；不能只保存到旧 ZCode 配置。
- 模型 / 认证保持 `models.json` / `auth.json` 与公共 `ModelRuntime`；运行设置保持用户 / 项目 `settings.json` 的作用域、信任、未知字段和外部冲突保护。
- 设置中的 Skills、命令、扩展包和上下文进入同一真实 Pi 资源管理链路，不再调用旧插件、Skill、命令或 Memory 配置服务。
- 主题、字号、快捷键、通知、桌面窗口、文件预览等纯桌面选项继续由实际桌面实现处理，明确不属于 Pi 引擎设置。
- Pi 0.87.0 没有原生配置接口的旧 MCP、子 Agent、Hook、主动建议或自动审批等不能伪造映射；说明通过 Pi 扩展实现的边界，不新增已退出范围的业务系统。
- 明确保存与生效时机：配置文件供新会话读取；资源保存走 Pi 重载；模型 / 认证保存与当前会话同步分别反馈。不能把保存成功冒充当前会话已采用。

## 本轮发现

- 统一模型页已有真实 Pi 接入，不推倒重做。
- 通用网络设置仍写桌面 `setting.json`，Pi 装配没有采用旧 Agent 的 `resolveSpawnEnv`；需改为真实 Pi 网络配置入口。
- 设置页的 Skills / 命令 / 插件 / Memory 仍渲染旧服务页面；聊天中的 Pi 资源管理已有可复用的真实实现。
- 收尾审查还发现侧栏插件市场、自动化主视图、旧引导和草稿插件推荐可绕过设置页。自动化的实际 GUI 红测仍显示“创建定时任务”，已作为遗漏修正，不把退出首版范围的调度系统接入或伪造为 Pi 能力。

## 已实现的入口与事实源

| 前端入口 | 实际实现 / 生效时机 |
| --- | --- |
| 常规 → Pi 设置；模型页 → 高级 Pi 设置 | 同一个 `PiSettingsSection`，读取用户 `settings.json` / 项目 `.pi/settings.json`；常用原生控件与 JSON 共用同一草稿，保存走现有锁、修订检测、Pi 校验和原子替换。新 Pi 会话读取；不会自动重启当前会话。 |
| 模型、认证、聊天模型菜单 | 保留 #43 已实现的 `models.json`、`auth.json` / Pi 公共 `ModelRuntime` 与同一 Pi 会话目录刷新；不再提供旧 provider 写入入口。 |
| HTTP / HTTPS 代理 | 写入 Pi 用户 `settings.json` 的真实 `httpProxy`，由固定 Pi 启动逻辑使用；不再写桌面旧代理地址作为 Pi 配置。 |
| No Proxy / 自定义 CA | 桌面启动偏好，经 `createLocalServices` → `PiSessionSupervisor`，每次启动传入真正的 `NO_PROXY` / `no_proxy` / `NODE_EXTRA_CA_CERTS`；不是伪造的 Pi JSON 字段。留空遵循宿主环境；已有子进程不变。 |
| 技能、命令、插件、记忆；侧栏插件市场 | 嵌入聊天同一个 Pi 资源管理器，通过版本化公开桥读取、编辑、过滤、启停、安装及重载。记忆页管理 Pi 上下文文件，而非旧 Memory 开关。 |
| 资源管理的会话选择 | `readPiAuth().runtimeCatalogSessionId` 选当前工作区已有 Pi 子进程；显式显示所选会话，不为查看资源另启 Agent。重载只影响所选会话，其他已运行会话要分别重载。 |
| MCP、子 Agent、Hook、迁移、侧栏自动化 | 显示不支持旧 Agent 配置的说明，不渲染旧可写控件。对应业务可由兼容 Pi 扩展提供，未新增通用管理或调度系统。 |
| 浏览器控制、引导、草稿推荐 | 不加载旧 browser-use 插件开关、旧插件迁移弹窗及插件推荐。职业/界面模式引导仅保存桌面偏好，不保存旧 Memory / 主动建议配置。 |
| 外观、快捷键、通知、窗口、消息显示、内置终端 | 保留实际桌面实现并明确与 Pi 引擎配置区分。内置终端选择不控制 Pi bash 工具；后者使用真实 `shellPath` / `shellCommandPrefix`。 |

常用表单覆盖默认提供商/模型/thinking、传输/超时、自动压缩、Agent 与 provider 重试、双队列方式、缓存预热、图片、Shell、历史目录、Skill 命令、项目信任及遥测/分析。只编辑已知叶子；未知字段与嵌套字段保留。`httpProxy`、`cacheWarming`、`defaultProjectTrust` 按固定 Pi 标为仅用户设置，项目作用域禁用；异常原始值要求在 JSON 修复，不以默认值覆盖。原始 JSON 仍可管理其余 Pi 设置；CLI TUI 专属项不冒称影响 GUI。

网络优先级遵循固定 Pi：`applyHttpProxySettings` 只在 `HTTP_PROXY` / `HTTPS_PROXY` 未定义时采用用户 `httpProxy`。已有显式环境代理优先；本轮试用启动器不再硬编码本机代理地址，避免覆盖前端保存值。验证用隔离环境确认了没有继承代理时真实请求经过 GUI 保存的代理。

## 来源

沿用固定 `zai-org/ZCode@872ad960de7ec172591f7e1952f7849229f94521` 原生设置 / 组件（Apache-2.0）；Pi `@earendil-works/pi-coding-agent@0.87.0` 的公开 SettingsManager、ModelRuntime、资源 / 扩展 API（MIT）。本轮复用本工程已验证的 Pi 设置和资源实现；不复制旧原型 UI，不改用户真实 profile。

## 验证与交付

本机证据根：`C:/Users/niilo/AppData/Local/Temp/opencode/`。以下均为已收到完成结果的检查；测试使用隔离桌面 / Pi profile，不写用户真实配置。

| 检查 | 命令 / 证据与结果 |
| --- | --- |
| 固定 Pi 服务全集 | `node --import tsx --test --test-concurrency=1 <packages/services/test/pi-*.test.ts 的完整列表>`；`pi-settings-wiring-suite-20260930.log`：**272/272 PASS**、0 fail/cancel/skip，exit 0。最后两项界面入口修正未改服务代码。 |
| 最终 UI 全集 | 设置 `TSX_TSCONFIG_PATH` 为 `packages/ui/tsconfig.json`，`node --import tsx --test --test-concurrency=1 <packages/ui/test/*.test.ts* 的完整列表>`；`pi-settings-wiring-ui-final-20260930.log`：**111/111 PASS**、0 fail/cancel/skip。包括每个常用表单字段被固定 Pi 公共 SettingsManager 读取的合同。 |
| 类型 / lint / 架构 / diff | `pnpm run typecheck` PASS；`pnpm run lint` 0 errors / 69 既有 warnings，`pi-settings-wiring-lint-final-20260930.log`；`pnpm run architecture:check -- --changed` 0 violations；`git diff --check` PASS。 |
| 最终配置接线 GUI | `node scripts/pi-settings-wiring-gui-smoke.mjs --output <.../pi-settings-wiring-audit-final-20260930>`；报告 `pi-settings-wiring-gui-report.json`：真实文件保存、未知嵌套值保留、真实 Pi 子进程环境、无继承代理时使用 GUI 保存的代理实际推理、资源保存重载和编辑后模板实际进入 Pi 请求、侧栏 Pi 包入口、旧自动化配置拒绝、草稿旧推荐停用、4 个尺寸/主题状态、项目仅用户字段保护 PASS。 |
| 最终源码桌面构建 | `pnpm --filter @zcode/desktop build:no-runtime-assets` PASS；`pi-settings-wiring-build-source-20260930.log`，已有大 chunk / plugin timing 警告，不改变依赖或构建设置。 |
| 模型回归 | `node scripts/pi-model-settings-gui-smoke.mjs --output <.../pi-settings-wiring-model-regression-20260930>`：新增提供商、真实 Pi 认证/目录/回复、外部冲突、字段保留、管理模型同页 PASS。 |
| 高级设置回归 | `node scripts/pi-settings-gui-smoke.mjs --output <.../pi-settings-wiring-settings-regression-20260930>`：保存、无效 Pi 值拒绝、外部冲突、信任与嵌套来源、global-only 项目覆盖、启动选项与固定 Pi RPC PASS。 |
| 认证 / 扩展回归 | `node scripts/pi-auth-extension-gui-smoke.mjs --output <.../pi-settings-wiring-auth-regression-20260930>`：保存/登出、秘密不回传、坏目录恢复、扩展提供商不重跑 factory、实际扩展交互 PASS；不是在线 OAuth。 |
| 资源回归 | `node scripts/pi-resources-gui-smoke.mjs --output <.../pi-settings-wiring-resources-regression-20260930-b>`：模板编辑/启停、本地包安装/过滤/移除、离线/固定版本更新解释和两会话隔离 PASS。 |
| 精确源码 unpacked 构建 | 冻结产品提交 `8dadc89e4cb0baed71a857920352bd6a5e09b904`；`ZCODE_ENV=production`、`ZCODE_PREVIEW_IDENTITY=1`、`ZCODE_DESKTOP_DIST_DIR=D:/Temp/pi-agent-gui-settings-wiring-8dadc89e-20260930`；在 `packages/desktop` 执行 `pnpm build:no-runtime-assets`、`pnpm exec electron-builder --win --x64 --dir --config electron-builder.config.js` PASS。`pi-settings-wiring-build-package-20260930.log` / `pi-settings-wiring-package-20260930.log`；afterPack 补齐并验证固定版本运行依赖、native 资源和 source map 清理。 |
| 包内设置接线 | 设置 `NATIVE_PI_PACKAGED_EXE` 为新 exe，串行执行 `node scripts/pi-settings-wiring-gui-smoke.mjs --output <.../pi-settings-wiring-packaged-20260930>` PASS。全部接线场景、实际代理推理、资源重载、模板请求、侧栏旧自动化拒绝、尺寸/主题及项目字段保护通过；两次清洁退出。 |
| 包内统一模型 | 同一 exe，`node scripts/pi-model-settings-gui-smoke.mjs --output <.../pi-settings-wiring-model-packaged-20260930>` PASS：7 个流程检查及 4 个尺寸/主题状态；清洁退出。 |
| 包内元数据与试用启动 | 用 `@electron/asar.extractFile` 只读验证包内 `out/metadata/build-meta.json` / `package.json` / 固定 Pi 清单：3.14.1 / `8dadc89e` / Pi 0.87.0。测试后、实际试用启动后 exe / asar / 启动器哈希不变。真实启动器已打开常规 Pi 表单，原 `settings.json` / `models.json` / `auth.json` 启动前后 SHA-256 一致，未发推理消息。 |

上列成功 GUI 均 0 page errors、正常退出、0 强杀/残留。首次资源回归沿用早期旧 provider 按钮，失败于准备步骤；脚本改用已经配置的真正 Pi profile 后通过。UI 全集首次在根目录未指定 UI tsconfig，8 个文件的 `@/` 别名解析失败；正确配置后全部通过。一次截图脚本同时找到聊天/设置两个资源区域，限定设置页后通过。这些失败与修正保留原报告，不以失败运行充当通过证据。

### 收尾审查与交付状态

- 自审覆盖：所有可达设置分区与侧栏入口、旧引导/推荐、真实文件与环境输入、global-only 和信任规则、未知值保留、异步读取作用域与编辑保护、资源所选会话/代次、保存与生效提示。
- 没有可用 `/code-review` 技能，本轮记录为自审，不冒称独立审查。侧栏自动化红测见 `pi-settings-wiring-sidebar-red-20260930`；补充修正后的 `pi-settings-wiring-audit-final-20260930` 已全绿，0 页面错误 / 强杀 / 残留。
- 已交付新 unpacked 预览，详见下方；2026-09-29 的 `dabbed5e` 旧模型设置包不包含本轮变更。#43 OPEN / PR #44 Draft 保持，未 merge、关闭 Issue 或创建 Release。
- 受控本地 provider、代理与已有/合成凭据不代替现场 OAuth 登录/登出；真实 GitHub Gist、真实 llama.cpp + GGUF、物理 IME 与用户体验确认仍是独立边界。

## 本轮交付

- 产品提交 **`8dadc89e4cb0baed71a857920352bd6a5e09b904`** 已推送；此后的收尾提交只更新文档，不改变包内产品。包内构建时间 `2026-09-30T15:57:58.682Z`，桌面 3.14.1、Pi 0.87.0。
- 新版目录：`D:/Temp/pi-agent-gui-settings-wiring-8dadc89e-20260930/`。双击 **`Launch-Pi-Settings.cmd`**；同目录 `README-试用.md` 提供三个入口和生效说明。无新安装器、安装替换或 Release。
- `artifact-manifest.json` 保存产品提交、包内元数据、exe / asar / 启动器 SHA-256、通过的报告路径、检查结果和实际试用窗口。`artifact-static-check.json` 是只读静态检查；读取归档不使用会覆盖工作目录文件的 `asar extract-file` CLI。
- 包内设置 / 展开表单 / 资源 12 个状态与模型 4 个状态已在四张 `packaged-*-review-matrix.png` 中目视复查；原始截图仍在两份 packaged 证据目录。窄窗口经原生滚动访问，导航、两栏、表单、长路径截断正常。源码对应的 12 个完整尺寸截图也已复查。截图和自动化不能代替用户体验确认。
- 新窗口已打开 **常规 → Pi 设置 → 常用 Pi 配置**，启动时主 PID `69604` / CDP `54872`，留给用户试用；旧窗口未结束。独立桌面目录 `C:/Users/niilo/.pi-agent-ide-settings-wiring-preview`，Pi 仍使用原 `C:/Users/niilo/.pi/agent`。只跳过桌面引导并打开页面；三份原 Pi 配置哈希不变，未发测试消息或写配置。正常预热可创建该新工作区自己的空 Pi 历史，不宣称整个 profile 没有任何运行写入。
- 试用窗口与配置不变的记录：`user-launch.json`、`original-pi-config-before-launch.json`；截图 `user-pi-settings.png`。启动器不硬编码 HTTP(S) 代理，保持 Pi 原生环境优先级。
