# engineer-bot — orca-orchestration

Independent supervised development harness using installed Orca, Claude/Codex workers,
Superpowers and gstack. Product, design, combined implementation/QA plan and UAT gates
are mandatory. No codex-plugin-cc for tracked work.

```bash
bun install --frozen-lockfile
bun run check
bun run smoke
bun run build
bun run harness doctor
```

Open this checkout in Orca and start Claude; invoke `/development-harness-orca` or ask
for a feature. [Cookbook](docs/OPERATIONS.md) includes the full operator flow and recovery.

**Installed-contract distinction:** this Orca exposes `run`, `task-create`, `dispatch`,
`check`, and gate commands, but no `run-create` or `worker-start`. The harness uses the
supported manual dispatch loop and a root Task as its tracked run container. It deliberately
does not invoke the legacy autonomous `run` scheduler, which could bypass human gates.
An upgraded command surface fails closed until the adapter is reviewed. These are separate
branches from the same base; neither is merged into the other.
