# #32 CI / 来源与许可交接

日期：2026-09-22。分支 `issue-32-ci-provenance`，独占工作树 `C:\Users\niilo\AppData\Local\Temp\opencode\pi-ci-32`，起点 `317d286`。范围：Windows CI、许可/来源材料与检查、本文档。权威任务为 [#32](https://github.com/axgiroud312-byte/pi-agent-gui/issues/32)，父规格 #1；#32 无阻塞，#33 仍 OPEN 且无实际界面确认。

## 交付内容

1. `.github/workflows/ci.yml` 使用 **Windows、Node 24.14.0、pnpm 10.33.2、`pnpm install --frozen-lockfile`**。保留失败状态，同时继续收集独立检查结果；没有 `continue-on-error`。
2. CI 显式执行离线来源检查/回归、根 `lint`、根 `typecheck`、`architecture:check`、已导入的四个原生测试文件、实装依赖许可检查。根 package **没有** `test`、`test:contract`、`test:e2e`、`test:package`、`package:win`；旧 npm 原型命令不能用于新工程。
3. CI 先 `prepare:desktop-runtime` 准备本机资源，再按原生 metadata / clean / tsup / Vite 工具顺序串行构建桌面。设置 4 GiB Node heap、2 个 Rayon 线程；`ZCODE_SKIP_REMOTE_ASSETS=1` 只排除跨平台远端资源准备。原 `build:no-runtime-assets` 内部并行启动 tsup/Vite，所以这里显式串行调用这些工具。Vite/tsup 从冻结锁文件解析；当前实装版本由主实施报告为 **Vite 8.0.8 / tsup 8.5.1**，不是 package.json 中的范围下限。
4. CI 接入主 Agent 负责的 **`node scripts/native-desktop-smoke.mjs`**，要求实际默认产品路径；证据上传 `test-results/native-parity/**`，artifact 名 `windows-native-parity-<SHA>`。本工作树不创建或运行该 smoke；主 Agent 必须在集成提交中提供它。缺文件会真实失败，不以 `if exists` 跳过。
5. 恢复固定上游来源材料、原始许可换行属性，并重新生成对应实际输入的 `third-party/inventory.json`。新增无依赖 `scripts/check-native-provenance.mjs` 和 12 个 Node 回归测试。

## 来源修复与实际范围

- 原始 Git 对象：`C:\Users\niilo\AppData\Local\Temp\opencode\zcode-source-872ad96`，`zai-org/ZCode@872ad960de7ec172591f7e1952f7849229f94521`，提交日期 2026-09-21，第一方 Apache-2.0。
- 恢复清单原已引用但初次导入遗漏的 **220 个 `.agents/skills/` 输入**，仅五组既有 copied roots。逐文件比较暂存 Git blob 与固定上游 blob，220/220 一致。这些文件是保留的上游技能/示例/参考材料；本项目根 `AGENTS.md`、`CONTRIBUTING.md`、`CONTEXT.md` 仍保持项目指令身份。
- `.gitattributes` 对普通文本固定 LF，对第三方许可/聚合 NOTICE 使用原上游 `-text` 属性。上游技能中的 Markdown hard break 和示例空白原样保留，只有该 vendored 路径关闭 whitespace 提示，来源哈希仍照常校验。
- 暂存归一化差异证明：native-search 独立许可只有 `705aaaae…txt`、`7cfd738c…txt` 两份需要恢复原始 CRLF。其他 runtime/upstream/native 许可最初的 M 状态不是实际提交内容变化，未批量改写它们。
- 聚合声明恢复后与固定上游 Git blob 完全一致，**1,975,825 bytes**，SHA-256 **`05d366f61fe430c5a0c7ed6b27ac9bb6626591151331f2817cb9120649e4c67f`**。
- 原上游 inventory 自身落后于当前 `package.json`、`packages/ui/src/lib/builtinSkillI18n.ts`。通过真实生成器更新清单，不修改源文件来迁就旧哈希。重生成仍得到相同声明正文、**1201 个生产依赖精确版本 / 8 个 copied components / 18 个记录的 native archives**。
- 原生成器还恢复了 **19 项 `reviewRequired`**：React Best Practices、15 个版本固定的 npm 许可材料缺口、Skia、QuickJS-NG/WASI、Rust standard library。未清空、豁免或宣称已补齐。严格门禁仍失败，详见 `third-party/README.md`。
- 清单是所有导入 workspace 的生产依赖并集及 copied/native 材料，**不是 Windows 安装包 SBOM**。离线检查核验材料、源码快照与输入，不运行 Agent，不核验每个目标二进制或 Electron/Chromium 打包声明，也不证明更早第三方复制版本。

## 已实际执行

| 命令 / 检查 | 结果 |
| --- | --- |
| `node --version`、现有安装处 `pnpm --version` | 24.14.0 / 10.33.2 |
| `node --test scripts/test/native-provenance.test.mjs` | **12 passed，0 failed，0 skipped**；覆盖遗漏 skill、陈旧品牌 manifest、原始许可/声明/源码换行损坏、runtime/native/patch 内容损坏、不同安装输入拒绝、锁定/实装版本差异拒绝、严格材料阻断 |
| 固定上游 Git blob 对照 | 220 个恢复文件、聚合声明、两份许可与固定上游完全一致；根项目指令、根 package.json、pnpm-lock.yaml 与起点一致 |
| `readVerifiedNotices()` | **通过**，1,975,825 bytes，所有记录输入匹配 |
| `git checkout-index --all --prefix=…/pi-ci-32-verified-snapshot/` 后 `node scripts/check-native-provenance.mjs --root <snapshot>` | **通过**：6112 次哈希检查，2868 个 input，220 个 skill input；验证的是按暂存属性重新检出的文件，不依赖旧工作树 CRLF |
| 同一新检出 `node scripts/check-native-provenance.mjs --strict` | **预期失败**，恰好列出上述 19 项待补材料；无输入/字节错误 |
| 五个新增/修改许可脚本的 oxlint（读取 `pi-native-32` 现有安装） | **通过**：0 warnings / 0 errors |
| 全仓 oxlint，使用同一现有工具、cwd 为 `pi-ci-32` | **失败：70 warnings / 1 error**。错误为 `.backup-old-prototype/src/runtime/pi-rpc-client.ts:571`，`max-lines` 505 > 400；属于既存旧原型备份。没有改规则或缩小 CI lint 范围来掩盖它 |
| `git diff --cached --check` | 通过；原始 vendored 空白按上述路径属性保留 |

生成过程实际遇到并解决：一次全 workspace `pnpm ls --depth Infinity` 触发 Windows `EMFILE`；改为从根目录按 workspace filter 串行枚举锁定图/安装图。曾尝试子目录 cwd，但会读到旧 CLI 子锁文件，因此最终始终用根 cwd + 精确 workspace filter。深度仍是 Infinity、项目集完整、锁定/实装图比对仍执行。

本轮只读复用 `pi-native-32` 的现有依赖安装，没有在本工作树重新 install 或运行大型构建。全原生 typecheck、architecture、四文件原生测试、实装 license policy、桌面构建、GUI smoke、GitHub Actions 尚待主 Agent 集成后执行；不将本表的来源/12 项回归通过当成这些检查通过。主实施此前报告的 1881 包 frozen install 和 runtime-assets 成功属于主实施证据。

## 本次清单重生成方法（无二次安装）

为保证 copied-source 字节哈希来自真实检出，先导出已审阅的暂存文件；在导出目录执行生成器，读取匹配安装，把两个生成文件写回本工作树：

```powershell
# cwd: pi-ci-32；source-snapshot 是本次新建的临时目录
git checkout-index --all --prefix="C:/Users/niilo/AppData/Local/Temp/opencode/pi-ci-32-source-snapshot/"

# cwd: pi-ci-32-source-snapshot
node --input-type=module -e "import {generateThirdPartyNotices} from './scripts/generate-third-party-notices.mjs'; await generateThirdPartyNotices(process.cwd(), {dependencyRoot: '../pi-native-32', outputRoot: '../pi-ci-32'});"
```

`dependencyRoot` 只读；生成器必须确认同一项目集、所有 manifest、workspace 文件、lockfile 完全匹配（仅允许 CRLF/LF 差异）。生成使用实际安装许可文件并保留全部 review 项。该方法不是手工刷新哈希，也不是忽略缺失输入。

## 主 Agent 集成要求与下一条命令

**先整合 #32 构建/品牌/smoke 改动，再从最终代码新检出重生成。** 品牌会改变 `packages/desktop/package.json` 等已追踪 input，本提交生成的 inventory 不能直接作为品牌后最终清单；不同品牌 manifest 也不能复用旧 `--dependency-root`。

在最终新检出、Node 24.14.0 / pnpm 10.33.2 环境中逐条执行，前一条成功再执行下一条：

```powershell
pnpm install --frozen-lockfile
node scripts/licenses.mjs notices
node scripts/check-native-provenance.mjs
node scripts/licenses.mjs check
node --test scripts/test/native-provenance.test.mjs
git diff -- THIRD-PARTY-NOTICES.md third-party/inventory.json
# 审阅后将两个生成文件一起纳入集成提交，再从该提交新检出复验。
```

随后按 workflow 的确切命令跑全原生检查和串行构建。必须处理/记录上述全仓 lint 故障及新暴露的 typecheck/architecture/原生测试故障；本 CI 会保持失败状态，不只检查改动文件。为 `scripts/native-desktop-smoke.mjs` 提供真实默认产品流程和 `test-results/native-parity` 输出，在集成后运行它并检查 Actions 证据。

本 CI 不构建旧原型 NSIS，不声称新原生安装包验收或完整许可材料已完成。原版/产品成对截图、实际操作对照、可启动版本、Standards/Spec review、必要 CI 仍由主 Agent 集成交付。**#33 用户关卡继续开启，#34/Pi 新适配尚未获准。** 本分支仅本地提交，由主 Agent 接入；不 push、不建 PR、不关闭 Issue。
