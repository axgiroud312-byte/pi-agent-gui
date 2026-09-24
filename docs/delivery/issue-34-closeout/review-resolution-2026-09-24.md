# #34 对 4fd60df 的 12 条复审意见逐项收口

范围：当前工作树 `issue-34-native-pi-rpc` 相对 `4fd60df` 的新增改动。原始意见见 [Standards](standards-review-4fd60df.md) 和 [Spec](spec-review-4fd60df.md)。下表记录主会话核对与本地回归；独立复审结论仍以审查人复核为准。

| 意见 | 接手时状态 | 当前处理与可核查证据 |
| --- | --- | --- |
| Standards 1：崩溃后 admission 身份和 intent | 部分修复；首输入无 JSONL 时仍可能发给 Pi，pending intent 未完整挡重入 | 首输入前保存指向预留 Pi 历史路径的书签；保存失败则不发 prompt。无 JSONL 的 extension no-run / 崩溃状态恢复为可发现但禁输入的会话；pending intent 无论 uncertain 标志都挡重入。`pi-durable-admission`、`pi-bookmark-admission`、`pi-admission-reconciliation` 覆盖。真实扩展可能产生的外部副作用无法仅凭无历史判为未执行，保持隔离而不重放。 |
| Standards 2：同 session 并发 admission | 未完成 | 同会话 `sendText` / 删除串行接纳；每次接纳推进 generation 和 record version，旧 settled 读不得覆盖新轮；只有同 generation、同文本和完整 assistant 轮次才能清 intent。`pi-admission-reconciliation` 和 `pi-settled-reconciliation` 覆盖模型竞争与延迟历史读。 |
| Standards 3：Host 退出预算和后代 | 已有未提交修复 | Main/Host 的退出报警预算对齐，报警不再提前杀掉仍负责清理的 Host；Pi 客户端清理验证真实进程树后才释放租约。`pi-host-shutdown-budget` 覆盖 hung clear/abort 与真实 bash 后代。 |
| Standards 4：全局失败收口 | 部分修复 | workspace/global disposal 即使某 owner 失败仍排空启动、命令、书签写入和其余 owner，最后聚合报错；失败的 Pi close 不提前释放锁。`pi-workspace-release`、`pi-host-disposal`、`pi-supervisor-lifecycle` 覆盖。 |
| Standards 5：锁崩溃恢复 | 部分修复 | 新锁和恢复 claim 在公开前写全 owner；死 owner 的 claim 可按唯一代际恢复，活 owner/初始化中的旧锁不得抢占；unlink 失败可重试。`pi-lease-recovery` 覆盖跨进程竞争、空/partial 旧锁、陈旧 claim 和失败重试。**边界**：旧版留下的无 owner 空 `.lock` / `.recover` 无法证明写入者已死，故拒绝自动接管，需人工核对进程树后处理；这项由复审裁定是否满足安全验收。 |
| Standards 6：settled 唯一完成边界 | 部分修复 | `compaction_end` 不结算轮次；user-only 历史在实时、settled、冷恢复和 v4 snapshot 中均不得显示成功或接纳新输入；成功 retry 清模型错误但保留独立 extension/protocol 错误，summarization retry 投影到 retry 状态。`pi-settled-reconciliation`、`pi-durable-admission`、`pi-v4-snapshot`、`pi-real-retry-history`、`pi-supervisor-run-state` 覆盖。 |
| Standards 7：Stop 返还队列 | 未完成 | Stop 从 Pi clear_queue 得到的项目保存为独立返还队列；重启恢复为暂停、非自动执行状态，新前台输入也不使它 auto-drain。`pi-admission-reconciliation` 覆盖 Stop→重启/新输入。 |
| Standards 8：诊断边界 | 未完成 | supervisor 诊断接到 service；未知合法 record 和 stderr 只记录有界、脱敏类别，启动 extension error 可见。`pi-diagnostics-projection` 覆盖。 |
| Spec 1：成功 retry 残留错误 | 已有未提交修复 | 成功 retry 的实时和重启历史 `lastError=null`；耗尽重试保留错误，extension 错误不被模型成功误清。`pi-real-retry-history`、`pi-supervisor-lifecycle` 覆盖。 |
| Spec 2：dispose 漏在途启动 | 已有未提交修复 | dispose 先封堵新工作，再等待 lease 后、注册前等在途启动和清理；`pi-supervisor-lifecycle`、`pi-workspace-release` 覆盖 gated startup/resume。 |
| Spec 3：exit/立即 resume 争锁 | 已有未提交修复，另补租约释放顺序 | resume 等待 exit cleanup，exit 等 `client.dispose()` 验证进程树后释放 lease；`pi-supervisor-lifecycle` 覆盖无延时竞争及失败保锁。 |
| Spec 4：视觉与缺失 SVG | 未完成 | 新 Windows 包内实际 exe 运行 Pi GUI：文本、真实 Pi `read`、Stop、恢复、滚动、标签和会话切换通过；主会话目视复核 1280×800、1920×1080 明暗主题和工具预览截图。最新原生 18 项 GUI smoke、48 张截图通过；237 个逐帧可见图片均 `complete=true` 且尺寸非零。报告仍记录 `text.svg`、`zcodeignore.svg` 的 19 次请求失败；可见文件图标回退到存在的 `document.svg`/内联图，截图未见破图。浏览器资源请求失败本身保留在报告中，不写成零错误。 |

`30c35ad` 的第一轮 Windows push/PR CI 没有通过，不能把前一轮本地通过当成最终验收。失败点逐项复核后只补了缺口：`.gitignore` 的新字节纳入固定 CLI lint 输入基线；Windows 会话路径断言改按真实路径与相对段比较；Pi 进程树识别加入父子创建时间顺序，避免 Windows 复用的旧 ParentProcessId 误认领大量无关进程；GUI 退出改为等待 Host 实际清理，修复无 CUA Helper 时 disposer 读取空对象，并使测试工具识别 CIM `/Date(...)/` 创建时间及验证真实后代清单。进程清理报错和 Host 聚合错误同时保留有界原因，方便下次定位，不放宽 fail-closed。

第二轮本地验证：完整 service suite 在最后的进程树改动前 **116/116**；该改动后的 Pi 传输、进程树与 Host 投影 **33/33**。完整仓库 `pnpm run lint` **0 errors / 70 warnings**，完整 `pnpm run typecheck` 通过；相关文件定向 lint **0 errors**。CLI 输入基线检查通过，17 项防绕过测试通过。Windows x64 NSIS **重新打包**，依赖闭包和体积审计通过，安装包 **170.6 MiB**。最终包 `win-unpacked/Pi Agent IDE Preview.exe` 的真实 GUI 复验见 `release/issue-34-closeout/gui-packaged-final2/`：Pi 文本、`read`、Stop、退出重启、历史恢复、滚动、文件预览、标签与双会话通过；两次退出均识别 10 个本轮进程，`graceful=true`、`forced=[]`、`survivors=[]`，`pageErrors=[]`、隔离目录越界写入 `[]`。原生完整 GUI smoke 在最后源码上 **18/18**，48 个截图状态、237 个可见图片实例无破图，页面错误 0；19 次缺失 SVG 请求仍原样保留。主会话目视检查了新包的深色恢复界面和文件预览截图，未见破图。测试与包日志均位于仓库 `release/issue-34-closeout/`，未纳入 Git。

`8f8e0e3` 的两轮 Windows CI 均通过静态检查、服务与 Pi 传输、许可证、生产构建和原生 GUI，**只在 Pi 历史重启 GUI 步骤失败**。上传的 Host 日志显示退出时 CIM 进程身份查询约 2.5 秒后不可用，安全闸门正确保留 `.runtime-uncertain`；因此不能把第二轮本地 GUI PASS 记作 CI PASS。后续仅调整 Windows 身份查询：明确调用系统 PowerShell 及 CIM 模块路径、只请求 PID/父 PID/创建时间三个字段，把单次冷启动查询上限设为 5 秒、Pi 树总清理上限设为 12 秒；身份仍不可用时保持锁，不放宽安全判定。

该修复的本地验证：完整服务 suite 在最后的 CIM 字段收窄前 **117/117**，最终字段查询代码的受影响传输、Host teardown、进程树测试 **35/35**；完整 lint **0 errors / 70 warnings**、完整 typecheck、定向 lint **0 errors**。再次重新打包的 Windows x64 NSIS **170.5 MiB**，依赖闭包和体积审计通过。该包内 exe 的真实 GUI 报告在 `release/issue-34-closeout/gui-packaged-cim-final/`：Pi `read`、Stop、重启恢复和双会话通过，首次/最终退出分别识别 **9/10** 个本轮进程，均 `graceful=true`、`forced=[]`、`survivors=[]`；`pageErrors=[]`、隔离目录越界写入 `[]`。本地开发入口同样通过退出与重启；最终原生 GUI smoke **18/18**、48 个截图状态、241 个可见图片实例无破图，页面错误、强杀和残留均为 0，Host 日志无清理失败；19 次缺失 SVG 请求仍单列。以上仍待这个后续提交的两轮 Windows CI 验证。

GUI 测试用隔离的本地确定性模型端点；Pi 是真实固定版本子进程并真实执行 `read`，不等同在线供应商推理或安装升级验收。当前仍须提交推送最新 CIM 修复、等待**该提交**的 Windows push/PR CI 变绿，再续 Standards / Spec 全 PR 加增量复审；在复审通过前 PR 保持 Draft，#34 保持 OPEN。
