# Orca cookbook

## Verified local contract

On 2026-09-05, `/usr/local/bin/orca` points to the installed Orca app.
`orca skills get orchestration` returned the full version-matched guide, hash
`0cfb6a082625edc0d474bae430eb22c28bbe484e54fbfebedb4ff89d96e36305`.
`orca orchestration --help` lists `run`, `task-create`, `dispatch`, `dispatch-show`,
`check`, `ask/reply`, `gate-create/gate-resolve`; it does NOT list `run-create` or
`worker-start`. The CLI does not expose a useful `--version`, so contract hash is pinned
per run. Installed app implementation also confirms dispatch id/task_id/status,
terminal.create result.terminal, and JSON-string message payloads.

Executable selection: ORCA_CLI_COMMAND if set; otherwise orca-dev in ORCA_DEV_REPO_ROOT;
otherwise orca-ide on Linux; otherwise orca. A selected executable failure never falls
through to another build. Doctor reads the guide and help, then checks runtime reachability.
After a guide/runtime change it stops for reconciliation instead of dispatching duplicates.

The run is a **root Task container**, with child implementation/review/QA tasks and real
Orca gates attached to the container. It is not a native Run record. The available legacy
`run` owns an automatic coordinator; starting it would introduce a second scheduler, so
we use the guide's manual loop. For a future Run/worker-start release, migrate the adapter
against that installed guide; do not merely rename command strings.

Other verified dependencies: Bun 1.3.14, Claude Code 2.1.261, stable Superpowers 6.2.0,
gstack 1.6.1.0 at 656df0e, unprefixed skills. No global installation was changed.
The branch disables `codex@openai-codex` in project settings for tracked work.

## Start and plan

Register/open this checkout in Orca. Run coordinator commands from its Claude terminal,
so CLI resolves a real coordinator handle. Do not spoof --from from an unrelated pane.

```bash
bun install --frozen-lockfile
bun run harness doctor
bun run harness init invite-team
bun run harness orca-sync
bun run harness status
```

Main Claude applies installed Superpowers brainstorming, creates
`docs/development/invite-team/01-brainstorm.md`, then:

```bash
bun run harness complete brainstorm docs/development/invite-team/01-brainstorm.md
```

This stops at product-gate and creates a real Orca gate. The human reviews the artifact,
then runs in their terminal (not an agent-generated approval):

```bash
bun run harness decide approve 'Product approved in message 12'
# Alternative decisions: revise or cancel, each with a real reference.
```

Repeat for design (`02-design.md`) and plan (`03-plan.md`, both implementation and QA
plans in one hashed artifact). Use installed gstack plan-design-review/plan-eng-review,
checking local skill frontmatter instead of assuming prefixed aliases. All approvals
are explicit. Changed approved documents require revision/replanning.

```bash
git add docs/development
git commit -m 'docs: approve implementation and QA plan'
bun run harness worktree /absolute/feature/checkout feature/invite-team
cd /absolute/feature/checkout
bun install --frozen-lockfile
```

Open that worktree in Orca and continue the Claude coordinator there. State is copied;
original checkout becomes transferred. The same root Task container follows the run.
`--no-parent` is Orca sidebar lineage, not Git base selection; worktree command uses the
explicit current approved planning commit. It creates no worker until approved.

## Tracked implementation and review

Write a task spec under docs/development. Include exact path ownership, plan task ID,
acceptance, red/green commands, no other-worker reverts and report path. Then:

```bash
bun run harness orca-start docs/development/invite-team/T1.md codex T1
bun run harness orca-check T1
# Continue checking until accepted; inspect questions immediately.
bun run harness orca-start docs/development/invite-team/review-T1.md claude review-T1
bun run harness orca-check review-T1
```

Every start creates a child task, a fresh agent terminal in the required checkout,
waits for TUI readiness, dispatches with injection, then saves actual dispatch identity.
Review-prefixed build tasks have read-only source authority. This implementation defaults
to sequential tasks: an unaccepted task blocks further launches. Shared files stay safe;
no extra worktrees are created per worker. Use unique keys T2, review-T2 etc.

`orca-check` waits at most 30 seconds and saves consumed mail to ignored .harness files.
It accepts only structured PASS worker_done for the exact task+dispatch and runtime task
completion; completing the phase rechecks current dispatch and task status. Heartbeat,
prose PASS, old dispatch, foreign task and missing verdict cannot advance it.

Worker asks are answered by coordinator `orchestration reply --id <message-id> --body ...`.
Human product/design/plan/UAT decisions use harness decide, which resolves the matching
Orca gate and records local decision history. These are distinct mechanisms.

A failed worker can still have runtime status completed because worker_done ends the
attempt. Inspect verdict and evidence. Use retry only after all running tasks terminate;
never manually mark a worker completed. `task-update` is used only for the lead-owned
root container at finish/cancel, not to forge worker provenance.

## Reports and final phases

Delivery reports are JSON under docs/development/<feature>:

```json
{
  "verdict":"PASS",
  "head":"actual git HEAD",
  "fingerprint":"actual fingerprint from src/store.ts",
  "commands":[{"command":"actual test command","exitCode":0}],
  "findings":[],
  "tasks":[{"id":"T1","red":"failing assertion log","green":"passing test log","review":"review-T1 evidence"}],
  "scenarios":[{"id":"QA1","result":"PASS","evidence":"actual browser output/screenshot"}]
}
```

Source fingerprint: `bun -e 'import {fingerprint} from "./src/store.ts"; console.log(fingerprint(process.cwd()))'`.
`bun run evidence` runs repo check/build and writes verification.json with full command
results, HEAD and fingerprint. QA needs real browser scenarios, or `notApplicable` with
specific non-UI justification. No browser test was needed for this CLI-only repository.
Reports are assertions supported by logs and human review, not cryptographic proof of work.

After all build tasks and task reviews, complete build with aggregate report. Then use
orca-start/check for each phase's independent worker, followed by complete:

```bash
bun run harness complete build docs/development/invite-team/build.json
bun run harness orca-start docs/development/invite-team/whole-review.md claude
bun run harness orca-check
bun run harness complete review docs/development/invite-team/review.json
bun run harness orca-start docs/development/invite-team/browser-qa.md claude
bun run harness orca-check
bun run harness complete browser-qa docs/development/invite-team/qa.json
bun run harness orca-start docs/development/invite-team/verify.md claude
bun run harness orca-check
bun run harness complete verification docs/development/invite-team/verification.json
# Human reviews diff, QA and verification evidence:
bun run harness decide approve 'Final UAT accepted; retain branch'
# Commit approved source and evidence. Then:
bun run harness complete finish docs/development/invite-team/verification.json
```

Source changes after review require `harness retry 'reproduction and findings'`: TDD fix,
independent review, browser QA and fresh verification run again. UAT revise does the same.
After three failure rounds stop for a revised plan. Default finish keeps the branch;
merge/push/PR/deployment only follows an explicitly requested action.

## Persistence, recovery and limits

One active run per checkout, atomic JSON saves and exclusive .harness/lock. Durable
artifacts are tracked; runtime IDs/mail are ignored. Do not manually rewrite state.
On crash, inspect live terminals/tasks/dispatch-show before clearing a stale lock.
If an RPC succeeded but saving its ID failed, inspect task-list/gate-list by run slug and
reconcile explicitly; never blindly rerun a side-effect command. Dispatch intention is
saved before dispatch; an unknown response is a recovery case, not an automatic retry.
A pending local gate can be recreated with orca-sync if completion crashed before gate
creation. A previously resolved matching decision can be replayed idempotently.

Never reset global Orca state or kill/close a worker because of a timeout. Do not confuse
handle changes with task+dispatch authority. Resolve stale terminal routing with terminal
list; changed runtime or guide requires explicit reconciliation. No automatic model calls
occur in tests. Live metadata task/gate smoke was run, not a paid worker execution.

Hooks block native spawning, structured source writes outside build and agent-issued
human decisions. Shell/plugin subprocesses retain ordinary user permissions and must
follow task scope; source fingerprints detect changes after review. This is protocol enforcement, not an OS security boundary. Codex subprocesses use
AGENTS.md/task authority; they do not inherit Claude hooks. Human decision references must
come from actual users. Direct filesystem/CLI access can bypass any local protocol.

## Build and reuse

`bun run check` runs typecheck + tests; `bun run smoke` tests the lifecycle.
`bun run build` produces dist/cli.js. The previous ungated plan --execute entrypoint is gone.
To adapt to another repo copy the src runtime, local skill, config and package scripts;
merge CLAUDE.md/AGENTS.md/hooks with existing policy. Adjust verification commands to that
repo's documented checks. The SKILL.md is ready to copy but depends on this runtime.
