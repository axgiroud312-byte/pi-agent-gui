# #32 原生导入 CLI lint 基线

用户目标是优先保留固定 ZCode 原生源码与交互；#32 不做无关的大规模 CLI 拆分。
这是交由 PR #37 独立 Standards 审查的**原生导入样式让步**，不改变行为、GUI、
400 行新代码要求或 #33 用户关卡；Pi #34 未开始。

## Gate 合同

- 来源只认 `zai-org/ZCode@872ad960de7ec172591f7e1952f7849229f94521`（Apache-2.0）。
  `.oxlintrc.json` 已启用 `max-lines: 400`，忽略空白行和纯注释行；CLI AGENTS 要求运行 CLI lint/typecheck。
- 脚本/配置预检后运行原 lint 脚本 `pnpm --dir apps/zcode-cli lint --concurrency=1 --force`，保存原始 stdout、stderr、退出码。串行无缓存执行避免并发 fail-fast 的半截任务日志，不更改包脚本或诊断规则。
  Turbo 会提前停止，所以另按所有包实际 lint 脚本逐包运行 JSON formatter，收齐结果。
- 基线逐文件记录固定上游 blob、规则、诊断次数、有效行数和最大允许行数。
  只有既存 `eslint(max-lines)` error 可匹配；其他 error、未知超长文件、额外诊断、未批准增长均失败。
  warnings 按原生语义保留并报告；命令/解析失败不能当作 lint 诊断豁免。
- 校验完整 workspace/script/Turbo 拓扑，保留 `debug: src server scripts`、
  `prompt-trajectory: src scripts` 及原有 `--no-ignore`，不得统一缩为 `src`。
  新包、脚本/配置变动或扫描缺失需要显式审查。
- 固定每包扫描数量下限；缺失的基线诊断也失败（缩短到 400 行以下后须显式退役该条目）。
  固定上游已含 17 个带 lint pragma 的源文件，另以整个文件的 Git blob 冻结，禁止借旧抑制继续堆代码。
  新的 disable/规则配置注释失败；没有增加任何 suppression。
- 不自动更新基线，不关闭 max-lines，不用 continue-on-error，不宣称原始 lint 通过。
  根前端 `pnpm lint` 仍全量执行，无此基线 override。CLI typecheck 独立执行与报告。

## 精确额度

权威清单：[`scripts/native-cli-lint-baseline.json`](../../scripts/native-cli-lint-baseline.json)。
86 个文件各限 **1 个 `eslint(max-lines)` error**；80 个文件有效行数不得超过上游。
3 个厂商策略文件只接受 `c896a8de6e351f61007efd9eec85bd8fe448c5e3` 的精确源码；
另 3 个应用数据路径文件只接受 `111df6321257a21b0f98ab70dc49c9a29fc50a80` 的精确源码：

| CLI 下的文件 | 上游 → 上限 | 原因 |
| --- | --- | --- |
| `packages/adapters/src/plugins/marketplace.ts` | 2480 → 2504（+24） | helper import、各来源/安装/验证/重定向入口 guard，保留原控制流 |
| `packages/adapters/src/plugins/zip-source.ts` | 458 → 460（+2） | helper import 与重定向 URL guard |
| `packages/bootstrap/src/plugins.ts` | 1280 → 1290（+10） | capability import、单一官方源 guard、批量刷新过滤 |
| `packages/adapters/src/config/file-config.adapter.ts` | 509 → 510（+1） | profile helper import；只替换已有应用目录展开表达式，普通 `~/` 保持执行 HOME |
| `packages/adapters/src/model/runner-debug.ts` | 776 → 777（+1） | profile helper import；替换已有日志根表达式 |
| `packages/adapters/src/storage/workspace-hook-trust-store.ts` | 472 → 473（+1） | profile helper import；替换已有 config/storage/tilde 根表达式，保留原 trust store |

额度绑定 **LF 归一化的 Git blob SHA-1**，不是可挪用的空余行数；比上游长但不是已审查源码也失败。
原生计数忽略空白/纯注释，不能拿物理行数代替。新 `product-marketplace-policy.ts` 为 31 物理行，
无基线条目、仍受 400 行规则约束。修改额度、退役条目及工具/扫描拓扑变更必须重新审查。

## 执行与 artifact

```sh
node scripts/check-native-cli-lint.mjs
node --test scripts/test/native-cli-lint.test.mjs
# 独立、固定 872ad96 checkout；依赖已可用时，重新验证每个上游 blob/有效行数：
node scripts/check-native-cli-lint.mjs --root <upstream-checkout> --verify-upstream
```

`--root` 默认脚本所在仓库；`--output <新目录>` 可指定 artifact 位置。
默认 `.scratch/native-cli-lint/<UTC时间>/` 保存原命令和每包完整 JSON stdout、stderr、status/哈希、
Turbo dry-run 及 `summary.json`（实际源码提交、逐项接受/失败、全部 warnings）。CI 显式使用 `--output test-results/native-cli-lint` 并上传整个目录，避免隐藏的 `.scratch` 被 artifact 默认排除。
JSON 扫描只追加 `--format json`，在各包 cwd 使用最近的已安装 oxlint，不加规则/忽略 override、不走缓存。
原命令的失败还须能归因于完成的 lint task，且结果与新扫描一致；非 lint 故障、格式变化和截断失败关闭。

工具版本来自固定上游**根** `pnpm-lock.yaml`：CLI oxlint 1.67.0、Turbo 2.9.14；Node 24.14.0、pnpm 10.33.2。
CLI 独立旧 lock 的 oxlint 1.62.0/Turbo 2.9.8 不是本次根 workspace 安装的版本。
本地只读复用已安装依赖，并将根 `node_modules/.bin` 加入进程 PATH，提供嵌套 CLI 所缺 Turbo；没有安装/构建。
raw stderr 中的 Turbo fallback/旧嵌套 lock transitive-closure warnings 原样保留，完整包范围另经 dry-run 和 manifest 双检。

## 实际验证（2026-09-22 / Windows）

完整 14 个 lint 脚本（17 个 workspace 包）有 **86** 个既有 max-lines error：
adapters 25、bootstrap 20、core 29、contracts 6、cli 2、telemetry 2、debug 2。
`shared-types`、`swift-bridge`、`typescript` 原本没有 lint script，清单显式记录 null，不能悄悄添加/移除。
45 只是前两个包的部分结果；Turbo 的实际打印数量随提前停止/缓存而变化，不能作为完整计数。

| 检查 | 真实结果 |
| --- | --- |
| `pnpm --dir apps/zcode-cli lint`，固定 `872ad96` | **exit 1，失败**；完整 JSON：1343 文件、86 errors、53 warnings |
| 同命令，独立 `858b1c6 + c896a8d` 副本 `db788de` | **exit 1，失败**；完整 JSON：1344 文件、相同 86 errors、53 warnings |
| `--verify-upstream` | 上游 86 个 blob/计数、17 个 pragma 文件及拓扑复核通过 |
| 产品副本 baseline gate | 86 条精确匹配，通过；原始 lint 仍失败 |
| `node --test scripts/test/*.test.mjs` | 36 通过，其中本 gate 16 项；真实 oxlint 验证增长、新文件、新规则/解析错误、额外诊断、pragma、异常退出及范围缩减 |
| `pnpm lint`，`db788de` 产品副本 | 原生根全量：2580 文件，0 errors / 70 warnings，exit 0，无本 gate override |
| `pnpm exec oxlint scripts/check-native-cli-lint.mjs scripts/test/native-cli-lint.test.mjs` | 本次新增 gate/test：0 errors / 0 warnings |
| CLI typecheck / 构建 | 本任务未执行；CLI typecheck 由主集成任务单独执行与记录 |

独立副本 CLI 与 `c896a8d` 已用 `git diff --exit-code c896a8 -- apps/zcode-cli` 核对相同；CI 分支未整批引入品牌提交。
本地 artifact（相对于 `pi-ci-32` worktree）：

- 上游：`../pi-ci-32-lint-upstream/.scratch/native-cli-lint/2026-09-22T10-16-18-986Z/`
- 产品：`../pi-ci-32-lint-current/.scratch/native-cli-lint/2026-09-22T10-16-19-001Z/`
- 产品 raw stdout SHA-256：`a5d3fa1012e59fc0565a6e1a738fdf9ec614c45cef5faaa0750307332f2c7f25`；
  stderr：`c55ce429fbf1ca89b8cd515153f18abfdc77ba2bc6c9b923b4889f85a9cef587`。原始日志未脱敏改写，留在本地 artifact；发布时留意其中机器路径。

本次交付只定义透明的 native-import gate；PR #37 的独立审查、完整行为/GUI验收与 #33 确认仍各自成立。

## 后续集成修复（2026-09-23）

- CI `35722545291` 的原生 GUI/进程清理通过，仅 CLI gate 拒绝 `@zcode/contracts` 的未解释 raw 失败。原 raw 日志放在隐藏目录而未上传，不能据此断言具体子进程根因。
- 本地以相同 CI/Rayon 设置重跑，原并发 raw 输出完整；新 profile 接线被 gate 正确拒绝为上述 3 个文件各 +1 有效行。审阅 `111df63` 的 import/原表达式替换后，逐文件登记 blob 和精确额度，不增加通用预算。
- 原命令改为串行无缓存执行，仍对未完成、被中断、非 lint 退出严格失败；新增负例保证其他已知超长错误不能替中断任务免责。逐包 JSON 全量扫描和所有拓扑/pragma/新错误保护不变。
- 最终 CI 结果和整体验收见 `issue-32-acceptance.md`；本节不替代独立审查。
