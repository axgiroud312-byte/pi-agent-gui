# 独立 Spec 复审：REQUEST CHANGES

审查基线：PR #39 全范围 `4e6cf6a..4fd60df214b4b78451bb490004e075248b6c697e`。reviewer `pi34-spec-final` / `A-6f24732f`，实际 GPT-5.6 Sol / max。仅只读代码/证据，未运行测试。主会话亲核此 SHA 的 Windows push [35954403511](https://github.com/axgiroud312-byte/pi-agent-gui/actions/runs/35954403511) 和 PR [35954406341](https://github.com/axgiroud312-byte/pi-agent-gui/actions/runs/35954406341) 均 SUCCESS；CI 绿不抵消以下阻塞。

1. **成功 retry 残留错误**：`pi-session-supervisor.ts` 在失败 message_end 设置 view.error，成功 retry/settled 未清；snapshot.control.lastError 仍显示错误，重启后反而消失。真实 retry 回归需同时断言成功与恢复 lastError=null、耗尽仍保留错误；不能顺带清掉 protocol/extension/reconciliation 错误。
2. **全局 dispose 不排空在途启动**：supervisor 只关闭已注册 sessions，start 最后 await lease 后仍可能注册；service.disposeOwned 不排空 command/startup。需同步封堵新工作、追踪并排空启动/清理、注册前复检 disposed，并以 gated startup/lease 回归证明 dispose 返回无子进程或锁。
3. **exit 与立即 resume 竞态**：exit 删除 runtime 后后台释放 lease，同 Host 立即恢复可能争锁失败。需等待对应清理 promise；移除测试中30ms延时，加入确定性竞争测试。
4. **视觉仍未完成**：reviewer 和主会话的 read PNG 均返回 Image reading is disabled，不声称目视通过。native报告中 text.svg/zcodeignore.svg ERR_FILE_NOT_FOUND 需核实可见影响。主会话初核：fileDisplay.tsx/Helpers 与 base 无差异，document.svg存在且错误路径有document/inline回退；将在下一GUI报告记录可见图片加载/尺寸/最终来源。DOM资产健康不能替代视觉审查。

验收1–3不足；4在本票桌面Pi边界内PASS（独立server不宣称Pi化）；5按已提供构建/CI证据限定PASS。安装升级、在线供应商推理没有伪记为通过。Standards复审仍在进行。

主会话已核对三生产缺口，交单一worker在原worktree整改。为避免移动审查目标，Standards改读git archive固定快照 `D:/Temp/pi34-review-snapshot-4fd60df`。修复后须新测试/GUI/打包、提交CI、再由原reviewer复审。PR保持Draft、#34保持OPEN；不合并、不推进后续票。
