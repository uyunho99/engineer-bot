# Validation — 2026-09-05

Base: `b64004c` (existing `orca-autonomous-v2`). The original checkout remains unchanged.
Both variants were created as independent Git worktrees from that same commit; no merge.

## Commands

- `bun install --frozen-lockfile`: dependency reproducibility checked after generating lockfile.
- `bun run check`: TypeScript strict typecheck and 11 tests / 46 assertions.
- `bun run smoke`: 5 lifecycle tests, including all four gates and retry breaker.
- `bun run build`: Bun CLI bundle generated successfully in ignored dist/.
- `bun run harness doctor`: installed dependencies checked successfully.
- Skill creator quick validation: SKILL.md frontmatter passed.

Tests cover illegal phase transitions, human decision requirements, artifact changes,
source fingerprinting, worktree isolation, locks and symlink escapes.
The adapter integration test uses a simulated CLI with the installed response shapes;
it checks Task/Dispatch/Gate persistence, completion and unsupported upgrade rejection.
Actual installed app source was inspected for dispatch and terminal result schemas and
JSON-string message payloads. Tests reject stale IDs, prose PASS and unrelated messages.
Live runtime smoke created task `task_adac4e528637` and gate `gate_d8f56511de69`, resolved
the test gate, and completed the coordinator-owned metadata task. No worker was dispatched
for that smoke, and no actual human approval was represented. No global state was reset.

## Limits

This repository has no web UI, so browser execution for the harness change is not applicable.
The delivered workflow requires real browser QA for future UI features. No paid Claude/
Codex worker was launched end-to-end. Hooks and state checks enforce a cooperative local
protocol, not an OS sandbox or authenticated human-identity boundary. External tool
permissions and real evidence review remain necessary. See OPERATIONS.md for exact usage.
