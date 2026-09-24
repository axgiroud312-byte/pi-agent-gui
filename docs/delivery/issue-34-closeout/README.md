# #34 收尾增量证据（尚未合并）

**2026-09-24 最新本地验收：见 [final/README.md](final/README.md)。** 生产整改后的服务81/81、新GUI、新Windows包及打包exe GUI已复验；CI与独立复审仍待完成。下面139项/旧GUI及未重建描述保留为历史过程，不覆盖最新状态。

本目录保存的历史证据基线：`280e01ed6ca0b0d54bb22e60230b0215e66e3d56` 加当时未提交的 CI / 测试 / 许可补件。**之后已开始生产 Pi 适配整改**，进度与新服务 64/64 结果见 [联合整改](../issue-34-standards-findings.md)。本目录旧 GUI、139 项记录不能作为新生产源码已验证的证据；新桌面/GUI/打包尚未重测，也不冒充最终提交的 CI。

## 可复核结果

| 范围 | 结果 / 证据 |
| --- | --- |
| 固定原版来源 | [source-verification.json](original/source-verification.json)：4,975 个源文件，1,183 字节相同，3,792 仅 CRLF 差异；零缺失、零语义内容差异。不是“全部 byte-identical”。 |
| 原版交互 | [original-native-scroll-report.json](original/original-native-scroll-report.json)：流式跟随、手动滚动、返回最新；真实 Read、文件芯片预览；标签拖拽/切换/关闭、resize；两个既有会话切换零重发；split 可见但禁用；零页面错/幸存进程。8 张原始截图同目录。 |
| Pi 交互 | [pi-native-gui-report.json](product/pi-native-gui-report.json)：实际 Pi 0.87.0 文本/read/停止、JSONL 重启恢复零重发；同视口滚动、工具芯片打开同工作区文件；双标签拖拽/切换/关闭、resize；两个会话切换零重发；split 仍禁用。19 张截图同目录。 |
| 产品原生矩阵 | [report.json](native/report.json)：18 组动作与 48 张图，四组合 empty/running/error/file-preview 均覆盖；文件守卫保持启用，实际 Pi 私有 quarantine 清理哨兵通过，未发生文件越界写入，无页面错/进程幸存。[截图与 DOM 文本](native/screenshots/)保留原始文件名。 |
| 服务/UI/基础回归 | [regressions-final.log](checks/regressions-final.log)：29 provenance/fixture + 54 services + 6 UI，全部通过，无 skip。 |
| 产品/profile/CLI | [profile-product-regressions-final.log](checks/profile-product-regressions-final.log)：33 项；[cli-lint-final.log](checks/cli-lint-final.log)：17 项。合计本轮 139 项测试通过，无 skip。 |
| 静态检查 | [lint](checks/full-lint-final.log)：0 errors、70 warnings；[typecheck](checks/full-typecheck-final.log)通过；[architecture](checks/architecture-final.log)零违例；[CLI typecheck](checks/cli-typecheck-final.log)27/27（Turbo 内容缓存命中，未称 fresh run）；CLI lint 使用既有固定上游基线，不增加例外。 |
| 来源/许可 | [provenance](checks/provenance-current.log)验证 6,123 项；[许可基础检查](checks/license-check-current.log)通过。保留全部旧 1,201 包版本并新增 84 项；继承的 19 项发行材料差额不变，未新增豁免。新增 source-lineage LICENSE 仍待 Standards 独立审查。 |

所有模型推理均为隔离的确定性 loopback HTTP 端点；原版运行旧 Agent，产品运行实际 Pi 0.87.0。没有声称在线供应商推理、完整认证设置、Pi GUI 压缩/命令菜单或扩展问答已完成。原版全部旧 Agent 特有断言保留在原版 smoke；完整能力/断言映射见 [issue-34-ci-acceptance-map.md](../issue-34-ci-acceptance-map.md)。

## 重现

从本工作树运行（准备原生生产构建与固定原版隔离副本后）：

```powershell
node scripts/native-desktop-smoke.mjs --baseline product --output D:/Temp/pi34-closeout/split-product-smoke-final
node scripts/pi-native-gui-smoke.mjs --output D:/Temp/pi34-closeout/pi-product-smoke-final
$env:NATIVE_ORIGINAL_ROOT = 'D:/Temp/pi-34-original-comparison'
node scripts/original-native-scroll-smoke.mjs --baseline original --output D:/Temp/pi34-closeout/original-interactions-final
```

原始 report 保留当时绝对路径和 PID，因此它们指向原始运行位置，不是仓库相对路径。完整 trace、模型请求和守卫日志仍在上述独立输出目录；本目录保存审查所需报告/截图/检查日志。首轮测试选择器和隔离问题的失败日志未删除。

## 仍未通过的交付关卡

- Standards 和 Spec 首轮均返回 **Request changes**：权限/执行约束、admission 与重启对账、租约时序、workspace 生命周期、Pi 状态投影、扩展交互、Stop 代际，以及 retry/compaction 后实时/恢复消息不收敛有生产阻塞。主会话已初核，见 [联合发现与精确化反馈](../issue-34-standards-findings.md)。139 项测试通过不覆盖或消除这些问题。两份首轮报告针对已提交 HEAD，原审查继续补审最新未提交增量。
- 当前图像工具返回 `Image reading is disabled`。已执行截图采集及操作/DOM验证，**未宣称已完成独立逐屏视觉审查**。
- 修复尚未提交/推送，最新远端 Windows CI 仍是失败记录；不能以本地结果宣称 CI 绿。
- 尚未把本轮许可补件重新打入新可启动包；旧可启动包不是本轮新包证据。
- 原有 19 项严格发行材料差额保留给 #27/#28，本票基础检查通过不等于最终发行合规完成。

PR #39 保持 Draft，#34 保持 OPEN；不推进 #3–#27 的实施，也不自动 ready / merge / close。
