# Claude native cookbook

## Installation and first use

Requirements: Git, Bun, Claude Code, Superpowers, gstack and codex-plugin-cc.
This branch uses project-local Claude skill discovery and hooks; no copying to home required.

```bash
bun install --frozen-lockfile
bun run harness doctor
claude
```

Inside Claude: `/development-harness-native` followed by the feature request, or simply
ask to implement a nontrivial feature. Reload plugins if Claude was already running.

If the Codex plugin is missing, use these verified Claude commands:

```text
/plugin marketplace add openai/codex-plugin-cc
/plugin install codex@openai-codex
/reload-plugins
/codex:setup
```

The local installation was project-scoped using Claude CLI `plugin install --scope project`.
No authentication is performed automatically. `/agents` should show `codex:codex-rescue`.

## State and operator commands

One active run per checkout. `.harness/state.json` is ignored, atomic and protected by an
exclusive mkdir lock. Every transition is recorded with timestamp and evidence hash.
Do not manually modify state. After a crash, inspect processes before removing a stale lock.
For a finished/cancelled run archive `.harness` outside the checkout before starting another.
No reset command discards running work. All artifacts belong in `docs/development/<slug>`.

```bash
bun run harness init invite-team
bun run harness status
# After the lead writes the document:
bun run harness complete brainstorm docs/development/invite-team/01-brainstorm.md
# Human runs this after reviewing it (reference identifies the actual decision):
bun run harness decide approve 'Reviewed product, conversation message 12'
# Or: decide revise 'Change the scope' / decide cancel 'Cancel this feature'
```

Repeat for `design` and `plan`. Plan MUST contain both implementation and QA sections.
The human gate is an operator protocol, not authentication: anyone with filesystem access
could bypass it. The lead must not run `decide` on behalf of unreceived human approval.
Hooks deny structured source writes outside build and agent-issued human decisions.
Shell/plugin subprocesses retain the ordinary user permission policy and must follow
approved task scope. They are not a shell sandbox; source fingerprints detect changes
after review. Human decisions are recorded in the operator terminal.
This is defense in depth, not an OS sandbox. Codex subprocesses do not inherit Claude hooks.
Never use dangerous permission bypass; provide explicit read-only scope for Codex review.

After plan approval, commit planning artifacts and create isolation:

```bash
git add docs/development
git commit -m 'docs: approve feature plan'
bun run harness worktree /absolute/new/checkout feature/invite-team
cd /absolute/new/checkout
bun install --frozen-lockfile
claude
```

The source run becomes `transferred`; resume the copied run in the new worktree.
Existing paths/branches are rejected by Git. Nothing merges or deletes a worktree.

## Delivery evidence

Complete `build`, `review`, `browser-qa`, `verification`, then approve UAT and complete
`finish`. A delivery report is JSON with this shape; produce real evidence, not this sample:

```json
{
  "verdict": "PASS",
  "head": "actual git rev-parse HEAD",
  "fingerprint": "actual source fingerprint from src/store.ts",
  "commands": [{"command": "actual command", "exitCode": 0}],
  "findings": [],
  "tasks": [{"id":"T1", "red":"failing assertion log", "green":"passing log", "review":"independent review reference"}],
  "scenarios": [{"id":"QA1", "url":"actual local test URL", "result":"PASS", "evidence":"screenshot or browser output"}]
}
```

Get fingerprint using `bun -e 'import {fingerprint} from "./src/store.ts"; console.log(fingerprint(process.cwd()))'`.
For a CLI-only change use `notApplicable` with a specific rationale instead of inventing
browser execution. UI tasks must include real browser scenarios. `bun run evidence` runs
repo check/build and writes `verification.json` including stdout, stderr, exit codes,
HEAD and fingerprint. Add project-specific acceptance commands to the evidence report.

```bash
bun run harness complete build docs/development/invite-team/build.json
bun run harness complete review docs/development/invite-team/review.json
bun run harness complete browser-qa docs/development/invite-team/qa.json
bun run evidence
bun run harness complete verification docs/development/invite-team/verification.json
# Human reviews diff, browser evidence and tests, then:
bun run harness decide approve 'UAT accepted in message 42; keep branch'
# Commit all approved code/reports. Finish uses unchanged verified source fingerprint;
# the report HEAD may predate this final evidence-only commit.
bun run harness complete finish docs/development/invite-team/verification.json
```

`retry 'finding with reproduction'` returns to build and clears all later evidence.
Changes to approved planning documents require revise at that gate; if already past it,
stop and archive/replan explicitly. Never silently rewrite approved artifacts.

## Validation and portability

`bun run check` = TypeScript typecheck + tests; `bun run smoke` = lifecycle tests.
`bun run build` bundles the Bun CLI into dist. The previous repo had no build command;
this branch adds one. The unsafe preexisting `plan --execute` route was removed.
Copy `.claude/skills/development-harness-native`, `src`, `harness.config.json`, and the
package scripts into a target repo; merge CLAUDE.md and hook entries, do not overwrite
existing policy. Adjust evidence commands to that repository's own documented checks.
Bun and plugin dependencies remain required; a SKILL.md alone cannot install its runtime.

## Verified dependencies (2026-09-05)

- Claude Code 2.1.261; Bun 1.3.14.
- Installed Superpowers 6.2.0 (also superpowers-dev 6.3.0 present; use stable names).
- gstack 1.6.1.0, commit 656df0e; prefix setting false, so no invented gstack-prefixed aliases.
- codex-plugin-cc 1.0.6, source db52e28f4d9ded852ab3942cea316258ae4ef346.
- Official references: https://github.com/openai/codex-plugin-cc,
  https://code.claude.com/docs/en/skills, https://code.claude.com/docs/en/hooks.

Doctor rechecks local files on each new session. Installed dependency presence is not proof
of login or a successful paid model run. Tests use no model calls.
