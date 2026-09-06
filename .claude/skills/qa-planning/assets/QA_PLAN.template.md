# QA Plan — <feature name>

| | |
|---|---|
| Source spec | <link or path> |
| Branch / version | <branch or tag> |
| Author | <who> |
| Last updated | <date> |
| Status | draft / reviewed / superseded |

## 1. Scope

**In scope**
- <what this plan covers>

**Out of scope**
- <what it deliberately does not cover, and why>

**Open questions**
- <product decisions this plan needs but does not have>

## 2. Acceptance Criteria

| # | Criterion | Covered by |
|---|---|---|
| AC-1 | <condition for done, from the spec> | QA-E2E-001 |

## 3. Critical User Journeys

| # | Journey | Tier | Priority |
|---|---|---|---|
| J-1 | <user-visible path from start to value> | auth / money / data / core / other | P0 |

## 4. E2E Scenarios

```
QA-E2E-001
Priority: P0
Type: Acceptance / E2E
Journey: J-1
Given: <starting state>
When: <the action>
Then:
  - <observable assertion>
  - <observable assertion>
```

## 5. Negative Scenarios

```
QA-NEG-001
Priority: P1
Type: Negative
Journey: J-1
Given: <starting state>
When: <the invalid action>
Then:
  - <correct failure behavior, observable>
  - <what must NOT happen>
```

## 6. Edge Cases

```
QA-EDGE-001
Priority: P1
Family: <catalog family>
Given: <starting state>
When: <the edge condition>
Then:
  - <observable assertion>
```

## 7. Regression Scope

| ID | Existing behavior at risk | Why | Priority |
|---|---|---|---|
| QA-REG-001 | <behavior to re-verify> | <shared code path / table / component> | P0 |

Searched: <what was grepped or inspected to build this list>

## 8. Test Data / Preconditions

| Item | Value / source | Notes |
|---|---|---|
| Accounts | <roles needed> | |
| Fixtures / seed | <path or command> | |
| Feature flags | <flag: state> | |
| External services | <real / mocked / sandbox> | |

## 9. Priority

- **P0** — <rule applied>
- **P1** — <rule applied>
- **P2** — <rule applied>

## 10. Expected Result

**Pass condition** — <what must be true across the scenario set for this to ship>

**Known gaps** — <assertions that could not be made observable, and what's needed>

**Already covered by existing tests** — <scenario IDs and the test files that cover them>
