# engineer-bot — claude-only

Independent Claude Code native development harness using installed Superpowers, gstack
and codex-plugin-cc. Main Claude owns four human gates and fresh implementation/review agents.

```text
brainstorm → product gate → design → design gate → implementation + QA plan
→ plan gate → worktree → TDD → review → browser QA → verification → final UAT → finish
```

```bash
bun install --frozen-lockfile
bun run check
bun run smoke
bun run build
bun run harness doctor
claude
```

Ask Claude to implement a feature or invoke `/development-harness-native`.
[Cookbook](docs/OPERATIONS.md) contains setup, operator commands, state, evidence,
recovery and portability. [Skill](.claude/skills/development-harness-native/SKILL.md)
is the complete agent entrypoint. Default finish retains the branch; no automatic merge.
