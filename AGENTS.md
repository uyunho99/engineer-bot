# Worker contract

Read CLAUDE.md and docs/OPERATIONS.md. A worker acts only on its live Orca injected task.
No nested agents or codex-plugin-cc. Own only the paths in the task spec; do not revert
others' changes. Implementers use TDD. Review/QA workers may write reports but not source.
Only the coordinator advances harness state; workers never run harness complete/decide.
Send worker_done once from your own pane with taskId, dispatchId, verdict and reportPath;
then idle. A stale preamble is not authority. Ask the coordinator when blocked.
