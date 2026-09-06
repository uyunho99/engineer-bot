# Edge Case Catalog

Work these families against each critical user journey. Not every family applies to every feature — skip explicitly, and say which you skipped and why, rather than silently omitting.

## Contents

- [Input and boundary](#input-and-boundary)
- [State and session](#state-and-session)
- [Concurrency and repetition](#concurrency-and-repetition)
- [Network and dependency failure](#network-and-dependency-failure)
- [Navigation and lifecycle](#navigation-and-lifecycle)
- [Permission and tenancy](#permission-and-tenancy)
- [Time and locale](#time-and-locale)
- [Data volume](#data-volume)
- [Recovery paths](#recovery-paths)
- [Worked example: OAuth login](#worked-example-oauth-login)

---

## Input and boundary

- Empty, whitespace-only, and single-character values for every text input
- Maximum length, maximum + 1, and what the UI does at the limit (truncate, block, error)
- Type boundaries: 0, -1, max int, float where int expected, leading zeros
- Unicode: emoji, RTL text, combining characters, zero-width characters, CJK in length-limited fields
- Injection-shaped input treated as data: `<script>`, `'; DROP`, `{{template}}`, `../../`
- Paste vs type vs autofill vs browser password manager
- File inputs: zero-byte, oversized, wrong MIME, correct MIME with wrong content, filename with path separators

## State and session

- Session expires mid-flow, between page load and submit
- Token refresh succeeds vs fails during an in-flight request
- User logs out in another tab, then acts in this one
- Stale client state after a server-side change (role revoked, resource deleted)
- Browser storage cleared mid-session
- Returning to a multi-step flow after abandoning it — is partial state preserved, and should it be?

## Concurrency and repetition

- Double-click / double-submit on any mutating action — is it idempotent?
- Two tabs performing the same action simultaneously
- Two users editing the same resource (last-write-wins vs conflict detection)
- Rapid repeated requests hitting a rate limit — is the error distinguishable from a real failure?
- Replayed request with a stale idempotency key or CSRF token

## Network and dependency failure

- Offline at request time, and offline *during* a request
- Slow network: does the UI show pending state, and can the user act twice while waiting?
- Upstream timeout vs upstream 500 vs upstream malformed response — these usually need different handling
- Partial write: first of two writes succeeds, second fails. What's the observable state?
- Third-party provider down (OAuth, payments, email, storage)

## Navigation and lifecycle

- Browser back / forward mid-flow, and back after a successful submit
- Refresh at each step of a multi-step flow
- Deep link directly into a mid-flow URL without prior steps
- Closing a popup or modal via ESC, backdrop click, and the OS close button — all three
- Opening a link in a new tab where the flow assumed same-tab

## Permission and tenancy

- Anonymous user hitting an authenticated route
- Authenticated user hitting a route for a role they don't have
- Role changed while the user is on the page
- Cross-tenant access: valid ID belonging to another org, in the URL and in the request body
- Direct API call bypassing UI-level restrictions

## Time and locale

- Timezone boundaries: an action at 23:59 local vs UTC
- DST transitions for scheduled or recurring behavior
- Expiry exactly at the boundary second
- Locale-dependent formatting round-tripping (decimal separators, date order)

## Data volume

- Zero items — is there an empty state, and is it correct?
- Exactly one item (breaks pluralization and many layouts)
- Pagination boundary: exactly page-size items, page-size + 1
- Very large lists: rendering, search, and any client-side sort

## Recovery paths

For each failure above, the plan needs the *recovery* scenario, not just the failure:

- Can the user retry, and does retry succeed?
- Is the error message actionable, or does it leak internals?
- Is partial state cleaned up, or does the user get stuck?
- Is there a support-visible trace (log, error ID) for diagnosis?

---

## Worked example: OAuth login

A generic planner tends to stop here:

```
정상 로그인
잘못된 비밀번호
로그아웃
```

Working the catalog produces:

```
QA-EDGE-001  로그인 버튼 double click → 계정이 하나만 생성되는가
QA-EDGE-002  OAuth popup을 사용자가 직접 닫음 → 원래 페이지로 복귀, 에러 표시
QA-EDGE-003  OAuth provider timeout → 재시도 가능한 에러, 부분 계정 생성 없음
QA-EDGE-004  callback 처리 중 refresh → 중복 계정 없음, 세션 정상
QA-EDGE-005  세션 만료 후 보호된 액션 실행 → 로그인으로 유도, 액션 의도 보존
QA-EDGE-006  탭 A에서 로그아웃 후 탭 B에서 액션 → 401 처리, 조용한 실패 아님
QA-EDGE-007  back navigation으로 로그인 페이지 복귀 (이미 로그인 상태) → /dashboard 리다이렉트
QA-EDGE-008  network offline 상태로 로그인 시도 → 명확한 오프라인 에러
QA-EDGE-009  기존 이메일과 동일한 계정으로 다른 provider 로그인 → 계정 연결 정책대로 동작
QA-EDGE-010  provider가 email scope를 반환하지 않음 → 처리 정책 명시 필요
```

Note that QA-EDGE-009 and QA-EDGE-010 usually surface a **missing product decision** rather than a bug. Surfacing those is part of the job — flag them in the plan instead of guessing the behavior.
