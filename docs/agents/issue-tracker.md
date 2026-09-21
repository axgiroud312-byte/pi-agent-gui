# Issue tracker: GitHub

仓库：https://github.com/axgiroud312-byte/pi-agent-gui

规格与任务以 GitHub Issues 为准，使用 `gh` CLI 操作。仓库外操作时显式传入 `--repo axgiroud312-byte/pi-agent-gui`；仓库内通过 `git remote -v` 核对目标。

## Conventions

- 创建：`gh issue create --title "..." --body-file <utf8-markdown>`。PowerShell 下优先通过 UTF-8 文件传递长正文。
- 阅读正文与标签：`gh issue view <number> --json number,title,body,labels,state,url`。
- 阅读评论：`gh issue view <number> --comments`。
- 列表：`gh issue list --state open --json number,title,labels,assignees,url`，按需加 `--label`。
- 评论：`gh issue comment <number> --body-file <utf8-markdown>`。
- 标签：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`。
- 关闭：`gh issue close <number> --comment "验收结果及关联 PR"`。

技能要求“publish to the issue tracker”时，创建 GitHub Issue。要求“fetch the relevant ticket”时，读取 Issue 正文、标签及评论。

`to-spec` 发布规格时应用 `ready-for-agent`。实施任务关联规格，记录验收条件与阻塞依赖；PR 关联对应实施任务。大型规格的下一步为 `to-tickets`。

## Dependencies

优先使用 GitHub 原生阻塞关系。先查询阻塞 Issue 的数值数据库 ID：

`gh api repos/axgiroud312-byte/pi-agent-gui/issues/<blocker-number> --jq .id`

再添加到被阻塞的 Issue：

`gh api --method POST repos/axgiroud312-byte/pi-agent-gui/issues/<child-number>/dependencies/blocked_by -F issue_id=<blocker-database-id>`

API 不可用时，在正文开头使用 `Blocked by: #N, #N`。领取前核实 blocker 的当前状态；`ready-for-agent` 不会覆盖未解除的依赖。

## Pull requests as a triage surface

**PRs as a request surface: no.**

外部 PR 不自动作为需求分流入口。GitHub Issues 与 PR 共用编号空间；遇到歧义先辨别对象类型。
