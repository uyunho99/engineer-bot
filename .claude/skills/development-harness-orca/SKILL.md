---
name: development-harness-orca
description: Coordinate development with installed Orca tracked tasks, dispatches and human gates, from brainstorm through TDD, review, browser QA, verification and final UAT.
---

# Orca development lead

Read `docs/OPERATIONS.md`; run `bun run harness doctor`, then read the full guide from
`orca skills get orchestration` using the session executable selection in the cookbook.
Main Claude is the human-facing coordinator. Orca owns all tracked worker provenance.
No native Agent/Task spawning, gstack `/codex`, or codex-plugin-cc for tracked work.
Apply Superpowers content/TDD/review disciplines while replacing their spawning with Orca.

1. Resume `harness status` or `init <slug>`, then `orca-sync` to create a tracked run
   container. Installed legacy Orca uses a root Task container; do not call it a native Run.
2. Brainstorm with the user using installed Superpowers brainstorming. Write
   `docs/development/<slug>/01-brainstorm.md` (problem, options, scope, acceptance).
   Complete brainstorm. Present hashed artifact and pending Orca product gate; stop.
   Human runs `harness decide approve|revise|cancel '<decision reference>'`.
3. After product approval, produce `02-design.md`: architecture, data, permissions,
   UI states, errors, responsiveness and accessibility; apply gstack plan-design-review
   where UI is relevant. Record non-UI design explicitly. Complete design; human gate.
4. Use Superpowers writing-plans + installed gstack plan-eng-review. Write `03-plan.md`
   containing implementation AND QA plans: small task IDs/deps, owned paths, exact tests,
   RED/GREEN expectations, independent review criteria, browser URL/startup/scenarios,
   negative cases, acceptance mapping and rollback. Complete plan; human gate.
5. Commit approved artifacts; use `harness worktree /absolute/path feature/name`.
   Register/discover that checkout in Orca, open a Claude coordinator terminal there,
   install dependencies and baseline-check. Resume copied state; do not create another run.
6. For each plan task prepare a worker spec file with task excerpt, exact cwd, owned paths,
   TDD tests, dependencies and evidence path. Use `orca-start <spec> codex T1` (or claude).
   Wait with `orca-check T1`. Inspect failures/questions; timeouts mean continue waiting.
   Next dispatch `orca-start <review-spec> claude review-T1`; `orca-check review-T1`.
   A `review-` key gets read-only source authority. Review spec compliance AND quality.
   Repeat per task with fresh terminals. No worker spawns another worker.
7. Complete build with aggregate RED/GREEN/task-review evidence, then dispatch independent
   whole-branch gstack review in phase review. Dispatch real gstack qa-only browser tests
   in browser-qa. QA findings go to a scoped TDD fixer, never directly to the reviewer.
   Use retry after confirmed task termination; repeat build/review/QA/verification.
8. Verification worker applies Superpowers verification-before-completion and actual repo
   commands, produces fresh JSON command evidence. Complete verification and show final
   diff, QA matrix and checks to the human. UAT revise returns to build.
9. After UAT approval, apply finishing-a-development-branch; default keep branch. Commit
   artifacts and complete finish. PR/push/merge/deploy needs explicit action authorization.

The lead alone records human gates. Worker `ask` questions use reply, not gate-resolve.
Never fabricate worker_done or manually mark worker tasks completed. Follow the live
preamble, use taskId+dispatchId, and send from the worker's own pane once then idle.
Inspect `dispatch-show` after interruption and runtime identity on resume. No global reset,
no killing a worker for a timeout, no retrying an uncertain dispatch. After three failures,
stop for a revised human decision; do not manufacture a new task to evade the breaker.
