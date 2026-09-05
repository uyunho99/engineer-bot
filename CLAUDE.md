# engineer-bot — Claude native

For nontrivial software requests use `.claude/skills/development-harness-native/SKILL.md`.
Main Claude coordinates native subagents. Product, design, combined implementation/QA
plan, and final UAT gates are mandatory. Read `docs/OPERATIONS.md` for commands.
No application edits before plan approval and isolated worktree. Reviewers only write
reports. Do not bypass hooks or fabricate human decisions, command evidence or reviews.
An explicit user instruction can adjust scope; record that decision rather than silently
skipping gates. This branch has no Orca scheduler. Never finish directly from SDD.
