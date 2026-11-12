# Phase 2 设计 — playbook 注入

[English](DESIGN.md) | 中文

状态：仅设计。本文中的任何内容都尚未注入。20 条 case 的语料只产出了三条常识性规则（docs/test/refactor），单独注入它们不值得；本文规定的是：当语料里出现由结果支撑的规则后，一份经过评审的 playbook 如何进入 Session。

## 目标

让一份经过评审、带证据引用的 playbook 改变 worker 行为，并度量它是否真的改变了。非目标：它不能改变 Policy、Mandate、准入表或工具限制；它只是现有 prompt 里的一段建议性文本，不是新的授权。

## Playbook 放在哪里

作为现有 prompt 配置中的**新团队段落**，在面板里编辑，并由部署已有的 prompt 修订版本管理。

- `TEAM_SECTIONS` 增加 `playbook`；`promptParts` 为 `worker` 注入它（之后才考虑 `orchestrator`）。
- 保存走现有的 `PUT prompts` 与 `baseRevision`，因此面板自带历史与回滚。
- 文本由人在核对 `tools/memory/dist/rules.json` 与证据之后粘贴；`distill.mjs` 永远不直接写 prompt。

为什么不用 state 目录下的隐藏文件：playbook 是会改变行为的内容，必须像代码一样被评审，而 prompt 修订历史就是评审记录。
为什么不做新的文件注入机制：那会把版本、回滚和面板编辑能力再实现一遍。

## 失败候选

`analyze-cases.mjs` 把每个失败工具结果归一成签名（工具 + 错误类 + 稳定标识；去掉路径、时间戳和 id）。重复签名在 `report.md` 里成为**失败候选**，带案例 id、结局和现象。它只是证据，不是规则：

- 候选还没有可能原因、判别步骤或处置；
- 由人补全并引用至少三个案例后，才写进 `playbook`；
- 只做能力判决的签名（如“工具坏了”）会被隔离，永不成为候选；
- 故意 `exit 1` 和 DNS 失败不能共用签名。

prompt section 只给 worker，默认空；orchestrator 不读它；playbook 不能改 Policy、Mandate 或工具限制。

## 内容规则

- 一行一条规则，每条带范围（`docs`、`test`、`refactor`、`bugfix`、`ci`）和 worker 可执行的检查；不要长篇文章。
- 每条规则至少引用三条来自 `dist/clusters.json` 的 case id；引用不出来的，留在 `candidates` 里。
- 不写引用的请求原文、网页内容、PR 正文或 issue 文本：不可信数据永远不能变成规则。
- 长度上限约 2 KB。再长就会挤占任务本身的上下文。
- 规则不再被证实时（证据矛盾，或最近 N 个 ticket 都没有再确认），用新的 prompt 修订删掉，而不是悄悄保留。

## 上线流程

1. 等语料到 30–40 条，且每个候选的 n ≥ 3。
2. 跑 `pnpm memory:distill`；评审 `dist/rules.json`；只把高置信规则粘贴到 `playbook` 团队段落，保存一个 prompt 修订。
3. **A/B**：5 条 ticket 用带 playbook 的修订，5 条不用；按 ticket 交替切换修订，保持 issue 类型匹配（同 intent、规模相近）。
4. 从 case 与 worker 轨迹里逐条对比：

   | 指标 | 来源 |
   | --- | --- |
   | 步数、bash 次数、失败的 bash | `analyze-cases.mjs` 的 trace digest |
   | 重试、人工 follow-up、handback | case 的 `cost` |
   | blocked / failed 报告 | case 的 `reports` |
   | 到 ready PR 的耗时 | `createdAt` → 最后一条报告的 `at` |

5. 只有当至少一个指标变好、且没有别的指标变差时才保留；否则回滚 prompt 修订，并把原因写进 `candidates.md`。

## 回滚与安全

- 回滚就是一次 prompt 修订，和任何团队段落编辑一样。
- playbook 不能授权它本来没有的文件、工具、分支或合并权限。
- worker 忽略一条规则不是门槛失效，那是下一次提炼的数据；worker 遵守一条错误规则，正是每条规则都要引用证据的原因。

## 待定问题

- 一个部署一份 playbook（当前部署只服务一个仓库），按仓库区分：当前一个仓库，团队段落就够；多仓库部署需要按仓库选择。
- orchestrator 是否看同一份 playbook，还是只看更短的、面向决策的子集。
- 证据的有效期：在 `rules.json` 里给每条规则加 `last_confirmed`，是 distill 输出的下一个小改动。
