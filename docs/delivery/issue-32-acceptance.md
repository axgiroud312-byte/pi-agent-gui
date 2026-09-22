# #32 原生底座验收与 #33 用户检查材料

更新日期：2026-09-23。固定上游 ZCode `872ad960de7ec172591f7e1952f7849229f94521`；本轮完成的是原生底座、品牌/厂商入口处理及运行对照。**Pi 适配 #34 未开始，#33 尚待用户确认。**

最新本地产物与26对图集来自 `0de01e26b86f7bc2ed023623516a0907f848819d`，已包含独立启动器、保留执行 HOME 的数据隔离及全局工作流修复。该版本的独立 Standards / Spec 审查均 PASS、无剩余可操作发现，[Windows PR CI 35795351582](https://github.com/axgiroud312-byte/pi-agent-gui/actions/runs/35795351582) 全部通过（含生产默认入口和真实GUI/清理）。后续证据提交不改变此源码/产物；合并状态及最新HEAD检查以 [PR #37](https://github.com/axgiroud312-byte/pi-agent-gui/pull/37) 为准。

## 查看与启动

- [成对界面图集](issue-32-parity/index.html)：26 对实际截图；目录也可直接用浏览器打开。
- [结构化证据](issue-32-parity/evidence.json)：操作、源码/产物摘要、已知差异与进程清理。
- 构建后的隔离预览：在仓库执行 `node scripts/start-native-preview.mjs`。它以独立 HOME/数据目录启动真实 Electron 原生工作台，不读取既有 ZCode/模型凭据。
- 准备命令：Node 24.14.0、pnpm 10.33.2，`pnpm install --frozen-lockfile`；设置 `ZCODE_SKIP_REMOTE_ASSETS=1` 后 `pnpm prepare:desktop-runtime`；`pnpm --filter @zcode/desktop build:no-runtime-assets`。低内存环境应串行运行构建；类型检查实测需要高于 1.5 GiB 的 Node heap，本轮使用 4 GiB。
- 此预览未接 Pi，使用模型需要自行配置 API；自动验收使用受控本地模型端点，不冒充真实供应商结果。

## 真实交付

1. 原生 packages/UI/services/CLI 源码完整导入，保留 Electron 壳、Lexical、时间线、任务列表、设置、文件与终端服务；没有迁入旧自建聊天前端。
2. 窗口/主界面/关于/图标/启动与空态水印更换为 π / Pi Agent IDE。品牌调整保留原生尺寸、容器与操作路径。
3. 产品账户、充值/套餐权益、团队、闲时票据、官方云分享/更新/反馈/目录等厂商服务在 UI 和调用边界关闭；保留通用 BYOK provider、MCP 和本地服务。
4. 供应商模板中的 BigModel/Z.ai Coding Plan **API key 端点**仍是用户自备密钥配置，不是厂商产品账号/购买入口。实测可进入原生 API-key 表单；没有删除 Pi 将来需支持的通用认证能力。
5. 原生偏好菜单沿用原 footer trigger；移除其中登录/套餐动作，保留语言、主题、模式与缩放。旧 test ID 叫 login-trigger，不代表仍有登录动作。
6. 来源材料、缺失的 220 个上游输入、换行属性和 native CI 已恢复；个人 provider 缓存与只读随附目录分离，避免关闭远端同步后写入源码/安装目录。

完整入口清单：[品牌记录](issue-32-branding.md)。许可证/构建记录：[CI 与来源记录](issue-32-ci-provenance.md)。

## 本地实际执行结果

| 检查 | 结果 |
| --- | --- |
| 固定 pnpm 安装 | 1881 包成功；可选 cpu-features 编译探测失败未使安装失败，Windows PTY 使用预构建 |
| 原生运行资产 | 原 Agent bundle、插件运行资源、Windows ugrep/ripgrep 准备成功 |
| 原生生产构建 | 原版、品牌后产品均通过；Vite 8.0.8 / tsup 8.5.1 / Electron 41.0.3，无降级 |
| `pnpm typecheck` | 通过；修复测试跨 composite 边界引入的 TS5055 |
| CLI typecheck | `pnpm exec pnpm --dir apps/zcode-cli typecheck --concurrency=1`，27个任务通过 |
| CLI lint 导入基线 | 17包/14脚本全量核对通过；86个有界上游max-lines、53warnings，raw exit1如实保留。GitHub Actions真实格式回归及其余防绕过测试共17项通过 |
| `pnpm lint` | 通过，0 errors；70 条上游/既有 warnings 如实保留，历史原型归档不按新工程规则编译/lint |
| `pnpm architecture:check` | 通过，0 violations |
| 原生服务/UI测试 | 原有服务10项、UI6项通过；新增个人目录 provider-cache 回归1项通过 |
| 品牌服务边界测试 | 7通过 |
| 来源/字节修复回归 | 20通过 |
| 桌面profile策略/守卫 | 8通过；真实Git/SSH/终端、凭据和历史迁移合同另4项通过 |
| 全局工作流隔离 | 4通过：真实SaveWorkflow、GUI操作函数、读/改/删/移动及运行前解析；旧目录访问0次，哨兵字节不变，独立CLI及project scope保留 |
| 真实生产默认入口 | 完整原生生产构建的 `out/bootstrap.mjs` → 17个shared chunks，实际Electron/host启动通过；没有显式数据根覆盖，真实SDK getter为Pi目录，执行HOME保持不变 |
| 来源检查 | 6112次哈希检查、2868输入、220个恢复材料通过 |
| 许可标识/声明新鲜度 | 1734实装包检查通过；19项上游发行材料缺口仍保留，严格发行验收未通过 |
| 原版实际 Electron smoke | 19组动作、50张截图、9次受控模型请求，通过 |
| 产品实际 Electron smoke | 首轮18组/52图通过；修复反馈后19组/53图通过；原生输入/命令/引用/设置/文件/PTY/工具/问答/错误恢复/停止/导航真实执行 |
| 隔离与清理 | 产品7个受保护进程均在测试目录，16次系统注册调用在OS边界拦截，无越界文件操作，无遗留进程；产品运行未观察到厂商外网请求 |

原版与产品都记录了源码和产物摘要，运行前后不变。原版4975个包/CLI源码文件与固定上游比对一致。原版的外网请求在测试边界拒绝，未伪造账户/配额成功；产品品牌断言和真实动作均在默认产品配置执行。

## 实际修复而非绕过

- 冻结依赖、控制并发后原 Vite 8 工具链成功；旧报告中的“不支持 Vite 8/可用开发模式绕过”不作为已验证根因。
- 单测移到 test 目录，UI 测试在自己的 tsconfig/cwd 下运行；保留原检查和全部测试。
- 字节漂移工具只恢复当前 index 的原始字节，拒绝非换行本地修改；不改哈希来掩盖缺失材料。
- 原生 API-key 配置和偏好菜单属于保留能力，测试通过实际操作区分它们与已移除的商业账号入口。
- 一个早期独立探针只设置 ZCODE_DATA_BASE_DIR，原版仍读取了既有 HOME 设置并清理旧更新提示；已停止该探针。正式证据使用完整 HOME/应用路径隔离和文件/系统注册守卫，不使用那次运行的截图或日志。

## PR #37 独立审查与后续复核

- 厂商插件详情/ZIP重定向和混合市场refresh-all绕过已修复，保留本地及第三方源；新增10项真实源码/文件/ZIP/内存HTTP回归通过。
- GitHub反馈提示改为准确的手动复制说明，实际GUI点击反馈已断言打开无诊断查询参数的项目Issue页面。
- 原生CLI单独typecheck实际27个任务通过。根安装采用hoisted结构，需以 `pnpm exec pnpm --dir apps/zcode-cli typecheck` 保留根工具路径；没有切换工具版本。
- 原CLI全量lint原始退出码为1，包含固定上游就存在的86个max-lines和53warnings，未宣称clean。使用[明确基线政策](native-cli-lint-policy.md)核对17包/14个脚本、逐文件规则/行数和6个接线文件精确哈希（3个厂商策略，3个profile helper各+1行）；新增错误/增长/抑制均失败。17项回归通过。
- 首轮Windows CI的CIM清理失败已修复；`35722545291` 和 `35793283210` 的真实GUI/进程清理均通过，后者新增的真实生产默认入口也通过。这两轮整体仍因CLI gate失败，不能记为CI全通过。
- `35793283210` 的完整raw日志定位到GitHub Actions自动切换输出格式：任务前缀缺失导致归因检查拒绝。串行并未单独解决；随后固定Turbo stream/task prefix及oxlint default formatter。相同 `CI=true; GITHUB_ACTIONS=true` 环境下修复前复现失败、修复后完整gate通过，新增真实Turbo/oxlint回归；原始错误未过滤、规则未放宽。
- 厂商ARMS关闭时恢复原生本地CrashReporter（不上传），保留本地诊断能力；实际默认产品smoke检查上传开关。
- 初版profile方案曾覆写HOME且未挡住生产shared chunk提前初始化；现由真正独立、不分包的package.main先建立应用根再动态加载main。默认应用目录为 `~/.pi-agent-ide/.zcode`，执行HOME/USERPROFILE保持不变，显式ZCODE_DATA_BASE_DIR优先。详情和迁移规则见 [desktop-profile-contract.md](desktop-profile-contract.md)。
- 应用设置/Agent历史/资源使用稳定profile，只有v2数据按原生服务迁移；实际加密凭据移走/重启/重置后解密成功，SQLite会话连续。旧profile访问为0、sentinel未改写，Git/SSH/终端和独立CLI默认行为保留。
- 复审发现Saved Workflow存储入口遗漏，已在 `63da90a` 统一全生命周期目录，并保留显式homeDir/project优先级；4项真实文件回归通过。工作流引擎和Pi工作流能力不是这些存储测试的通过范围。
- Pi接入时须显式区分GUI profile与用户实际Pi配置/会话目录，保持P17/P18的CLI互通与凭据作用域；本轮没有将Pi引擎放入GUI私有HOME。

## 对照限制与后续任务

- 此固定原版的会话拆分入口未启用（原生 header 按钮注释/菜单不可用），本轮保持原状，记录为原版缺口。Side Pane 标签拖拽和面板/终端 resize 已实际验证；完整 I02 由 #5 在确认后补齐，未记为通过。
- 自动化覆盖 Chromium IME 合成/提交不误发；物理 Windows 输入法候选窗口仍需人工操作，完整 T19 在 #26。
- 原版有缺失的 text.svg/zcodeignore.svg 图标请求，未隐藏该观察；不影响上述已验证内容/操作。
- 19 项继承的第三方原始材料仍待补齐，详见 third-party/README.md；不是许可证全部完成或可发布完整首版的声明，最终发行由 #27/#28严格检查。
- Windows 完整安装/升级/回退、远端、Pi真实模型/完整矩阵均未在本轮宣称完成。

## 关卡与提交

两轴独立审查覆盖 `9ef5970…0de01e2` 的完整变更，复审确认所有提出的P1/P2已修复。Spec复核4982个源码哈希、6633个产物哈希及全部52张成对图，无不一致。技术证据包括87项Node回归、19组真实GUI操作及独立的生产默认入口验证；CLI raw lint仍有明确披露的上游样式错误。

#32 的技术结果不构成 #33 用户批准。PR #37 最新HEAD CI通过并合并后关闭#32/#36；向用户展示上述成对截图及实际预览，在 #33 保存明确确认及对应产品提交后才能接 Pi。当前用户确认链接仍为空；以GitHub最新状态为准。
