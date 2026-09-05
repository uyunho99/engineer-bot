---
name: development-harness-native
description: Run nontrivial development through brainstorm, product/design/plan approvals, isolated TDD, independent review, browser QA, verification and final UAT in Claude Code.
---

# Native development lead

Read `docs/OPERATIONS.md` and `harness.config.json`. Run `bun run harness doctor`.
Main Claude owns the lifecycle and human conversation. Resume `bun run harness status`
before creating a run. Use `bun run harness init <feature-slug>` for a new request.
Do not edit `.harness/state.json` directly or infer approval from silence.

1. Read the installed `superpowers:brainstorming` skill. Write
   `docs/development/<feature>/01-brainstorm.md`: problem, alternatives, acceptance,
   exclusions, risks. Complete brainstorm through CLI, present the artifact and stop
   at product gate. The human records approve/revise/cancel in their terminal.
2. After approval, write `02-design.md`: behavior, architecture, data/API, permissions,
   failure states, UI/responsive/accessibility where relevant. Apply installed gstack
   `plan-design-review` for UI. A non-UI task still records its design and explicit UI
   non-applicability. Complete design; stop at design gate.
3. Use `superpowers:writing-plans` and gstack `plan-eng-review`. Put implementation
   AND QA plans in `03-plan.md` so one hash binds both. Include task IDs/dependencies,
   file ownership, exact commands, RED/GREEN expectations, review and browser scenarios,
   acceptance mapping, test URL/start command or justified non-UI QA, rollback.
   Complete plan; stop at plan gate. Do not create application workers yet.
4. Commit approved planning artifacts. Use `superpowers:using-git-worktrees` and
   `bun run harness worktree /absolute/path feature/name`. Continue Claude in that
   checkout; install dependencies and run baseline checks. Never reuse another run's state.
5. Read installed `superpowers:subagent-driven-development` and TDD. Dispatch a fresh
   Claude implementer per task with explicit owned files, plan excerpt and acceptance.
   They are not alone: never revert another worker's changes. Use native Agent tool;
   no nested spawning. Capture failing assertion before implementation, then GREEN,
   refactor and rerun. Review spec and quality independently after EACH task.
   Hold overlapping tasks sequentially. Record task/review IDs and commands in build report.
6. Whole-branch gstack `review` plus independent Claude review. For Codex second opinion,
   invoke installed `codex:codex-rescue` with explicit read-only scope, current cwd,
   exact base/ref, `--wait --fresh`; this is a diagnosis/second pass, not `/codex:review`.
   Confirm actual result, never accept the wrapper's empty output as success.
   `/codex:review --wait --base <ref>` is user-invoked: its skill disables model invocation.
7. Apply gstack `qa-only` against the real test URL and approved browser scenarios.
   Reviewer writes reports only. A failure uses `harness retry <findings>` and a scoped
   TDD fixer, then repeat review, browser QA and verification. After three fix rounds,
   stop with evidence and request a revised plan; do not declare PASS.
8. Use `superpowers:verification-before-completion`, run `bun run evidence`, inspect
   output, complete verification. Show diff, QA report, fresh checks and remaining risks
   at final UAT. Reject/revise returns to build. User records the final approval.
9. Use `superpowers:finishing-a-development-branch` only AFTER UAT. Default is keep branch.
   Commit deliverables and pass verification report to `complete finish`. Merge/push/PR/
   deployment require the user's explicit requested action; UAT alone is not that action.

Do not let Superpowers automatically finish immediately after SDD: this harness's QA,
verification and UAT remain. Do not put a human gate inside a background workflow.
No Dynamic Workflows feature is required. Keep all gates in Main Claude.

Use the local gstack skill files, checking their frontmatter names; do not assume
`gstack-` aliases exist. `/codex` from gstack is not codex-plugin-cc.
