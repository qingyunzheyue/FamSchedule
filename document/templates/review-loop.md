# Review-Loop 模板 — dev → commit → review → fix → re-review

> 这个模板用于 Mavis 编排任意 dev 任务（T-USXXX-X / T-FIX-XX / T-SETUP-X）的循环：
> **写代码 → commit + push → review → (如有问题) 修 → 再 commit → 再 review → 直到 PASS**。
>
> 适用于 frontend-dev + code-reviewer，或 backend-dev + backend-reviewer。

---

## 📋 什么时候用

满足以下任一：

- 任务有明确 DoD（≥ 4 个验收点）
- 任务会改 ≥ 3 个文件
- 任务涉及 API/数据契约、新模块、安全路径、性能路径
- Sprint 内首次出现的功能模块

## 🚫 什么时候不用

- 纯 hygiene（注释修正、变量重命名）
- 单一文件小修（< 50 行 LOC 变化）
- 已有 review 通过的 hotfix

---

## 🧭 工作流概览

```
[Round N=1]
  ① dev_kickoff prompt    → frontend-dev / backend-dev 写代码
  ② verify (tsc + jest)   → Mavis 本地跑,确认 0 error + 全 pass
  ③ commit + push          → Mavis 本地跑 git commit + push
  ④ review_kickoff prompt  → code-reviewer / backend-reviewer 评审
  ⑤ check verdict          → PASS or NEEDS FIXES or BLOCKED
                              ↓ if NEEDS FIXES
[Round N+1]
  ⑥ fix_kickoff prompt     → dev agent 修问题
  ②-⑤ 重复
                              ↓ if PASS
[结束]
  ⑦ 最终 commit 已在 main,输出总结给用户
```

---

## 📝 模板 1 — dev_kickoff prompt

> 占位符：
> - `{TASK_ID}` — 任务 ID,例如 T-US013-1
> - `{TASK_TITLE}` — 任务标题
> - `{AGENT_NAME}` — frontend-dev 或 backend-dev
> - `{MODULE_PATH}` — 受影响的模块路径
> - `{WORKSPACE_ROOT}` — 工作区根
> - `{FRONTEND_ROOT}` 或 `{BACKEND_ROOT}` — 子项目路径(可选)

```
You are now being invoked to do **{TASK_ID}** — {TASK_TITLE}.

## Task: {TASK_ID} — {TASK_TITLE}

**Task definition** (from `document/tech-decision/task-breakdown-v*.md`):
[粘贴 DoD 全文]

**Module**: {MODULE_PATH}

## Context (source of truth)

[粘贴相关 PRD 章节 / ADR / arch / design 引用]

**Existing workspace state** (don't touch):
- `document/`、`supabase/`、`scripts/`、root `.env`

**Project paths**:
- Workspace: `{WORKSPACE_ROOT}`
- Frontend: `{FRONTEND_ROOT}` 或 Backend: `{BACKEND_ROOT}`

## Your workflow

### Step 1 — Read context (parallel reads)
[列出要读的文件]

### Step 2 — Plan the file structure
[列出要创建/修改的文件]

### Step 3..N — Apply changes
[分步骤详细描述每个改动,带代码片段示意]

### Step N+1 — Verify
[具体命令:tsc / jest / curl]

### Step N+2 — Update task-breakdown
- {TASK_ID}: ⚪ Not Started → ✅ Done
- Add ChangeLog entry
- Update §1.2 rollup

### Step N+3 — Handoff
Report: file diffs, test count, tsc clean, observations

## Constraints
- STRICT scope
- Use Chinese for output, English for code
- Do NOT echo secrets
- Don't break existing tests

## Output discipline
2-3 turns max,emit status at each boundary.

Continue in Chinese.
```

---

## 📝 模板 2 — review_kickoff prompt

> 占位符：
> - `{COMMIT_HASH}` — 当前要评审的 commit hash
> - `{PARENT_HASH}` — 比较基线(上一次 PASS 的 commit)
> - `{AGENT_NAME}` — code-reviewer 或 backend-reviewer
> - `{TASK_ID}` — 任务 ID
> - `{TASK_TITLE}` — 任务标题

```
You are now being invoked to do a **code review** of {TASK_ID} — {TASK_TITLE}.

## Review scope (ONLY this commit range)

**Commit hash**: {COMMIT_HASH}
**Parent hash**: {PARENT_HASH} (last PASS commit, for diff baseline)
**Commit message**: "[commit msg]"

**Files changed**:
[粘贴 `git diff --stat` 输出]

## Context (source of truth)

[粘贴相关 PRD 章节 / ADR / arch 引用]

**Task definition** (from `document/tech-decision/task-breakdown-v*.md`):
[粘贴 DoD]

## Your workflow

### Step 1 — Read the actual diff
`git -C "{WORKSPACE_ROOT}" show {COMMIT_HASH}`
`git -C "{WORKSPACE_ROOT}" diff {PARENT_HASH} {COMMIT_HASH} --stat`

Read in full:
[列出受影响的文件]

### Step 2 — Run automated checks
[tsc + jest]

### Step 3 — Manual review (5 lenses per your system prompt)
- Correctness / Security / Performance / Accessibility / Maintainability / Cross-stack reuse
- Architecture alignment to ADRs

### Step 4 — Special focus areas
[针对当前任务的具体 hint,例如:
- SyncManager: subscription leak / queue replay
- NotificationScheduler: permission timing / Android quirks
- AuthService: auto-reconnect race conditions
]

### Step 5 — Compose review report
标准格式:verdict / automated / issues by severity / alignment / cross-stack / good

## Constraints

- DO NOT modify code — report only
- Use Chinese for output
- Do NOT echo secrets
- Focus ONLY on this commit range
- Be specific with file:line references

Continue in Chinese.
```

---

## 📝 模板 3 — fix_kickoff prompt

> 占位符：
> - `{TASK_ID}` — 任务 ID
> - `{REVIEWER_NAME}` — code-reviewer / backend-reviewer
> - `{REVIEW_OUTPUT}` — 上轮 review 完整输出
> - `{AGENT_NAME}` — frontend-dev / backend-dev

```
You are now being invoked to do a **fix pass** on {TASK_ID}, addressing the code reviewer's issues.

## Review verdict: {PASS or NEEDS FIXES}

[粘贴上一轮 reviewer 输出,完整]

## Issues to fix

[列具体 Major / Minor 修复项,从 review 输出里抄]

### 🔴→🟡 Major #N: ...
- **Location**: file:line
- **Problem**: ...
- **Fix**: ...

### 🟢 Minor #N: ...
...

## Skip these Minors for now (won't block)
[列 defer 的 Minor]

## Context

**Last commit**: {COMMIT_HASH_PREV}
**Last review**: {REVIEW_OUTPUT_TRUNCATED}

**Files affected**:
[列]

**Current test count**: {N} tests passing

**Goal**: {N} → {N+M} tests,all Majors cleaned

## Your workflow

### Step 1 — Read current state
[列出]

### Step 2 — Apply fixes

[每个 fix 一个子步骤]

### Step 3 — Verify
[tsc + jest]

### Step 4 — Update task-breakdown
- Add ChangeLog entry `{TASK_ID}-rev{N}`

### Step 5 — Handoff
Report: LOC delta, test count, tsc clean, summary of removals

## Constraints
- STRICT scope
- Use Chinese for output
- Don't break existing tests
- Preserve all previously passing tests

## Output discipline
2-3 turns max.

Continue in Chinese.
```

---

## 🔧 编排脚本(待实现)

`scripts/review-loop.ps1` 计划封装：

```powershell
review-loop `
  -TaskId "T-US013-1" `
  -DevAgent "frontend-dev" `
  -ReviewerAgent "code-reviewer" `
  -TaskBriefPath "document/tech-decision/task-breakdown-v*.md"
```

内部：
- 解析 DoD + context 段落
- 套模板 1 调 dev agent
- 等结果 + 跑 `npx tsc --noEmit` + `npx jest --silent`
- commit + push
- 套模板 2 调 reviewer
- 等 verdict
- if NEEDS FIXES: 套模板 3 调 dev → 重复
- if PASS: 输出 summary 退出

**目前状态**：模板已就位，脚本待写。

---

## 📌 Mavis 实际使用模板的时机

| 你说的话 | Mavis 行为 |
|---|---|
| `跑 T-US013-2 review-loop` | 套模板 1 调 dev → 等 → 验证 → commit → 套模板 2 调 reviewer → 等 verdict |
| `修 T-US013-2 review issues` | 套模板 3 调 dev → 等 → 验证 → commit → 套模板 2 调 reviewer (round 2)|
| `直接调 frontend-dev T-USXXX-X` | 跳过 review 循环,直接 dev(你已 review 过或小改动) |

---

## ✅ 验证清单(每次循环结束)

- [ ] tsc --noEmit 0 error
- [ ] jest --silent 全 pass(N → N+M 无回归)
- [ ] git push 成功
- [ ] Reviewer verdict PASS
- [ ] task-breakdown ChangeLog 有 round N 行
- [ ] §1.2 rollup 数字对齐

---

## ⚠️ 已知限制

- Mavis 没有原生 workflow DSL,agent 不能调 agent —— 必须 Mavis 编排
- 每次 reviewer 评审范围只覆盖"上一 PASS commit → 当前 commit"的 diff,不重审已 PASS 的代码
- Major issue 是 fix 但 phase,Mavis 决定 review 频率(N+1 通常 PASS,偶尔 round 3)
- 如果 review verdict = BLOCKED(非 NEEDS FIXES),Mavis 升级到用户决策,不自动 fix