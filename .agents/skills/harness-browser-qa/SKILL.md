---
name: harness-browser-qa
description: Execute an approved engineer-bot QA plan in a real browser as a fresh Codex QA worker. Use for independent browser acceptance and regression testing; report findings without changing product code.
---

# Independent browser QA

Receive the approved QA_PLAN, exact worktree, tested commit, URL/server command, accounts/fixtures,
report destination and actual dispatch identity from the Controller. Start a fresh Codex session and
browser context; never continue the implementing session. Do not inherit its claimed verdict.

Use tools actually available in this worker: Playwright MCP is the preferred CLI/Orca backend;
connected Browser/Computer Use, Chrome DevTools MCP or a working Playwright runtime are alternatives.
A desktop tool is not automatically available to a CLI subprocess. Check the installed tool's own
instructions and current tool schemas before using it; parameter names can differ by version.
If a snapshot is returned as a file link, read that artifact before selecting a target. Save screenshots
using explicit absolute paths inside the assigned QA directory and verify the returned path exists;
do not assume a relative filename is resolved against the server output directory.
Prefer a visible browser window when supported; record why if headless.

1. Confirm the worktree HEAD matches the requested immutable commit and product code is unchanged.
2. In your own environment, check/start the approved local server, open the target URL, inspect the
   rendered state, exercise a harmless UI interaction and save a screenshot. Record tool, session,
   URL, timing and evidence in `qa/preflight.md`. Failed access/auth/browser launch means BLOCKED.
3. Read every active QA-E2E/NEG/EDGE/REG ID in the approved plan. Withdrawn IDs have `[withdrawn]`
   on the ID line. Reset test data/session between cases as required by Given. Inspect live DOM or
   screenshot before choosing targets. Wait for observable readiness rather than arbitrary sleeps;
   persistent connections need not reach networkidle.
4. Execute When and check each observable Then. Record URL, expected, actual, screenshots and relevant
   console/network output. Use approved read-only API/data inspection for assertions beyond the UI.
   Screenshots alone do not prove functional correctness. Never soften an assertion to obtain PASS.
5. Return one result per active ID: PASS, FAIL, BLOCKED or NOT_RUN. Missing tools never mean PASS.
   Inspect saved screenshots for the relevant states, including requested mobile layouts. Preserve
   failed attempts and report reproduction steps. Close only sessions/servers you created.
6. Verify product files and HEAD remain unchanged. Write evidence and temporary QA scripts only under
   the assigned `docs/development/<feature>/qa/` directory. Do not stage, commit, fix product code or
   run harness complete/decide. Return findings to the Controller for implementation fixes.

The JSON report includes the existing verdict, head, fingerprint, findings plus:
- executor: codex; role: browser-qa; freshSession: true; dispatch: actual runtime session ID/log.
- browser: {tool, session, preflight: PASS, evidence: repository-relative preflight report path}.
- scenarios: [{id, url, result, expected, actual, evidence: repository-relative scenario report path}].
Evidence paths must exist under docs/development. Overall verdict is PASS only when all approved
scenarios passed with actual evidence. Controller compares the dispatch with implementation dispatches.
For a plan explicitly approved as non-ui, return the exact approved nonUiReason as notApplicable,
no claimed browser scenarios, and preserve executor/role/dispatch metadata. Do not invent an exemption.

For Orca, also follow the live injected completion contract with real taskId/dispatchId. Otherwise
return through the actual Codex runtime. Runtime delivery success and QA acceptance are different.
