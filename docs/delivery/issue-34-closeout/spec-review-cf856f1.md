> 来源：2026-09-27 本机 Pi 子 Agent `A-577ce8ee`（`pi34-spec-sol`）的完整最终回复。审查基准 `cf856f1794a10a585ef2907fec6cfcba9791f54d`。以下保留 reviewer 原文及验证边界；保存报告不代表审查通过。当前进度见 [next-context.md](../next-context.md)。

# PR #39 独立 Spec 复审

## 结论：**REQUEST CHANGES**

CI 已绿，旧三项生命周期缺陷已修复，但发现一项直接违反 Issue #34 验收 2 的 **P1**：Pi 压缩失败的错误内容在原生状态投影中丢失。此外，当前图片读取工具返回 `Image reading is disabled`，旧视觉项仍不能由本 reviewer 独立判为通过。

## 审查身份与冻结范围

- Provider：`openai-codex`
- Model：`gpt-5.6-sol`
- Reasoning：`xhigh`
- 分支：`issue-34-native-pi-rpc`
- HEAD：`cf856f1794a10a585ef2907fec6cfcba9791f54d`
- Base / merge-base：`4e6cf6ad8a24dcaeaf93e3bcf84bc22a4e9e2b3a`
- 范围：完整 `4e6cf6a..cf856f1`，共 16 个提交
- tracked worktree 与 index 干净；仅保留既有 `?? %SystemDrive%/`，未触碰
- 未运行本地测试、GUI、构建或打包，未修改源码/Git/GitHub

## 发现

### P1 — `compaction_end.errorMessage` 未投影，错误阶段可能没有错误信息

固定 Pi 的合同明确规定失败的 `compaction_end` 携带 `errorMessage`；仓库真实 Pi 测试也观察到了该字段：

- `packages/services/test/pi-rpc-commands.test.ts:63-73`
- `node_modules/@earendil-works/pi-coding-agent/docs/rpc.md:1107`

但 supervisor 只设置错误布尔值，不保存错误文本：

- `packages/services/src/pi-agent/pi-session-supervisor.ts:94-102`

随后 `agent_settled` 将会话置为 `error`，而 snapshot 只有在 `view.error` 存在时才生成 `lastError`：

- `packages/services/src/pi-agent/pi-session-supervisor.ts:122-126`
- `packages/services/src/pi-agent/pi-v4-snapshot.ts:74-89`

可复现事件序列：

```text
agent_start
compaction_start
compaction_end { aborted:false, errorMessage:"Compaction failed: quota exceeded" }
agent_settled
```

结果是 `phase=error`，但 `lastError=null`，或仍显示之前无关的旧错误；真实压缩失败原因被丢弃。现有测试只覆盖原始 RPC 事件及成功压缩，没有覆盖此原生 service 投影。

**影响**：不满足验收 2 的 compaction/异常输出语义。应增加失败压缩的 service-level 回归，并保证成功恢复只清理对应压缩错误，不覆盖 extension/protocol 错误。

### P2 — `forced=[]` 不能证明 Pi 内部没有强制终止

GUI 报告中的 `forced` 只统计 `app.quit()` 后仍残留、再由 smoke harness 强杀的进程：

- `scripts/native-smoke/cleanup.mjs:89-100`
- 报告：`pi-native-gui-report.json:213-262,558-612`

产品内部清理另有 500ms 后的 `/F` 路径：

- `packages/services/src/pi-agent/pi-rpc-client.ts:374-380`
- `packages/services/src/process/processTreeTerminator.ts:246-301`

冻结 push artifact 日志多次记录普通 `taskkill /T` 失败并提示只能强制结束：

- `.../pi-native-gui/pi-native-gui.log:1413-1418`
- 同类记录还见 `553-565,627-629,1026-1028`

因此 `forced=[]` 可证明“harness 无需事后强杀且无 survivors”，不能支持 `review-resolution-2026-09-24.md:44-46` 所称的“强杀为 0”。这不否定最终无残留，但证据字段/文案应区分 harness 强杀与 runtime 内部 `/F` fallback。

- P0：无
- P1：1
- P2：1

## Issue #34 五项验收映射

1. **GUI→Pi 创建/流/工具/停止/恢复：功能通过，视觉子项未验证**
   - push 报告：`streamPartialVisible=true`、`piRead=true`、`piStop=true`、`restartReplayed=false`、工具卡恢复完成、README 预览可见、`pageErrors=[]`。
   - 使用真实固定 Pi 0.87.0 子进程执行 `read`；推理端是明确标注的确定性 loopback，**不是在线供应商**。
   - 视觉截图无法独立目视：图片工具返回 `Image reading is disabled`，不得宣称视觉通过。

2. **ACK/settled/retry/compaction/异常/背压/退出：不通过**
   - ACK、`agent_settled`、retry、扩展 no-run、JSONL framing、背压及退出结果有实现和测试。
   - 被上述 **P1 compaction 错误丢失**阻塞。

3. **双会话、单写者、generation、取消、不重放：通过**
   - GUI 两个不同 session ID，切换无新增模型请求。
   - `pi-rpc-real-session.test.ts:10-23` 验证两个真实独立 Pi PID。
   - lease、跨 Host 竞争、dispose/start 和 exit/resume 测试覆盖单写者与生命周期。

4. **产品 Agent 仅由 Pi 执行：通过，限定桌面 #34 边界**
   - `packages/services/src/node.ts:2083-2084` 选择 Pi service。
   - Pi 模式关闭旧 task ingest：`packages/services/src/node.ts:2286`。
   - 远程执行在启动旧 server 前失败关闭：`packages/desktop/src/host/index.ts:2915-2931`。
   - `conversationPlansV4` / `conversationWorkflowRunsV4` 日志属于未实现能力的显式 fail-closed，不是旧 Agent fallback，也未产生 page error。

5. **合同、测试 seam、构建/包路径、审查和 Windows CI：部分通过**
   - 合同、固定版本、测试 seam、构建及包路径明确。
   - 冻结 push/PR Windows CI 全绿。
   - 但本次 Spec 复审为 `REQUEST CHANGES`，故审查关卡未通过。

## 旧 Spec 四项裁定

1. **成功 retry 残留错误：已修复**
   - `pi-session-supervisor.ts:80-90`
   - 实时 `lastError=null`：`pi-real-retry-history.test.ts:142-146`
   - extension 错误不被误清：`pi-supervisor-lifecycle.test.ts:174-196`

2. **dispose 未排空在途启动：已修复**
   - `pendingStarts` 与 disposal fence：`pi-session-supervisor.ts:30-32,285-313,496-509`
   - gated create/resume 回归：`pi-supervisor-lifecycle.test.ts:79-169`
   - workspace release 回归：`pi-workspace-release.test.ts:65-113,275-319`

3. **exit 后立即 resume 锁竞争：已修复**
   - exit cleanup barrier：`pi-session-supervisor.ts:150-159,312`
   - 无固定延时的确定性 gate：`pi-supervisor-lifecycle.test.ts:201-244`

4. **视觉与缺失 SVG：未独立关闭**
   - 两份 CI native 报告均为 18/18 动作、48 张图，238/239 个可见图片实例尺寸非零。
   - 仍有 19 次 `text.svg` / `zcodeignore.svg` 失败请求。
   - 相关资产和 fallback 相对 base 未变，`fileDisplay.tsx:64-80` 会回退到 `document.svg` 再到内联图标，因此未发现本 PR 新增的确定性破图路径。
   - 但因图片读取禁用，不能独立裁定真实视觉影响或布局对照。

## CI 与证据核验

- Push run `36007379816`：SUCCESS，head `cf856f1`
- PR run `36007385923`：SUCCESS
- PR 临时 merge `10514ab...` 的 tree 与冻结 HEAD tree 同为 `6be6b167...`
- Push artifact digest：`sha256:6851203540f28bb0992aad8ebf3c2a372bf5e7989c97142094e6e9a67eee318f`
- PR artifact digest：`sha256:ada98d638d9d96805ebbc719ed042c483c61377d6bff77147da8b5d473b8b060`
- 两轮均通过 lint、typecheck、完整 service/UI tests、license/provenance、production main/renderer build、native smoke、Pi GUI restart/isolation 和默认 profile 入口。

GUI 部分流握手没有固定 900ms 假通过：模型在 `scripts/native-smoke/pi-model.mjs:48-51` 等待，GUI 必须先观察精确部分文本和 Stop 按钮后才在 `scripts/pi-native-gui-smoke.mjs:98-103` 放行完成帧。Stop 同样要求请求仍处于 held 状态并实际关闭连接。

## 未验证项

- 截图的独立目视比较。
- 在线真实供应商认证/推理。
- 安装器安装及升级；CI 运行的是 production output，不是安装后的 exe。
- 本会话未独立重跑任何测试/GUI/构建。
- Toolhelp 预编译程序集未在本会话从源码重新编译比对；现有测试只验证提交的源码/程序集各自哈希及真实进程身份行为。

修复 P1 并补充回归后仍需一次能够实际读取图片的独立视觉复审，才可能给出 `PASS`。
