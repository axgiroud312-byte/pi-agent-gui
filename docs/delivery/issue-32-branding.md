# #32 原生产品品牌与厂商入口处理

## 规格与边界

- 本批基于 `317d286`，在 `issue-32-branding` 专用工作树续接已有改动。
- 原生来源：[zai-org/ZCode](https://github.com/zai-org/ZCode/tree/872ad960de7ec172591f7e1952f7849229f94521)，固定提交 `872ad960de7ec172591f7e1952f7849229f94521`，第一方 Apache-2.0。根 LICENSE、NOTICE.md、THIRD-PARTY-NOTICES.md 中归属保留。
- 只变更品牌与产品服务准入。原生布局、Lexical、会话状态、工具时间线、通用 provider/API key/MCP、本地文件/Git/PTY 与调度保留。
- 策略所有者为 `packages/shared/src/product.ts`。这些能力是**厂商产品服务**，不是按 Z.AI/BigModel 名称过滤模型；模型推理与用户配置的 base URL 不使用 `productServiceFetch`。
- 账户、支付、云分享、更新等执行入口在 UI 与服务边界共同关闭；直接服务调用明确失败，不能仅隐藏按钮。公开配置返回无厂商配置，禁止后台取数。反馈/帮助可链接到本项目；不得自动提交会话、截图、日志或凭据。
- 市场规则：不登记/自动刷新厂商 CDN，显式刷新该源或下载该源插件失败；用户自己的 Git/URL/本地市场及随包本地资源保留。批量刷新跳过厂商源，不能顺带禁用用户市场。适配层按市场身份及产品 CDN 地址裁决，不改 Agent loop。
- 验收必须检查首次启动无厂商配置/更新/账户请求、菜单无购买/票据/云发布入口、模型设置仍可新建与编辑 API key/provider、本地资源与 IDE 操作路径保持原生。

## 用户关卡

2026-09-22 已读取 GitHub #1/#32/#33 最新正文及评论。#33 OPEN、ready-for-human，评论为空，**尚无实际界面用户确认**。本批不是 Pi #34，不证明 Pi 已接通。原引擎只用于隔离的阶段 0 交互对照。

原版/产品运行、成对截图及综合检查由 `pi-native-32` 集成工作树负责；本分支只提交品牌与厂商排除项，不关闭 #32/#33，不推送或创建 PR。

## 逐入口映射

以下路径均相对仓库根目录。允许理由对应 `docs/product-goal.md` 的“已允许的产品差异”。“服务禁用”表示实际调用失败/不启动网络，不是只改文案。

| ID | 原生入口及来源 | 产品行为 | 允许理由 |
| --- | --- | --- | --- |
| B01 | `packages/desktop/scripts/desktop-product-identity.mjs`、`package.json`、`electron-builder.config.js` | 产品名 Pi Agent IDE；production/preview/dev 独立 AUMID；打包 metadata 指向本项目，内部 workspace 包名不改 | 品牌/产品标识替换（1） |
| B02 | `desktopRuntimeEnv.ts`、renderer `index.html` | 主窗口标题、应用名与 Electron userData 身份使用 Pi Agent IDE；显式测试隔离参数继续有效 | 品牌（1） |
| B03 | 桌面 `build/icon*` / `build/icons/*`、UI `pi-mark.svg` | 新绘制 π 标记；Windows 窗口/托盘/安装图标及跨平台资源同步；脚本可重复生成 | 品牌；新资源非上游商标（1） |
| B04 | UI `App`、`DesktopTopOverlay`、`WindowsTopLeftLogo`、collapsed rail、welcome/onboarding/startup、`ZCodeAboutLogo` | 只替换标记/alt 文案，保留原组件、动画、容器与交互 | 品牌（1） |
| B05 | 桌面 `about.ts` / `aboutWindow.ts` | 原生 About 窗口显示 Pi Agent IDE、π、实际构建版本及“Based on ZCode · Apache-2.0”；关闭/键盘/HTML 转义保留 | 品牌 + 法律归属（1） |
| B06 | `IntlProvider.tsx`、桌面 menu/tray | 静态产品文案在变量插值之前换名；用户文件路径、输入和 provider 名称不会被重写。`ZCode Agent` 保留为阶段 0 引擎事实 | 品牌与真实状态（1、6） |
| B07 | 桌面 deep-link parser/registration、Explorer 右键、Finder workflow、Linux desktop entry | `pi-agent-ide://workspace/open`；Explorer/Finder/Linux 注册项使用 Pi 自有名字，不抢原版协议和注册键 | 产品标识（1） |
| V01 | WelcomeScreen、footer 登录/登出、`rootStartupGate`、`useRootOAuthEffects` | 不展示/恢复厂商产品账户；启动不被账户登录拦住。原生 API-key 表单、模型设置、主题/语言/缩放菜单保留 | 产品账户排除（2） |
| V02 | `services/oauth/oauthService.ts` | 产品 OAuth provider 列表为空；会话恢复为 signed-out；start/callback/adapter 路径拒绝。不是 Pi provider OAuth 的实现或移除 | 产品账户排除（2）；Pi 认证仍属 #7 后续范围 |
| V03 | `useModelProviderNavigation`、`ModelProviderSection`、`ProviderTemplatePicker` | 去掉 Start/Coding Plan/Team 的账号导航。无个人 provider 时用原生模板选择器，避免永久 loading；无返回目标时不显示返回按钮。个人 Z.AI/BigModel API key、自定义 provider/template/model 编辑仍在 | 厂商商业入口排除，通用配置保留（2） |
| V04 | `accountProviderConnectionResolver.ts` | 仅 `access.type === zhipu-account` 显式 unavailable 并清除旧内存 entitlement 回退；不查询账号凭据/套餐。不按名字过滤 provider | 厂商账户语义边界（2） |
| V05 | footer usage/plan badge、`useUsageEntitlement`、`useCodingPlanEntryPlanList`、`useEnterpriseCodingPlanProducts` | 不展示商业用量/升级徽标，不触发套餐/团队价格/专属配额查询；本地统计服务保留 | 配额/团队/订阅排除（2） |
| V06 | `CodingPlanEntryButton`、`CodingPlanUpgradeDialogProvider`、payment deep link | 共用购买/充值/订阅按钮不渲染；open action 返回 false，不挂支付 webview；支付回调不路由 | 商业入口排除（2） |
| V07 | `offPeakTaskStore`、`AutomationsSection`、`App` notifications | 闲时任务资格/票据/创建/模板页签/通知入口关闭；普通 Automations/cron 保留 | 闲时票据排除（2） |
| V08 | `OffPeakTaskService`、`offPeakServerClient`、`services/node.ts`、scheduler | 不启动闲时后台同步、不认领派发、不提供 Agent 闲时工具；创建拒绝；取票/状态/结算 transport 禁止请求。普通定时任务派发不改 | 闲时商业服务排除（2） |
| V09 | `ConversationShareMenu`、本地与远端 service collection、share deep link | 厂商云发布按钮隐藏，服务注册为原生 unsupported 实现，发布/预检/导入直接失败，不收集并上传文件；回调不导入 | 厂商云服务不能充当本产品服务（3）；P16 的通用导入/导出/gist 分享继续待实现 |
| V10 | `FeedbackHost`、桌面 command handler、`config/default.json` | 原生“报告问题/需求/工单”入口打开本项目 GitHub Issues。厂商 FeedbackCenter 不挂载；不发送预填草稿、截图、日志或凭据。日志导出原路径保留 | 反馈服务换绑（3） |
| V11 | `productDocs`、desktop community/changelog | 文档→本仓库 README，社区→本仓库，更新说明→项目提交历史；不请求厂商帮助配置 | 帮助/推广/云服务换绑（1、3） |
| V12 | 主菜单、托盘、UI update menu、GeneralSectionContent | 检查更新、预览更新、自动下载设置隐藏 | 厂商更新服务排除（3）；本项目更新仍属 #27 |
| V13 | `autoUpdater.ts`、`forceUpdateGuard.ts` | production/preview/dev 都不初始化/轮询更新器，不恢复厂商待安装 release notes、不查强更配置；直接更新入口受同一策略限制 | 禁止替本产品安装上游包（3） |
| V14 | `desktopContextPromptRollout`、`desktopHelpConfig`、client-config/scenes、subscription 配置读取 | 不执行厂商启动灰度、推荐场景、排序、体验套餐、强更请求；本地 workflow 显式模式可继续使用 | 厂商配置/推广服务排除（1、3） |
| V15 | `providerConfigRuntime.ts` | 使用随包模型模板及个人配置，停用上游 model-config CDN 后台刷新；个人文件轮询/配置保存/连通性路径保留 | 厂商目录服务排除（3）；通用 provider 保留 |
| V16 | `shared/env.ts`、`runtimeEnv.ts` | 关闭数仓/ARMS；不捕获或向 Agent 传播上游 OTEL telemetry 配置。本地日志/诊断保留 | 厂商遥测服务排除（3） |
| V17 | `shared/plugin-marketplaces.ts`、`PluginStorePage`、sources/card/listing、host plugin management、CLI marketplace adapter | 不默认登记或自动刷新官方 CDN；不提供官方远程安装/更新按钮；显式官方更新/下载拒绝，批量刷新跳过官方；CDN 重定向也拦截。随包本地插件恢复/启停、第三方市场/本地安装仍可用 | 官方分发服务排除，通用资源保留（4） |
| V18 | `officialMcpCredentials.ts` | 不向厂商 MCP 解析/签发产品账户身份头，返回明确 auth unavailable；普通 stdio/HTTP MCP 配置与凭据入口保留 | 官方 MCP 账户排除（4） |
| V19 | `trustedImageUrl`、`ConversationDraftSuggestedPrompts` | 厂商 CDN 图标不请求，回退本地原生 icon；其他 HTTPS 和随包资源不按厂商模型名字过滤 | 厂商 CDN 服务排除（3、4） |
| V20 | 桌面 `remoteCdn.ts` | 移除默认上游远端运行时 CDN；保留显式资源地址和开发离线资源路径、WSL/SSH 连接入口；资源不足由原生错误路径报告 | 厂商分发服务排除（3）；远端产品资源后续需本项目打包/托管 |
| V21 | `NodeApiClient` → `productServiceFetch` | 上游产品 API transport 统一在 fetch 前拒绝，即使设置改为另一个 endpoint 也不会放行；此 transport 服务账户/支付/反馈/云分享，不是模型或用户 MCP fetch | 补足跨入口执行闸门（2、3、4） |

法律归属文件、内部 `@zcode/*` 包名、协议类型、原生存储格式/环境变量及尚在对照的 Agent 名称保留。没有将原生工作台替换成自建界面；新增 UI 仅是品牌资源和原生组件的可见性条件。

## 本批实际执行的验证

环境：Windows，Node `v24.14.0`。本分支没有执行 install 或大型 build，也没有修改 lockfile / Vite / tsup 版本。

1. `node --test packages/shared/src/product.test.mjs`：最终 **7/7 通过**。覆盖实际 helper 的出网前拒绝（含改 endpoint 与 Request/URL 输入）、直接能力拒绝、模型 URL 不被当作产品 CDN、插值前换名、production/preview/dev 身份、原生 About 转义与关闭、Pi workspace deep-link 编码路径。首次测试将空环境误当 production 导致 1 项失败，已纠正为沿用原生“空环境=preview”，复跑通过。
2. `node packages/desktop/scripts/generate-product-icons.mjs`：成功生成 16 个 PNG/ICO/ICNS 资源；读取并查看了 `build/icon_windows.png`。这是资源生成/静态图像查看，不是 Electron 界面验收。
3. 对本批 JS/TS/TSX/MJS 路径运行 `../pi-native-32/node_modules/.bin/oxlint.cmd`：**0 errors，11 warnings**。warnings 是基线已存在的未使用声明（desktop builder 2、remote service collection 2、services/node 4、footer 2、AutomationsSection 1）；本批引入的未使用 `User` import 已删除。最终扫描 71 个文件。
4. `git diff --check`：通过。
5. 对当时 63 个修改/新增源码运行 `oxfmt --check`：62 个被报格式问题；对未修改的 `packages/ui/src/Root.tsx` 和 `packages/services/src/collection.ts` 复核，两者也被报格式问题。**未宣称格式检查通过**，未对导入工程进行整批格式化。后续新增改动由集成检查复核。
6. 已人工审阅本批 diff，按源头核对启动/支付/菜单/远端分享/目录与 transport 闸门；不是独立 agent review，也不是运行时网络抓包。

未在此分支执行：全工程或 CLI typecheck、完整测试、桌面/Agent/安装包构建、Electron UI 操作、网络抓包、成对截图、Windows 安装/深链接注册实测。用户指定这些集成检查归 `pi-native-32`，避免并发大构建造成内存压力。宏观 #32 尚须相应证据，#33 必须等待用户。

## 集成注意事项与操作对照

1. 在集成分支 cherry-pick 本提交，合并 `packages/desktop/electron-builder.config.js` 时保留主代理的构建修复，仅接入本批 metadata/scheme。`packages/services/src/node.ts`、shared env 和桌面 host wiring 同理。
2. **重新构建 shared、desktop/host/renderer/scheduler 与 Agent 资源**：`apps/zcode-cli/packages/adapters/src/plugins/marketplace.ts` 和共享策略改变，之前构建的 `zcode.cjs` 不包含这些禁用。远端资源也须来自同一产品提交，不能混用旧 bundle。
3. 原版对照使用未带本策略的固定上游源码；产品使用本批代码。分别隔离 HOME/原生 data root、Electron userData/sessionData 和 workspace。改应用名不等于改原生 `.zcode` 数据格式；不得直接借用原版真实账户目录。
4. 按 `native-ui-parity.md` 记录：原生 welcome→工作区；展开/收起侧栏；profile 菜单主题/语言/缩放；模型设置→模板→个人 API key/base URL；设置通用 MCP/资源；Automations 普通定时任务；本地文件/Git/终端；帮助/反馈→本项目；About/标题/托盘。
5. 明暗主题、1280×800/1920×1080 对照中确认购买/产品登录/票据/云发布/厂商更新入口消失；首次启动、设置/资源页及闲置阶段捕获网络，确认没有账户恢复、client/configs、官方目录/图标、自动更新、票据请求。普通模型连通性应只去用户所选 provider。
6. WSL/SSH 的离线资源/显式资源服务仍需集成实测；无资源服务时不以原版厂商 CDN 兜底。Pi provider OAuth、通用分享、资源分发与产品更新仍是后续能力票，不计为本批已实现。
7. #33 的确认记录必须包含用户原话、日期、具体产品提交和截图/操作材料链接。当前无确认，禁止据本批测试继续 #34。

## 首批 aff8379 精确文件清单

共 94 个文件：16 个生成的桌面图标，其余为小范围原生接线、策略、品牌资源、测试与本文档。可用 `git show --name-only <本批提交>` 复核。

```text
apps/zcode-cli/packages/adapters/src/plugins/marketplace.ts
config/default.json
docs/delivery/issue-32-branding.md
packages/desktop/build/icon.icns
packages/desktop/build/icon.ico
packages/desktop/build/icon.png
packages/desktop/build/icon_installer.icns
packages/desktop/build/icon_installer.ico
packages/desktop/build/icon_installer.png
packages/desktop/build/icon_windows.png
packages/desktop/build/icons/1024x1024.png
packages/desktop/build/icons/128x128.png
packages/desktop/build/icons/16x16.png
packages/desktop/build/icons/24x24.png
packages/desktop/build/icons/256x256.png
packages/desktop/build/icons/32x32.png
packages/desktop/build/icons/48x48.png
packages/desktop/build/icons/512x512.png
packages/desktop/build/icons/64x64.png
packages/desktop/electron-builder.config.js
packages/desktop/package.json
packages/desktop/scripts/desktop-product-identity.mjs
packages/desktop/scripts/generate-product-icons.mjs
packages/desktop/src/host/remoteWorkspaceServiceCollection.ts
packages/desktop/src/main/about.ts
packages/desktop/src/main/aboutWindow.ts
packages/desktop/src/main/autoUpdater.ts
packages/desktop/src/main/desktopApplicationMenu.ts
packages/desktop/src/main/desktopCommandHandlers.ts
packages/desktop/src/main/desktopContextPromptRollout.ts
packages/desktop/src/main/desktopDeepLinkUrl.ts
packages/desktop/src/main/desktopFinderOpenFolderWorkflow.ts
packages/desktop/src/main/desktopHelpConfig.ts
packages/desktop/src/main/desktopLinuxDeepLinkRegistration.ts
packages/desktop/src/main/desktopOAuthDeepLink.ts
packages/desktop/src/main/desktopRuntimeEnv.ts
packages/desktop/src/main/desktopTray.ts
packages/desktop/src/main/desktopWindowsOpenFolderContextMenu.ts
packages/desktop/src/main/forceUpdateGuard.ts
packages/desktop/src/main/remoteCdn.ts
packages/desktop/src/renderer/index.html
packages/desktop/src/scheduler/index.ts
packages/services/src/client-config/clientConfigService.ts
packages/services/src/client-scenes/clientScenesService.ts
packages/services/src/coding-plan-subscription/bigmodelCodingPlanSubscriptionProvider.ts
packages/services/src/model-provider/accountProviderConnectionResolver.ts
packages/services/src/model-provider/providerConfigRuntime.ts
packages/services/src/node.ts
packages/services/src/oauth/oauthService.ts
packages/services/src/official-mcp/officialMcpCredentials.ts
packages/services/src/plugins/pluginManagementService.ts
packages/services/src/providers/api/nodeApiClient.ts
packages/services/src/session/offPeakServerClient.ts
packages/services/src/session/offPeakTaskService.ts
packages/shared/src/env.ts
packages/shared/src/index.ts
packages/shared/src/plugin-marketplaces.ts
packages/shared/src/product.test.mjs
packages/shared/src/product.ts
packages/shared/src/runtimeEnv.ts
packages/ui/src/App.tsx
packages/ui/src/ConversationShareMenu.tsx
packages/ui/src/DesktopTopOverlay.tsx
packages/ui/src/WelcomeScreen.tsx
packages/ui/src/WindowsTopLeftLogo.tsx
packages/ui/src/WorkspaceSidebar/WorkspaceSidebarCollapsedRail.tsx
packages/ui/src/WorkspaceSidebarFooter.tsx
packages/ui/src/assets/pi-mark.svg
packages/ui/src/components/ui/ZCodeAboutLogo.tsx
packages/ui/src/feedback/FeedbackHost.tsx
packages/ui/src/hooks/useCodingPlanEntryPlanList.ts
packages/ui/src/hooks/useUsageEntitlement.ts
packages/ui/src/i18n/IntlProvider.tsx
packages/ui/src/lib/desktopUpdateMenu.ts
packages/ui/src/lib/productDocs.ts
packages/ui/src/lib/rootStartupGate.ts
packages/ui/src/lib/trustedImageUrl.ts
packages/ui/src/onboarding/OnboardingWelcomeView.tsx
packages/ui/src/root/RootStartupLoading.tsx
packages/ui/src/root/useRootOAuthEffects.ts
packages/ui/src/settings/AutomationsSection.tsx
packages/ui/src/settings/CodingPlanEntryButton.tsx
packages/ui/src/settings/CodingPlanUpgradeDialogProvider.tsx
packages/ui/src/settings/ModelProviderSection.tsx
packages/ui/src/settings/PluginStoreCard.tsx
packages/ui/src/settings/PluginStorePage.tsx
packages/ui/src/settings/PluginStoreSourcesDialog.tsx
packages/ui/src/settings/model-provider-section/ProviderTemplatePicker.tsx
packages/ui/src/settings/model-provider-section/useEnterpriseCodingPlanProducts.ts
packages/ui/src/settings/model-provider-section/useModelProviderNavigation.ts
packages/ui/src/settings/pluginStoreListing.ts
packages/ui/src/settingsPageHelpers.tsx
packages/ui/src/store/offPeakTaskStore.ts
packages/ui/src/v4/ConversationDraftSuggestedPrompts.tsx
```

## 集成 smoke 反馈修正：空模型文案与独立 SVG

### 实际失败证据

读取了集成工作树 `test-results/native-parity/product/failure.png` 和 `report.json`：

- 运行提交 `95a8b833ce55a1fec302c70c23924939e38a4b4a`；原生工作台已出现，窗口标题为 Pi Agent IDE。
- 1280×800、dark、中文：空模型横幅仍含“请订阅编程套餐或配置自定义模型”，中央仍是 Z 轮廓水印。
- 报告 `nativeSmokePassed=false`、`fullIssue32Passed=false`；错误为 `A vendor product entry remains visible`。此前通过的操作仅有退出引导和语言选择；不能记为 #32 完成。

### 本次补丁（基于 aff8379）

| 来源 | 修正 | 保留内容 |
| --- | --- | --- |
| `packages/ui/src/i18n/locales/zh-CN.ts`、`en-US.ts` 的 `chat.error.noAvailableModel` | 改为“当前没有可用模型。请配置模型供应商、API 密钥和模型。” / “No model available. Configure a provider, API key, and model.” | 同一原生错误 key、横幅、配置/关闭控件与位置 |
| `packages/ui/src/v4/ConversationDraftEmptyState.tsx` | 明亮主题内联路径改为 π 轮廓；私有组件命名改为 PiEmptyStateLogo | 400×320 viewBox、外层 5:4 容器、宽度/定位、opacity-70、70% 渐隐、问候语与字号逻辑 |
| `packages/ui/src/assets/Z.svg` → `pi-watermark-dark.svg` | 深色水印两条 path 同步改为 π，组件引用新资源名 | 436×360 viewBox、原占位范围、opacity=0.15、1.2 模糊、全部渐变/透明度参数 |
| `packages/desktop/src/renderer/index.html` | 审计发现 React 挂载前的启动 SVG 仍为 Z，改为 π | 118×100 尺寸、256×218 viewBox、96px 壳、56px mark 宽度与原动画；只换 path，不改 stylesheet |

这次没有修改 Agent 名称、法律文件、通用 provider 图标或已禁用产品 OAuth 的归属图标。审计的桌面品牌面包含标题栏、折叠侧栏、welcome/onboarding、React startup、About、草稿 hero 及 React 前 HTML splash。剩余旧 Z 路径命中在独立 Web 入口 `packages/web/index.html`，不是本次 Windows 桌面启动入口。

### “配置”按钮路径核对

源码路径为 `ChatErrorBanner.onOpenModelSettings` → `ConversationComposer` → `SessionPane.handleOpenModelSettings` → `setPendingSettingsSectionIntent("modelProvider")` + `openSettingsTab()` → `SettingsPage` 的 `ModelProviderSection`。

- 该 intent 不带商业 provider ID；设置导航会清掉旧的 provider-specific intent。
- `vendorAccount=false` 时 `useModelProviderNavigation` 排除账户 preset/Coding Plan 导航；个人 `standard-personal` providers 保留。
- 没有个人 provider 时，`ModelProviderSection` 显示原生 `ProviderTemplatePicker`；可以创建供应商、设置 API key/base URL/model。已有个人 provider 时可进入原生编辑卡片。
- 因此无需修改路由或新增按钮。以上是源码链路核对，真实点击仍由集成 smoke 验证。

### 本次实际验证与集成待办

- Node 24 原生导入两份 locale 模块并断言空模型文案：中英两项均通过，无套餐/订阅/升级提示，包含 provider/API 配置引导，“配置”原 key 仍存在。未新增/移动测试文件，不碰主分支已迁到 `packages/shared/test` 的测试。
- 定向 `oxlint` 检查两份 locale 和 `ConversationDraftEmptyState.tsx`：3 files、0 warnings、0 errors。
- `git diff --check` 通过；检索桌面/UI 旧 hero/splash 路径及 `assets/Z.svg` 引用已无命中。
- 未安装依赖、构建或并行运行桌面。主代理需重新构建 renderer 并复跑产品 smoke；在明暗主题检查 π 水印及“配置”按钮真实落点。#33 仍等待用户对实际界面的明确确认。

## PR #37 独立审查修正合同

本轮基于 `dd97d00`；PR #37 未合并，#33 未确认。产品策略仍由 shared/product 持有，不更改通用模型能力或主分支的 provider 缓存/测试迁移。

1. **插件源解析与下载**：describe、validate 与 install 共用的源解析边界必须在远程操作前拒绝被排除的官方市场来源；随包 filesystem/SEA、显式本地目录和已安装本地缓存可读。ZIP HTTP 边界逐次检查初始地址和每个重定向，不能通过第三方市场条目转跳厂商 CDN。只拦截产品市场身份/产品 CDN，不按模型供应商名字拦截普通第三方。
2. **批量刷新**：bootstrap 的 refresh-all 选择 known records 时先排除官方市场；继续刷新自定义市场。显式刷新官方源仍返回清晰的不可用错误。被跳过官方源的历史失败不作为本次批量操作的新失败输出；不删除它的本地缓存。
3. **反馈提示**：GitHub 手动反馈路径不自动传递草稿/诊断，toast 必须说明需要用户按需复制粘贴；原生反馈启用时仍可显示原有附带上下文的提示。保留现有按钮、布局与本地复制能力。
4. **验证**：使用真实源解析/describe/validate/bootstrap API、临时本地插件及内存 HTTP transport 测试，断言厂商出网调用次数为零、重定向不触达厂商、第三方插件内容可读、混合官方/自定义批次完成自定义刷新。根 lint 和 CLI 包独立 lint 分别记录；完整构建与产品 smoke 由主分支串行执行。

### 修正实现

- `apps/zcode-cli/packages/adapters/src/plugins/product-marketplace-policy.ts`：集中检查远程 source 的官方市场身份与产品 CDN 地址。`marketplace.ts` 在 add/manifest 物化、单插件源解析及 dry-run validation 的 deferred 分支之前调用；本地 filesystem/SEA、目录、已安装缓存仍走原生读取。`zip-source.ts` 在初始 URL 校验和每次 redirect 的下一次传输之前执行相同检查。
- `apps/zcode-cli/packages/bootstrap/src/plugins.ts`：在外层 refresh-all 的 known ID 选择中跳过官方源；显式指定官方源在入口拒绝。只收集本次 target IDs 的失败诊断，跳过旧官方失败且保留缓存记录。
- `packages/ui/src/feedback/feedbackOpenedMessage.ts`：根据真实反馈能力选提示。ChatErrorBanner、SessionSubscriptionErrorPanel，以及审计发现的 TaskListItem/WorkspaceHeaderSections/grouped task row 共五处复用。新增中英 `feedback.external.manualCopyHint`，明确 GitHub 需手动填写、诊断未自动附带。FeedbackHost 的无查询参数 URL/清空草稿行为不改，也不自动复制到剪贴板。

### 可复现合同测试

```powershell
node apps/zcode-cli/test/run-product-policy.mjs
```

运行器仅把 `product-marketplace.test.mjs` 引用的本工作树源码编译成临时 Node 测试入口，结束后删除；不生成 desktop/Agent 产物。复用 CLI 已声明的 esbuild/yazl 依赖。完整安装的集成工作树可直接执行；本次专用工作树没有 node_modules，因此设置 Node 标准 `NODE_PATH` 指向 `pi-native-32` 的 `node_modules`、`apps/zcode-cli/node_modules` 和 `node_modules/.pnpm/node_modules`，借用外部依赖及生成的 TypeScript 标准库文本。所有应用逻辑仍解析到本工作树源码，没有使用主分支的 marketplace/bootstrap 实现；临时目录限制在预批准的 opencode 目录内。

唯一替身是 `NodeHttpClientAdapter.prototype.request` 的内存传输：不实际联网，其他 marketplace/bootstrap 调用、文件落盘、ZIP hash/解压和组件读取都是真实实现。

实际结果：修复前 7 项中 **5 失败、2 通过**，复现详情/校验出网、redirect 越过排除与混合批次中断；修复后扩展为 **10/10 通过**：

1. 官方 ZIP 的 describe 和单插件 validate：0 HTTP 调用。
2. 官方 ZIP 改成其他域名：仍拒绝且 0 HTTP 调用。
3. 官方 manifest 缺缓存且源域名改变：不发起补拉。
4. 第三方市场引用厂商 ZIP：describe/全市场 validate 均拒绝，0 HTTP 调用。
5. 普通 ZIP URL 重定向厂商 CDN：只请求初始普通 URL。
6. manifest validation 重定向厂商 CDN：只请求初始普通 URL。
7. filesystem、SEA、目录、已安装官方缓存：真实组件可读且 0 HTTP 调用。
8. 第三方 ZIP：真实 hash 校验/解压后可读 skill 描述。
9. official-first + custom 的外层 refresh-all：custom 完成更新/落盘，官方记录保持原样；显式官方 refresh 仍拒绝。
10. 错误与任务 toast 在中英文中均提示 GitHub 手动输入，没有复用“已附带上下文”的提示。

### 实际静态检查与尚未通过的 CLI 检查

- 根工具定向 lint 8 个修改/新增 UI 文件：**0 warnings / 0 errors**。
- 从 `apps/zcode-cli` 工作目录以 CLI 安装工具 lint 新策略和两个测试文件：**3 files，0 warnings / 0 errors**。
- 分别在 adapters、bootstrap 包目录执行其真实 `lint` 脚本内容 **`oxlint src`**，使用 `pi-native-32/apps/zcode-cli/node_modules/.bin/oxlint.cmd`（实际 1.67.0），自动读取仓库规则。**adapters：203 files，18 warnings / 25 errors；bootstrap：222 files，22 warnings / 20 errors**。errors 全为已有超长文件的 `max-lines`，包含本批触及但此前已远超 400 行的 marketplace.ts、zip-source.ts、bootstrap/plugins.ts；还有 config、fs、MCP、storage、v4 等未修改文件。没有关闭规则、加忽略或借根 lint 的 CLI 排除宣称通过。
- `git diff --check` 通过。未运行整仓 typecheck、Agent/desktop 构建或产品 E2E。主分支仍需执行完整 `pnpm --dir apps/zcode-cli lint` 并处理/登记以上基线检查阻塞，重新构建 Agent 与 renderer，再通过 guarded external-open smoke 验证反馈点击。
- 本轮未改 `packages/shared/src/product.test.mjs`、主分支的新 `shared/test` 路径或 provider readonly-cache 修复。#33 保持未确认。

## 默认桌面数据身份隔离合同

已观察到旧 early bootstrap 先读取真实 HOME 的 `.zcode/v2/setting.json`，且 whenReady 再以其 dataBaseDir 覆盖环境变量，导致正常 Pi 启动可能读取/修改原版设置与调度库。本修正属于产品身份（允许差异 1），不是 Pi #34。

- 无覆盖时，Pi 的设置锚点是 `<启动 HOME>/.pi-agent-ide`；沿用原生结构，设置位于该锚点的 `.zcode/v2/setting.json`。
- 显式 `ZCODE_DATA_BASE_DIR` 最高优先级：先归一化为绝对路径，bootstrap 不读取任何 setting.json 来决定数据根；该次启动设置也位于显式根。原生设置中的 dataBaseDir 不能在 whenReady 再覆盖它。
- 没有显式数据根时，现有 `ZCODE_DESKTOP_HOME_DIR` 可显式指定设置锚点；否则使用上述 Pi 默认锚点。只从此锚点读取持久化 dataBaseDir；缺失/空/损坏时使用锚点本身，相对持久化路径相对锚点解析。
- 主进程在任何 services/logger/crash 导入前，把桌面运行时的 HOME/USERPROFILE 设为选定业务根，把 ZCODE_DESKTOP_HOME_DIR 固定为设置锚点。这样上游仍通过 homedir 访问的 CLI 配置、历史、skills/MCP 等也进入 Pi 私有 profile；不会借用真实用户的原版 `.zcode`。独立 CLI/直接 services 入口不执行此 bootstrap，默认语义不改。
- 自动选出的数据根不伪装成主进程的显式 ZCODE_DATA_BASE_DIR；重启沿固定锚点重新读取设置，避免设置迁移后仍被旧的内部环境值锁住。host/scheduler 获得最终绝对 ZCODE_DATA_BASE_DIR 和相同设置锚点，原生 Agent 继承业务 HOME 与绝对 storage/log/db 路径。
- 本修正不搬移/导入原版数据，也不改 workspace 内 `.zcode`/`.agents` 文件名或绝对项目路径。默认 profile 内的工具 HOME/全局资源与原版隔离；已有工程继续通过原生目录选择器打开。设置中“恢复默认数据目录”必须回到 Pi 设置锚点，不能落回原版 HOME。
- 验证以临时 HOME 中旧设置/CLI 配置的 sentinel 为依据：旧配置不能重定向新默认；显式环境优先；Pi 持久化自定义目录恢复；重启、main/host/scheduler/Agent 路径一致；原版 fixture 字节不变，且测试不接触真实用户 HOME 数据。

### 隔离实现与目录布局

`packages/desktop/src/main/desktopProductProfile.ts` 是仅依赖 node:fs/os/path 的桌面边界；不放入 renderer 可引用的 shared/product，也不导入 services。`desktopDataBaseDirBootstrap.ts` 改为调用此边界；`main/index.ts` 将 early bootstrap 放在第一个 import，移除 whenReady 的第二次 dataBaseDir 覆盖。窗口恢复与 Chromium 早期设置读取统一使用同一个 Pi 设置文件。`desktopRuntimeEnv.buildHostProcessEnv` 最后写入已解析的绝对 profile 环境，覆盖 .env/shell 的冲突值。`settingService.updateDataBaseDir(undefined)` 仅在已提供桌面 HOME 时使用设置锚点，否则维持独立服务原有 homedir 默认。

```text
默认设置锚点 = <启动 HOME>/.pi-agent-ide
<设置锚点>/.zcode/v2/setting.json             # 包括自定义 dataBaseDir，始终固定

业务根 = 显式 ZCODE_DATA_BASE_DIR / Pi 持久化 dataBaseDir / 设置锚点
<业务根>/.zcode/v2/                           # 凭据、provider、tasks-index.sqlite 等
<业务根>/.zcode/cli/config.json               # 原生 Agent 配置
<业务根>/.zcode/cli/db/db.sqlite              # 原生 Agent 历史
<业务根>/.zcode/cli/log/                      # 原生 Agent 日志
<业务根>/.zcode/workspace/default/            # 原生非项目会话目录
```

`ZCODE_DATA_BASE_DIR`、`ZCODE_DESKTOP_HOME_DIR`、`ZCODE_HOME`、`ZCODE_STORAGE_DIR`、`ZCODE_LOG_DIR`、两种既有 session DB 环境键均保留原名；没有新增环境变量。只有桌面入口建立私有 runtime HOME/USERPROFILE；因此这个运行时的 `~` 和全局资源也属于 Pi profile，原版账户/配置不会自动继承。真实 workspace 的路径、布局、会话协议以及独立 CLI 的 API/defaults 没有替换。

### 隔离修正实际验证

Windows / Node 24.14.0，在预批准临时目录内执行：

1. `node --test packages/desktop/test/desktop-product-profile.test.mjs`：**5/5 通过**。默认旧目录 sentinel、显式根零 bootstrap 读取、Pi 自定义路径及 relaunch 再解析、坏/空/相对设置、绝对子进程环境。
2. `node apps/zcode-cli/test/run-product-policy.mjs packages/desktop/test/desktop-profile-native.test.mjs`：**4/4 通过**。独立 Node 子进程加载真正的 early bootstrap、services paths/setting service、CLI config factory；读取并写入 Pi 设置，验证任务库路径、CLI 用户配置、storage/session DB、主进程和继承环境。旧 profile 的 sync/async 文件读取与写入设检测钩子，访问计数为 0，旧 settings/CLI config 字节不变。另验证 Chromium 开关仅来自 Pi 锚点、恢复默认时真实复制回 Pi 锚点，以及无 bootstrap 的独立 services/CLI 保持原默认。
3. 运行器借用已安装 worktree 的外部依赖，方式同上一节；仅临时编译测试入口。增加可选测试入口参数与内部 `#src` 解析，不变更主分支构建脚本或 CLI 产品代码。默认命令 `node apps/zcode-cli/test/run-product-policy.mjs` 回归：**10/10 通过**。
4. 定向根 lint：8 files，**0 errors / 6 处 main/index.ts 原有 unused warnings**；CLI 目录单独检查修改的测试运行器：1 file、0 warnings / 0 errors；`git diff --check` 通过。

这些子进程验证的是原生路径/设置/配置合同，不是 Electron host/scheduler 循环或 Agent app-server 启动验收。本工作树未安装依赖、未执行完整 typecheck/桌面/Agent 构建，未触碰真实用户 HOME。主分支需重建 main/host/scheduler 后，以默认启动环境和既有隔离 harness 分别补做 Electron smoke；实际机器正常启动会创建新的 Pi profile，不导入原版状态。`appCrashCaptureBootstrap.ts`、provider readonly-cache、shared 测试迁移路径和 #33 状态均未修改。
