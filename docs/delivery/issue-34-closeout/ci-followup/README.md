# f92578a Windows CI 失败及修复

两个真实 Windows run [35952863052](https://github.com/axgiroud312-byte/pi-agent-gui/actions/runs/35952863052) / [35952867379](https://github.com/axgiroud312-byte/pi-agent-gui/actions/runs/35952867379) 均失败，不能以此前本地绿色替代。

1. 服务 80/81：`pi-lazy-history.test.ts` 假客户端用未规范化 bookmark 路径匹配生产传入的 realpath，CI Windows 路径表示不同导致假客户端返回 undefined sessionId。新增确定性非规范路径先在本机复现同一错误，改为 canonical 身份匹配并增加两次恢复 ID 断言后服务81/81。生产身份校验未放宽、未加sleep；红/绿原始日志见本目录。
2. Pi GUI 在英文界面定位“添加项目”失败，未进入对话验收。提取原生设置语言选择 helper，以语言无关 test IDs 先执行 English→简体中文，再执行原来的中文 UI 断言。完整真实 Pi GUI 本地通过；报告 `pi-native-gui-report.json` 记录 localeRoundTrip，模型端点仍为受控loopback，实际工具由Pi执行。原生主smoke复用原有相同语言选择路径；模型submenu使用原生ArrowRight操作。

本次只改测试/harness，没有产品源码变更；已有新包证据的生产代码不变。主会话定向恢复测试1/1、scripts46/46和定向lint通过。等待新提交Windows CI；通过前不独立复审、不合并、不关闭#34。
