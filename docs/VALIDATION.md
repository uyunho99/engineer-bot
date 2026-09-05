# Validation — 2026-09-05

Base: `b64004c` (existing `orca-autonomous-v2`). The original checkout remains unchanged.
Both variants were created as independent Git worktrees from that same commit; no merge.

## Commands

- `bun install --frozen-lockfile`: dependency reproducibility checked after generating lockfile.
- `bun run check`: TypeScript strict typecheck and 8 tests / 53 assertions.
- `bun run smoke`: 5 lifecycle tests, including all four gates and retry breaker.
- `bun run build`: Bun CLI bundle generated successfully in ignored dist/.
- `bun run harness doctor`: installed dependencies checked successfully.
- Skill creator quick validation: SKILL.md frontmatter passed.

Tests cover illegal phase transitions, human decision requirements, artifact changes,
source fingerprinting, worktree isolation, locks and symlink escapes.
The CLI integration test exercises planning → approvals → worktree → build → review →
QA → verification → UAT → finish with explicit test fixtures, and rejects the old
ungated execute path. This is a deterministic harness test, not a model-developed feature.
Project-scoped codex-plugin-cc installation succeeded; no model call or login was performed.

## Limits

This repository has no web UI, so browser execution for the harness change is not applicable.
The delivered workflow requires real browser QA for future UI features. No paid Claude/
Codex worker was launched end-to-end. Hooks and state checks enforce a cooperative local
protocol, not an OS sandbox or authenticated human-identity boundary. External tool
permissions and real evidence review remain necessary. See OPERATIONS.md for exact usage.
