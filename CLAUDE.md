# engineer-bot — Orca orchestration

Use `.claude/skills/development-harness-orca/SKILL.md` for nontrivial software work.
Main Claude owns the human conversation, planning artifacts and gates. All implementation,
fixing, independent reviews and QA run as tracked Orca worker dispatches. Claude and Codex
workers use installed Superpowers/gstack disciplines; no nested native agents and no
codex-plugin-cc for tracked work. Reviewers have read-only application authority.
Read the installed Orca guide every session; do not assume run-create/worker-start exist.
Use `docs/OPERATIONS.md` for durable state, four required gates and recovery. Never bypass
those gates, fabricate approval, infer PASS from prose or overwrite unrelated work.
