---
name: qa-planning
description: Produce a QA_PLAN.md containing acceptance criteria, critical user journeys, Given/When/Then E2E scenarios, negative and edge cases, and regression scope — derived from a PRD, design spec, implementation plan, or the codebase itself. Make sure to use this skill whenever the user asks for a QA plan, test plan, test cases, QA scenarios, E2E scenarios, acceptance criteria, regression scope, "what should we test", or asks you to plan testing before writing any test code — even if they don't say "QA plan" explicitly. Also use it when a feature branch is functionally complete and about to be verified, or before handing work to a browser-testing or Playwright test-generation skill. This skill plans tests; it does NOT write or run test code.
---

# QA Planning

Turn a spec into a single reviewable QA plan that both humans and downstream test-generation agents can consume.

## Engineer-bot integration

When invoked by an engineer-bot harness, use `docs/development/<feature>/QA_PLAN-<feature>.md`.
Run after `writing-plans`, then let `plan-eng-review` inspect implementation and QA feasibility together.
The Controller submits both documents in `plan-bundle.json` to the existing plan gate; that single approval
also authorizes downstream QA execution. Do not add a second handoff confirmation after this approval.
Keep the two skills separate. For an approved web surface, every active scenario ID is executed by a fresh
Codex browser-QA worker under the harness browser QA contract. Use `[withdrawn]` on the ID line itself.
For non-UI work, retain API/CLI test scenarios and record the non-UI reason in the plan bundle.

## Scope boundary — read this first

This skill produces **one document**. It does not:

- write Playwright/Cypress/Vitest code → that is a test-generation step (`pw-coverage-planner`, `playwright-e2e-builder`, or hand-authored specs)
- drive a browser → that is `webapp-testing` or gstack `/qa`
- fix failing tests → that is `systematic-debugging` + `test-driven-development`

If the user asks for the plan *and* the code, produce the plan first, show it, and get confirmation on scenario coverage before generating any code. Coverage disagreements are cheap to fix in a document and expensive to fix in a test suite.

## Output contract

Write to `docs/qa/QA_PLAN.md` unless the repo already has a QA docs convention — check for `docs/qa/`, `docs/testing/`, or existing `QA_PLAN*.md` files first and follow what's there.

For a feature-scoped plan (the common case), use `docs/qa/QA_PLAN-<feature-slug>.md`. Only write the bare `QA_PLAN.md` when the plan covers the whole product.

Use `assets/QA_PLAN.template.md` as the skeleton. Ten sections, in this order:

1. **Scope** — what's in, what's explicitly out, and what version/branch this plan describes
2. **Acceptance Criteria** — the conditions under which the feature is considered done, traceable to the spec
3. **Critical User Journeys** — end-to-end paths a real user takes, ranked by business impact
4. **E2E Scenarios** — Given/When/Then, one per journey variant (format below)
5. **Negative Scenarios** — expected failures, and what the correct failure behavior is
6. **Edge Cases** — see `references/edge-case-catalog.md`
7. **Regression Scope** — existing behavior this change could break
8. **Test Data / Preconditions** — accounts, fixtures, feature flags, seeded state
9. **Priority** — P0/P1/P2 assignment with the rule used
10. **Expected Result** — how a human or agent decides pass/fail

Write the document in the language the spec is written in. If the PRD is Korean, write Korean prose; keep scenario IDs, field labels (`Given`/`When`/`Then`), and code identifiers in English either way so downstream agents parse them reliably.

## Scenario format

Every scenario is a numbered block. This exact shape matters — browser agents and test generators key off it.

```
QA-E2E-001
Priority: P0
Type: Acceptance / E2E
Given: 신규 사용자이며 로그인하지 않은 상태
When: Google 로그인을 완료한다
Then:
  - 계정이 생성된다
  - /dashboard로 이동한다
  - 세션이 생성된다
  - 새로고침 후에도 로그인 상태가 유지된다
```

ID prefixes: `QA-E2E-` for end-to-end, `QA-NEG-` for negative, `QA-EDGE-` for edge cases, `QA-REG-` for regression. Number within each prefix, zero-padded to three digits. Never renumber an existing ID when revising a plan — IDs get referenced from commit messages, test names, and bug reports. Append new ones and mark removed ones `[withdrawn]` with a one-line reason.

Rules for `Then` assertions:

- Each bullet must be **observable** — a URL, a visible string, a DOM state, a network response, a database row, a log line. "로그인이 잘 된다" is not an assertion; "`/dashboard`로 리다이렉트된다" is.
- One bullet, one fact. Don't compound with "and".
- No screenshot eyeballing as the sole criterion. Visual checks are fine as an *additional* bullet, never the only one.
- If you can't write an observable assertion for something the spec promises, say so in the plan under Expected Result rather than inventing a vague one. That gap is a finding.

## Workflow

### 1. Gather inputs

Ask for whatever is missing, but check the repo first — don't ask for what you can read:

- **Spec** — PRD, design doc, issue, or implementation plan. Required. If none exists, ask whether to derive intent from the diff/codebase and flag the plan as inferred.
- **Surface** — web, API, mobile, or a mix. Determines which edge-case families apply.
- **Diff scope** — branch, PR, or "whole feature". Drives Regression Scope.
- **Auth model** — whether journeys need a logged-in state, and which roles exist.

For a codebase-derived plan, read routes/handlers, form components, and existing tests. Existing tests tell you what's already covered — don't re-plan it, reference it.

### 2. Derive journeys before scenarios

List the critical user journeys first, then expand each into scenarios. Going straight to scenarios produces a flat pile of clicks with no priority signal.

Rank journeys by blast radius, in this order:

1. Auth and access control — anything where the failure mode is unauthorized access
2. Money — payment, billing, checkout, quota
3. Data loss or corruption — writes, deletes, migrations, imports
4. Core value path — the thing the product exists to do
5. Everything else

P0 is journeys in tiers 1–3 plus the primary happy path of tier 4. P1 is the rest of tier 4 and high-likelihood negatives. P2 is cosmetic and rare-path.

### 3. Expand each journey into a case matrix

For each journey, walk these five axes and write a scenario wherever the axis produces distinct expected behavior. Skip an axis explicitly rather than silently:

- **Happy path** — the intended flow, one scenario
- **Boundary values** — empty, one, max, max+1, and the type boundaries for each input
- **Role and permission** — each role that can reach this surface, including anonymous
- **Failure injection** — network offline, upstream timeout, 500 from a dependency, partial write
- **Concurrency and repetition** — double submit, two tabs, stale session, replayed request

### 4. Edge cases

Read `references/edge-case-catalog.md` and work its families against the feature. Generic planning tends to stop at "wrong password"; the catalog exists to push past that.

If `deliver-edge-cases` is installed, hand it the journey list and merge its output into section 6 rather than duplicating the work. Attribute merged cases so the user knows what came from where.

### 5. Regression scope

Determine what else touches the code paths this change modifies. Concretely: grep for callers of changed functions, check shared components, check shared database tables, check anything reading a config value this change writes. List each as a `QA-REG-` scenario with the specific existing behavior to re-verify.

An empty Regression Scope is almost always wrong. If you genuinely find nothing, state what you searched.

### 6. Coverage self-check before presenting

Verify against the plan itself, and report the results to the user:

- Every acceptance criterion in section 2 maps to at least one scenario ID. List any orphans.
- Every scenario has a priority and at least one observable `Then` bullet.
- Every P0 journey has both a happy-path and a failure scenario.
- No scenario duplicates an existing test in the repo without saying so.

Report gaps rather than padding the plan to look complete. A plan that says "OAuth provider timeout behavior is unspecified — needs a product decision" is more useful than one that guesses.

### 7. Hand off

State what the next step is:

- If `pw-coverage-planner` is available → hand it the E2E scenarios for a Playwright coverage plan
- If `playwright-e2e-builder` is available → for building or extending the suite itself
- Otherwise → `webapp-testing` (anthropics/skills) drives the browser directly against the scenarios
- For an exploratory pre-merge pass instead of a suite → gstack `/qa-only`

Outside an engineer-bot run, do not start the handoff without confirmation. The plan is a review artifact; the user reads it first.

## Anti-patterns

- **Restating the spec as test cases.** "사용자는 로그인할 수 있다" copied from the PRD is an acceptance criterion, not a scenario. The scenario is the specific path plus its assertions.
- **Unbounded scenario counts.** Forty P0 scenarios means nothing is P0. If the matrix explodes, group by equivalence class and test one representative per class.
- **Planning the implementation.** No selectors, no `data-testid` values, no page-object structure. That's the test-generation step's job and it will read the actual DOM.
- **Silently inferring product decisions.** If the spec doesn't say what happens when the OAuth popup is closed mid-flow, the plan asks — it doesn't decide.
- **Renumbering IDs on revision.** Breaks every external reference.
