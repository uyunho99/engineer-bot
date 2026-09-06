# Controller-managed repository control (v1)

Workers produce verified changes. Controller owns repository state transitions.

Execution Layer: Claude / Codex / Orca workers. Repository Control Layer: Controller
(Main Claude / coordinator). This policy overrides upstream SDD, writing-plans,
plugin and worker-template instructions that assign commits to implementers.
The native path still delegates implementation to Codex; Orca can use Claude or Codex.
`executor` identifies the implementing engine, never the transport or committer.

## Dispatch and worker contract

Include this instruction in every implementation and review-fix dispatch, including
codex-plugin-cc wrappers, Claude workers and Orca task specs:

> Do not create Git commits. Complete the implementation and verification, then return READY_FOR_COMMIT with the exact changed-file list and a proposed commit message. Repository state transitions are owned by the controller.

Workers must not stage, commit, merge, reset, switch branches, create worktrees, or
otherwise mutate repository metadata. Read-only Git inspection is allowed. They
implement the scoped task, capture a failing assertion before implementation, pass
GREEN and all required typecheck/lint/build checks, and write the report below.
They do not report independent review as their own work. Reviewers only inspect
fixed commits and return PASS/FAIL with findings; they never fix code or commit.

`BLOCKED` means implementation or verification cannot proceed: missing dependency,
credential, conflicting requirements, inaccessible API/service, inability to run
tests, or missing essential information. A failed test must be fixed or honestly
reported; it is not READY_FOR_COMMIT. Inability to write Git metadata is not BLOCKED.
Only verified complete changes can return READY_FOR_COMMIT, even after a Git error.
Controller commit failures are repository-control failures, not worker failures.

Worker reports are JSON on disk (this YAML shows the same data contract):

```yaml
task: T1
executor: codex
status: READY_FOR_COMMIT
implementation:
  status: complete
verification:
  red:
    status: passed
    command: bun test src/foo.test.ts
    evidence: "Before implementation: expected 2, received 1; assertion failed"
  green:
    status: passed
    command: bun test src/foo.test.ts
    tests_passed: 4
  typecheck:
    status: passed
    command: bun run typecheck
changed_files:
  - src/foo.ts
  - src/foo.test.ts
proposed_commit_message: "feat: implement foo"
notes: []
```

RED `passed` means the expected assertion failure was observed, not a green test
or an import/environment error. Add lint/build checks when the task requires them.
For projects without typechecking use a real applicable static validation command
and explain it in notes; never invent successful execution. Include every actual
tracked/untracked addition, modification, deletion and both rename endpoints in
changed_files. Include report/log files if stored in tracked paths. Store transient
reports and Controller-owned exact scope in ignored `.harness/` to avoid self-reference.
The scope JSON is `{"task":"T1","allowed_files":["src/foo.ts","src/foo.test.ts"]}`.
Controller derives it from the approved task before dispatch; workers cannot expand it.

## Controller repository gate and commit

Start a task with a clean index and reconcile unrelated working-tree changes before
handoff. Record base_commit = HEAD; stop workers before repository mutation.
Never run commit concurrently with an active writer.

1. Read the runtime result and test evidence. Confirm requirements, required checks,
   report correctness, and expected files from the approved plan.
2. Run `harness repository-gate <worker-report.json> <scope.json>` (using the installed
   native launcher or `bun run harness` in Orca). It requires the approved build
   worktree, checks `git status --short`, `git diff --check HEAD`, `git diff --binary HEAD`,
   untracked file hashes, exact report files, and Controller-owned scope. Inspect
   the returned diff AND contents of untracked files before using its token.
3. Unexpected files, unrelated config or unexpected scripts must stop automatic
   commit. `.env*`, credential/key files, symlinks and submodules are rejected by
   the helper for separate explicit Controller review. Do not silently expand scope.
4. After reviewing the concrete gate result, run `harness repository-commit <token>`.
   It rechecks HEAD, scope, report, contents and index, stages literal verified paths
   with `git add -- <files...>`, checks staged scope/whitespace and commits. It never
   defaults to `git add -A`. Deletions/renames use exact endpoints. Any exceptional
   whole-tree staging needs the same diff/scope review first.
5. Keep the emitted ledger entry. `.harness/repository-ledger.json` is local recovery
   state; copy entries into the tracked build report for durable review history.
   Preserve implementation and review-fix commits. If hooks/commit/ledger writing fail,
   inspect HEAD, index and log before retrying. Do not create duplicate commits,
   reset others' changes or label the verified worker BLOCKED. Reconcile a successful
   commit with missing ledger manually from the gate/report and actual Git history.

```yaml
executor: codex
committer: controller
repository_control:
  mode: controller_managed
base_commit: <full parent SHA>
commit:
  sha: <full task commit SHA>
  message: "feat: implement foo"
# Optional explanatory metadata; never an exception to the default policy:
commit_reason:
  type: controller_managed
  reason: linked_worktree_git_metadata_sandbox
```

These CLI checks support the Controller; they are not an OS authorization boundary.
Shell hooks and worker tools must obey the role contract. The gate cannot infer
whether a test log is honest or an allowed source file contains a secret: Controller
reviews the actual evidence and diff. Planning/final evidence commits are also owned
by Controller and use the same manual scope/diff/staging policy outside build phase.
Commit authority does not grant push, PR, merge or deployment authority.

## Immutable review lifecycle

Controller dispatch → Worker implementation → RED/GREEN/verification → READY_FOR_COMMIT
→ Controller repository gate → Controller commit → Independent reviewer → PASS → next task.

Pass full `base_commit` and `task_commit` SHAs to reviewers. Review
`git diff <base_commit>..<task_commit>`, not the uncommitted working tree. If execution
is needed, use a clean detached checkout of task_commit. Review completion contains
`review_commit`, `review_verdict: PASS|FAIL` and a review evidence path. Build tasks
retain `id`, `executor`, native `dispatch`, `red`, `green`, `review` and add the ledger's
`committer`, `repository_control`, `base_commit`, `commit`, plus `review_commit` and
`review_verdict`. `complete build` validates each task against its latest Controller
ledger entry and committed ancestry; legacy reports must be reconciled, not assigned
fabricated SHAs. The aggregate phase report still has `verdict: PASS`; READY_FOR_COMMIT
belongs to the implementation worker report, not overall build completion.

Reviewer FAIL → Worker fix → READY_FOR_COMMIT → Controller validation → review-fix
commit → Reviewer re-check. Reuse the implementation task ID in the ledger; Orca
transport keys must remain unique, e.g. T1-fix-1 and review-T1-fix-1. Re-check the
cumulative original base..latest task commit for unresolved findings, record the
latest SHA in review_commit, and retain earlier entries as history. Do not proceed
to the next task before PASS. Final merge may squash these commits if separately
authorized; retain the task ledger and review evidence, and reverify the final tree.

Orca's worker_done transport verdict remains PASS/FAIL for runtime compatibility.
Implementation PASS means the referenced report is READY_FOR_COMMIT, not that the
repository is committed or reviewed. Report taskId, dispatchId and reportPath once
from the assigned pane. Controller checks the report through repository-gate before
review dispatch. Review/QA workers return their own PASS/FAIL reports.

## Linked worktrees

A linked worktree's `.git` may be a file pointing to a gitdir rather than a directory.
Actual metadata can live in the main repository's `.git/worktrees/...`. A sandboxed
worker may be unable to write protected metadata such as index.lock. Repository
mutation therefore does not depend on worker capability, sandbox flags or executor:
Controller owns Git state transitions as the normal architecture, not a Codex workaround.

Both branches carry this identical policy and `src/repository-control.ts`. They remain
independently deployable; keep these shared files byte-identical when updating either
branch. Native global installation bundles this policy with the Skill and operations.
