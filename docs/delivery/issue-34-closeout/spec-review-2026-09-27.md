# PR #39 Spec 与视觉复审：PASS

审查者：本轮独立只读子 Agent `spec_visual_review`。由主会话汇编其最终回复；延续 [旧完整 Spec 报告](spec-review-cf856f1.md)，核对最终修复与受影响路径，不冒称重新执行全部旧运行检查。

基线：`ef7780564a878b9be5d73b191df25a765b795519` 加本轮未提交修复。已读 #34 最新正文/评论、#1 父规格、#33 关卡及 PR #39 Draft 状态。远程 CI 已取消。未发现仍需修改产品代码的 P0/P1/P2。

## 修复与证据

- P1 压缩失败原因：`compaction_end.errorMessage` / abort fallback 进入 `view.error` 和原生 `control.lastError`，保留独立 extension/protocol 错误。
- 本轮额外发现并修复的同路径问题：固定 Pi overflow compaction 成功后 `agent.continue()` 可直接发出 agent_start，没有 auto_retry_end。旧实现残留模型错误、可能把 extension 失败误判为成功。最终实现仅清掉已恢复的模型错误，保持 persistentRunError。
- 新回归从原生订阅 wire frame 读取 SessionControl，覆盖 failure、aborted、extension、protocol、recovery、recovery-extension、recovery-protocol。审查者实际读取修前日志 2 fail、修后 7/7，以及最终 Pi 回归 113/113；没有把主会话运行说成独立重跑。
- P2 清理证据：cleanup 注释/断言与历史说明均区分 harness 退出后补杀和运行时内部 fallback。`forced=[]` 不证明内部强制终止次数为零。
- 旧 retry、dispose/start、立即 resume、单写者、generation、桌面 Pi-only 边界未发现被本轮增量破坏。

## 实际目视复核

审查者已用图片工具逐张读取：

- 本轮 `release/issue-34-closeout/2026-09-27/gui-native/screenshots/` 48 张截图。
- 固定原版 `docs/delivery/issue-32-parity/original-*.png` 26 张截图。
- 原版/Pi 三阶段滚动 6 张历史图。

覆盖 1280×800 / 1920×1080、明暗主题，窗口/侧栏、空态/运行态、Lexical、代码块、Read 工作历史、Side Pane 文件预览/标签、文件树、终端缩放、错误/恢复、停止、任务菜单、命令面板和会话返回。未见 #34 内未登记布局偏离或可见破图。“Pi 工具直接执行”、品牌和会话标题符合已登记语义。

本轮 239 个图像实例全部 complete 且宽高非零；仍有 text.svg 18 次、zcodeignore.svg 1 次失败请求，蓝色文档 fallback 在图中实际可见。相关 fallback 源码相对 merge-base 未改。不把目视通过说成不存在网络失败请求。

滚动跟随、手动上滚保持和返回最新的入口/可见反馈一致，绝对高度差已登记；这六张仍是历史实测，不能冒称本轮新包动态操作。原版等待交互、扩展答复 UI、完整命令资源目录和 split 没有因此交付。`/` 与 `@` 菜单中的 getSkillReferenceCatalog / getPluginReferenceCatalog 未实现提示必须保留为试用限制。

本轮 native 报告：18/18 操作、48 图、pageErrors=[]、buildUnchanged=true；真实固定 Pi RPC/工具 + 受控模型。运行 2026-09-27T05:44:55.927Z → 05:46:33.018Z。

| 摘要 | 值 |
| --- | --- |
| native sourceDigest | `3a7ba0a5ef0711a11b85f03173f5a99794e9b72230ce0b5f4b055e7581a85d82` |
| native artifactDigest | `845bae6e67784938e0026d12d0a52fe41d8e94f1d07598237dddbcb7fd7c12d0` |
| supervisor SHA-256 | `696CB687AEC89E180433F65459AF6DF6DDB707217EBF44EDB2D95B437167498F` |
| 新回归 SHA-256 | `8B36A0D7ADB0F4BC8C4CE4D388B24CA8B03D46B630DC257CCD032D0D6384CCCC` |
| cleanup SHA-256 | `31F20697A1F0FEC8B99BFFAD2286354D53AFEAE6DDD638C098EDD873C4C49DB3` |

审查者没有修改文件/Git/GitHub、运行构建或操纵 GUI。初次最终结论时新包仍在构建；包内结果另在 [收尾报告](closeout-2026-09-27.md) 记录。在线供应商认证/推理、安装升级、物理 IME 候选框、完整分栏/编辑/Git/WSL/SSH、内部强制终止次数均未因此验收。保持 PR Draft / #34 OPEN，停在用户验收。

## 新包追加复审：PASS

同一独立 reviewer 随后只读核对 `gui-packaged/pi-native-gui-report.json`，并逐张实际读取相邻全部 **19 张新包截图**；没有重跑测试或操作 GUI。启动、原生 composer、真实 Pi read / stop、8 次模型请求、重启 `restartReplayed=false`、双会话 ID 对应与 `noReplay=true` 均与画面相符。

已看两尺寸/明暗恢复状态、工具卡、README/hello.txt 文件预览、标签拖动/关闭、长流式自动跟随/手动上滚保持/返回最新及第二会话，未观察到新包遮挡、破图或布局退化。hello.txt fallback 在新包图中可见，.zcodeignore fallback 仍由本轮 native 图覆盖。

包内 `out/host/index.js` SHA-256 为 `58523678fd185d5578180a56bd341d28a9f6610df6329bc522b50c51522c6e26`，与本轮最新构建一致并包含修复。两次清理各识别 10 个进程，graceful=true，harness forced / survivors 为空；pageErrors / filesystemBlocked 为空。未新增 REQUEST CHANGES 项，可进入用户验收。

本次成立的是新 win-unpacked exe 可启动、可试用；NSIS 安装/升级/卸载、在线供应商鉴权/推理仍未验收。分屏禁用、拖动后的首次点击抑制等已登记边界不变；不得把 harness 清理字段扩张成 runtime 内部从未强制终止。
