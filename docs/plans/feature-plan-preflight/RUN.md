# 실행 인계 — feature/plan-preflight

## 명령

```bash
cd ~/Documents/Persona/engineer-bot && TARGET_REPO=$PWD bin/builder feature/plan-preflight
```

새 Claude Code 세션이 아니라 **일반 터미널**에서 실행한다. `bin/builder` 가 자기
`claude -p` 세션을 띄운다. 2~4시간 걸리고 사람 개입은 0회다.

로그를 남기려면 `2>&1 | tee /tmp/builder-run.log` 를 붙인다.
타임아웃을 늘리려면 `BUILDER_TIMEOUT_MS=21600000` (6시간) 을 앞에 붙인다.

## 이게 무엇인가

`bin/builder` 는 **subagent-driven-development 를 감싼 포장지**다. 하는 일:

1. 계약 검증 — 형식이 틀리면 세션을 시작하지 않는다
2. headless 세션 기동 — `overlay/CLAUDE.builder.md` 를 시스템 프롬프트에 주입
3. 타임아웃 감시 (기본 4시간) — 무한 루프 최종 방어선
4. `build-result.json` 수확 — 없거나 깨지면 `BLOCKED` (성공 처리하지 않는다)

SDD 스킬을 사람이 직접 부르지 않는다. 세션이 부른다. worktree · TDD · task reviewer ·
5라운드 수정 · 최종 리뷰 · PR 생성이 전부 그 안에서 자동으로 일어난다.

## 결과 확인

```bash
cat docs/plans/feature-plan-preflight/build-result.json
cat docs/plans/feature-plan-preflight/discoveries.md
git log --oneline
```

| outcome | 뜻 | 다음 |
|---|---|---|
| `SUCCESS` | 15개 태스크 완주 + PR 생성 | PR 확인 후 **사람이** 머지 (게이트 ②) |
| `REJECTED` | 플랜 결함 발견 | `defects[]` 를 보고 플랜 수정 → 재승인 |
| `BLOCKED` | 막힘 | `blocked.reason` · `attempts[]` 확인 |

## 중단·재시도

중단해도 안전하다. 이미 커밋된 태스크는 남고, 같은 명령을 다시 치면 SDD 가 ledger 를
읽고 이어서 한다. Task 15(게이트)를 마지막으로 옮긴 것이 이 재시도를 위한 것이다 —
게이트가 먼저 들어가면 재시도가 `preflight.json` 없음으로 막힌다.

**`git clean -fdx` 금지** (하드룰 #5). SDD ledger 가 날아가고 복구는 `git log` 뿐이다.

## 1회전에서 관찰할 것 (BUILD-PLAN Phase 0-B · 설계 §7.4)

이 빌드의 목적은 기능 완성이 아니라 **관찰**이다. 끝난 뒤 이것들을 확인한다.

| 관찰 | 어디서 | 판정할 것 |
|---|---|---|
| `**Interfaces:**` 를 writing-plans 가 붙였는가 | 다음 기능의 plan.md | **오버레이가 원본 스킬을 이기는가** — 최상위 리스크 |
| SDD 가 `## Setup` 사전 스캔에서 사람에게 물으려 했는가 | 로그 | AMENDMENTS A3 변환이 오버레이만으로 먹히는가 |
| 서브에이전트 디스패치에 model 이 명시됐는가 | 로그 | A4 하드룰의 실효성 — 누락되면 비용이 조용히 튄다 |
| `build-result.json` 이 실제로 쓰였는가 | 파일 존재 | A6 외부 계약 |
| `discoveries.md` 가 계약 경로에 쌓였는가 | 파일 존재 | A5 (SDD 워크스페이스는 삭제된다) |
| 오버레이 원본과 worktree 사본이 갈렸는가 | worktree 확인 | 설계 §5.3 도그푸딩 제약 |
| 태스크 하나당 리뷰어가 얼마나 걸렸는가 | 로그 타임스탬프 | A1 재논의 필요 여부 |

## 현재 상태 (2026-09-03)

- 커밋 12개, 작업트리 깨끗, 브랜치 `feature/plan-preflight`, 원격 없음
- 설계문서 813줄 (결정 D1~D29, D2·D3·D8 폐기 표시)
- 계획서 3,036줄 · 태스크 15개 · 전부 `deterministic/invisible` · 테스트 케이스 114건
- `bun test` 107개 통과 · `bootstrap.sh check` 전부 초록불
- superpowers 6.2.0 단독 활성 (플러그인 이름 충돌 해소됨 — A7)
- webapp-testing vendoring 완료 (sha 5304866) · python playwright 1.58.0

## 이 빌드가 끝난 뒤 남는 결정

1. `materialize --export` — `/plan-eng-review` 를 쓰려면 지금은 손으로 복사한다 (A14)
2. `qa-planning` 배치 + `QA_PLAN.md` 경로 정규화 (A15 · 설계 §1.1.1)
3. `webapp-testing` 배치 — 로컬 dev server vs Vercel 프리뷰
4. 파일 수준 의존 검사 — `**Interfaces:**` 는 심볼만 표현한다 (설계 §4.2 한계)

## ⚠️ 원격이 없다 (2026-09-03 실측)

`git remote -v` 가 비어 있다. 플랜의 마지막 단계(`finishing-a-development-branch` 의
PR 생성)는 푸시할 곳이 없어 실패한다. `gh` 인증은 되어 있다 (`uyunho99`).

**빌드를 막지는 않는다.** 15개 태스크는 만들어지고 로컬에 커밋되며, Phase 0-B 의 관찰
목적은 전부 달성된다. PR 단계가 맨 마지막이므로 빌드가 도는 동안 아무 때나 원격을
만들면 된다:

```bash
gh repo create engineer-bot --private --source=. --remote=origin
```

원격 생성은 외부에 산출물을 만드는 일이므로 사람이 판단한다.

## Phase 0-B 관찰 #1 — argv 버그 (2026-09-03, 첫 실행)

첫 `bin/builder` 실행이 **2초 만에 `BLOCKED`** 으로 끝났다.

```
⛔ BLOCKED — feature/plan-preflight
세션이 …/build-result.json 를 남기지 않았습니다 (exit=1) — 외부 보고 계약 위반
```

**원인:** `--add-dir` 는 가변 인자(`--add-dir <directories...>`)여서 뒤따르는
프롬프트를 디렉터리로 삼켰다. claude 가 `Input must be provided either through
stdin or as a prompt argument when using --print` 로 즉시 exit 1 했다.

실측 증명:
```
claude --print --add-dir <dir> "1+1은?"      → Error (프롬프트 유실)
claude --print --add-dir <dir> -- "1+1은?"   → {"result":"2입니다."}
```

**왜 단위 테스트 107개가 못 잡았나:** 테스트가 `claude` 를 한 번도 띄우지 않았다.
BUILD-PLAN 이 *"❌ 실제 claude -p 세션으로 플랜을 완주한 적 없음"* 이라고 적어둔
칸의 대가가 정확히 이것이다.

**수정 2건:**
1. `buildClaudeArgs()` 를 순수 함수로 뽑고 프롬프트 앞에 `--` 를 넣었다.
   argv 구성이 테스트 가능해졌다 (`controller/builder.test.ts`, 12건).
2. **stderr 를 포착한다.** `builder.ts` 가 stdout/stderr 를 파이프로 열고 읽지
   않아서 세션의 오류 메시지가 버려졌다 — 원인 파악에 수동 재현이 필요했던 이유다.
   이제 BLOCKED 사유에 세션 출력 꼬리가 붙는다.

**교훈:** 하네스 코드가 외부 프로세스를 띄우는 지점은 단위 테스트가 닿지 않는다.
그 경계의 **입력 구성**만이라도 순수 함수로 뽑아야 테스트가 가능하다.

## Phase 0-B 관찰 #2 — 권한 결함 (2026-09-03, 두 번째 실행)

argv 수정 후 세션이 정상 기동했고 **SDD 가 실제로 시작했다** (워크스페이스 생성 확인).
그러나 Task 1 을 디스패치하지 못하고 **300초 뒤 `BLOCKED`** 으로 정지했다.

**봇의 보고 (요약):**
> 세션의 Bash 가 읽기 전용 허용목록으로 제한돼 테스트 러너와 git 쓰기를 실행할 수
> 없습니다. `bun test`, `bun --version`, `npm test`, `git add` 가 모두
> `This command requires approval` 로 거부됐습니다. 15개 태스크가 전부
> verification=deterministic 이라 RED→GREEN 관찰이 완료 조건인데, 그 관찰을 만들
> 수단도 커밋할 수단도 없습니다. 검증 없이 15개 태스크를 써서 커밋하는 것은
> 오버레이가 금지한 "어떻게든 되게 만들기"에 해당하므로 정지했습니다.

**이 보고 자체가 성과다.** 봇이 시도 3건을 기록하고(스크립트 직접 실행 · 러너 4형태 ·
서브에이전트 우회), 해소 방법을 제시하고, `build-result.json` 을 규격대로 썼다.
A6 외부 계약과 오버레이의 "우회 금지"가 실제로 작동했다.

**원인:** `config/builder.settings.json` 에 `deny` 만 있고 **`allow` 가 없었다.**
`--permission-mode acceptEdits` 는 **파일 편집만** 자동 승인한다. Bash 는 여전히
승인이 필요하고 headless 에는 승인할 사람이 없다. 초안은 "위험한 것을 막는다"만
쓰고 "평범한 것을 허용한다"를 빼먹었다 — 대화형 세션에서는 사람이 나머지를
승인하므로 드러나지 않는 결함이다.

**수정 3건:**
1. `config/builder.settings.json` 에 `allow` 목록 추가 (bun · node · git 하위명령 ·
   gh pr create/view/list/diff). `deny` 가 `allow` 를 이기므로 위험한 것은 그대로 막힌다.
2. `superpowersDir` 를 런타임에 해석해 `--add-dir` 로 넘기고, SDD 스크립트 3개의
   절대경로 `allow` 규칙을 기동 시점에 병합한다 (`mergeSettings`). 설정 파일은
   이식 가능하게 남고 호스트별 경로는 런타임에 붙는다.
   → 봇이 `~/.claude/plugins/cache/…/scripts/sdd-workspace` 에 닿지 못해 Write 툴로
     워크스페이스를 우회 생성했던 문제도 이것으로 해소된다.
3. `stdin: "ignore"` — 열어두면 claude 가 파이프 입력을 3초 기다린다
   (`no stdin data received in 3s`).

**봇이 함께 보고한 플랜 결함 2건 (검증 후 수정):**
- `[Task 11]` 예시 코드가 `findFixSites` 를 import 하고 쓰지 않는다. tsconfig 의
  `noUnusedLocals: true` 로 Step 4 의 `bun run typecheck` 가 실패한다. **실측 확인** —
  import 목록에서 제거하고 이유를 주석으로 남겼다.
- `[Task 3]` 네 번째 테스트 케이스는 단위 테스트가 아니라 `bun run typecheck` 로만
  관찰된다. 리뷰어가 "assert 없는 테스트"로 오인할 수 있다. 관찰 수단과 검증 절차를
  항목에 명시했다.

**이것이 §6.3 반송 경로가 실제로 작동한 사례다.** 봇이 플랜을 고치지 않고 결함을
보고했고, 사람 쪽(planner)이 검증한 뒤 고쳤다.

**교훈:** headless 세션의 권한은 `deny` 만으로 설계할 수 없다. 대화형에서는 사람이
암묵적 `allow` 를 제공하지만 headless 에는 그것이 없다. `--permission-mode` 가
무엇을 자동 승인하는지(편집만)를 정확히 알아야 한다.

## Phase 0-B 관찰 #3 — 플랜 반송 (2026-09-03, 3회전)

권한 결함이 해소되고 세션이 **손발을 얻었다.** 봇 확인:
`bun --version`(1.3.14) · `bun test`(130/130) · `git status` · `bun run typecheck` ·
`sdd-workspace` 실행까지 전부 정상.

그리고 봇은 **Task 1 을 디스패치하지 않고 `REJECTED` 로 반송했다.** 커밋 0건,
기준선 130/130 유지. **plan.md 를 건드리지 않았다** — 바뀐 파일은 `build-result.json`
과 `discoveries.md` 둘뿐이다 (하드룰 #2 준수).

**반송 사유 (실측 확인됨):** Task 14 의 첫 테스트가 통과 불가.
`checkPlan` 은 플랜 **전체** 불변식(`## Global Constraints` 존재 · `Task 1..N` 연속)을
보는데, 테스트는 오버레이에서 뽑은 **태스크 한 개 조각**에 error 0건을 요구했다.
실측 error 3건이며 번호 2건은 원리적으로 못 고친다 — 오버레이 예시는
`Consumes: PersonaSeed from Task 2` 를 시연하려고 의도적으로 `### Task 3` 이다.

**이것이 A3 변환이 작동한 증거다.** SDD 의 `## Setup` 사전 스캔은 원래 "발견한 것을
한 번에 묶어 사람에게 물어라"고 지시한다. 봇은 묻지 않고 `REJECTED` 로 반송했다 —
오버레이가 업스트림 스킬의 지시를 이겼다. BUILD-PLAN 최상위 리스크에 대한 두 번째 반박이다.

### 봇이 함께 찾은 플랜 결함 6건 (전부 수정)

| # | 결함 | 조치 |
|---|---|---|
| 1 | Task 14 첫 테스트 통과 불가 (반송 사유) | 예시를 **완전한 플랜으로 감싸는** 헬퍼로 교체. 왜 감싸는지 증명하는 테스트도 추가 |
| 2 | Global Constraints 의 "기존 테스트 107개"가 실측 130개와 다르다 | 130 으로 고치고 "숫자를 외우지 말고 재실측한다"를 명기 |
| 3 | Task 9 테스트가 `PreflightRaw` 를 import 하지 않는다 | `include` 가 테스트도 타입체크하고 `noUnusedLocals: true` 다. import 추가 |
| 4 | Task 15 의 7번째 요건에 대응하는 테스트 코드가 없다 (요건 7 · 전사 6) | 해당 테스트를 작성해 넣었다. "그 앞의 관문이 막는 것을 단언한다" 논리 |
| 5 | 문서 전체 검사 함수에 조각을 먹이는 관용구 | 오버레이 self-review 체크리스트에 못박는 항목으로 추가 (Task 14 범위) |
| 6 | `Consumes` 한 줄에 하나 · `from Task N` 은 심볼만 | 같은 체크리스트에 추가 |

### 하네스 결함 1건 — AMENDMENTS B6 으로 승격

봇이 찾은 것 중 가장 값진 것은 플랜 결함이 아니었다:

> `sdd-workspace` 는 플랜 파일의 **basename** 으로 워크스페이스를 만든다.
> `plan.md` → `.superpowers/sdd/plan`. 그런데 경로 계약(§4.1 · B2)은 **모든** 플랜을
> `docs/plans/<slug>/plan.md` 로 고정한다 — 즉 모든 기능이 **하나의 워크스페이스를
> 공유한다.** 두 번째 기능을 빌드하면 이전 기능의 `task-N-brief.md` 를 읽을 수 있다.

**B2 가 파일명을 고정한 대가다.** 계약을 만들 때 업스트림이 파일명으로 무언가를
구분한다는 것을 놓쳤다. 플랜이 하나뿐인 지금은 안 터지지만 두 번째 기능 착수 전에
처리해야 한다. AMENDMENTS **B6** 에 기록했다.

**교훈:** 봇의 `discoveries.md` 가 사람 리뷰보다 나은 지점이 있다 — 실제로 실행해보고
쓰기 때문이다. `/plan-eng-review` 와 Codex outside voice 가 둘 다 놓친 것을
3회전 한 번이 찾았다.

## Phase 0-B 관찰 #4 — 검사기의 자기 시연 (2026-09-03, 4회전)

3회전 반송 6건이 전부 반영됐고 봇이 실측으로 확인했다 (`planAround` 봉투가
`checkPlan` error 0건, 기준선 130/130, typecheck 통과). 그리고 **또 반송했다.**

**반송 사유:** `Violation["file"]` 이 닫힌 리터럴 유니온이다
(`"design-doc.md" | "plan.md" | "build-result.json"`). Task 8 은
`file: "preflight-raw.json"` 을, Task 15 는 `file: "preflight.json"` 을 push 하는데
**두 태스크 모두 `Modify: controller/contract.ts` 를 선언하지 않는다** — 유니온을
넓힐 권한을 가진 태스크가 플랜에 없었다. 봇이 프로브 파일로 `TS2322` 2건을 확인했다.

### 봇이 스스로 지적한 것 — 이 기능의 사각지대

> **이것이 정확히 이 기능이 잡으려는 `undeclared_conflict` 다 — 자기 시연이다.**
> `**Interfaces:**` 그래프는 **심볼**을 모델링하고 **심볼의 필드 모양**은 모델링하지
> 않는다. `Consumes: Violation` 은 "이 타입을 쓴다"까지만 말하고 "이 타입의 `file`
> 필드가 내 파일명을 받아주는가"는 말하지 못한다. 1단계 기계 검사는 이 결함을
> 원리적으로 못 잡고, 2단계 파일 겹침 짝도 못 잡는다 — Task 8 과 contract.ts 를
> 함께 건드리는 태스크가 없으므로 짝이 만들어지지 않는다.

설계 §4.2 비스코프에 **알려진 사각지대**로 기록했다. 검사기가 잡지 못하는 결함으로
검사기의 플랜이 반송된 것이므로, 이보다 좋은 한계 증명은 없다.

### 수정 6건

| # | 결함 | 조치 |
|---|---|---|
| 1 | `Violation.file` 유니온이 preflight 파일명을 안 받는다 (반송 사유) | Task 3 이 유니도를 넓힌다. 그 태스크가 유일하게 `contract.ts` 타입을 건드린다 |
| 2 | Task 15 두 번째 `describe` 가 첫 `describe` 의 지역 변수를 참조 (`TS2304`) | `SHA`·`result` 를 모듈 스코프로 올렸다 |
| 3 | Task 12·13 이 같은 테스트 파일에 `node:fs` 를 중복 import | Task 13 에 "다시 추가하지 마라" 를 명시 |
| 4 | Task 3 테스트가 `contractPaths` 를 쓰는데 import 없음 | 추가 지시 명기 |
| 5 | Task 14 테스트가 `readFileSync` 를 쓰는데 import 없음 | 추가 지시 명기 |
| 6 | Task 10 의 "원본이 안 바뀐다" 단언이 항진명제 | 문자열은 불변이라 어떤 구현에서도 통과한다. 타입 수준 관찰(`"text" in r`)로 교체하고 함정을 주석으로 남겼다 |

### 남은 것 — B6 워크스페이스 충돌

봇이 3·4회전에서 연속으로 지적했다. 이번엔 태스크를 디스패치하지 않아 실해가
없었지만(ledger 만 새로 썼다) 다음 기능에서 이전 잔여 파일을 읽을 위험이 그대로다.
AMENDMENTS **B6** 에 기록돼 있고 **미구현**이다.

**교훈 (1~4회전 누적):** 봇이 4회 연속으로 실제 결함을 찾았고 단 한 번도
플랜을 몰래 고치지 않았다. 매 회전이 반송으로 끝났지만 **그것이 이 파이프라인이
제대로 작동한다는 증거다** — SDD 는 틀린 플랜도 끝까지 완주하는 도구이고,
게이트 ① 앞에서 멈추게 만드는 것이 오버레이의 존재 이유였다.

## Phase 0-B 관찰 #5 — 근본 원인 (2026-09-03, 5회전)

봇이 결함 6건을 프로브 파일로 실측해 반송했다 (프로브는 스스로 삭제했다).
그리고 **1~5회전 전체의 근본 원인을 지적했다:**

> 1·3·4·5회전이 모두 "타입 오류가 `bun test` 를 통과해 세 태스크 뒤에서 터진다"였습니다.
> 원인은 Task 4~10 의 Step 4 가 `bun test` 뿐이라는 것입니다. **`bun test` 는
> 트랜스파일만 하므로 GREEN 이 타입 무결성을 증명하지 않습니다.**

5회전 동안 증상만 고치고 있었다. **구조적 수정:** 타입을 정의·수정하거나 새 파일을
만드는 태스크(1·2·4~10·12·13)의 Step 4 에 `bun run typecheck` 를 함께 넣었다.
이제 결함이 발생한 태스크에서 즉시 터지고, 리뷰어가 원인을 세 태스크 거슬러 찾지 않는다.

### 형식 결함 — 파서가 관대하지 않다

가장 값진 발견은 **`unbacktick` 이 바깥쪽 백틱만 벗긴다**는 것이었다.

```
- Produces: `A`, `B`, `C`     →  심볼 하나("A\`, \`B\`, \`C")로 파싱된다
                                 symbolName() 이 "A" 만 뽑고 B·C 는 그래프에서 사라진다
```

봇이 **플랜 자신의 파서(Task 1)와 검사기(Task 5)를 `plan.md` 에 돌려** 실측했다.
플랜에 그런 줄이 12건 있었다 → 전부 한 줄에 하나로 쪼갰다.

**내 감사가 거짓 통과를 냈던 이유가 이것이다.** 나는 시뮬레이션에서
`` pr[1].split(/`,\s*`/) `` 로 쪼개 읽었는데, 플랜이 정의한 실제 구현은 쪼개지 않는다.
**시뮬레이션이 명세보다 관대하면 감사는 무의미하다.**

같은 계열 3건을 더 찾아 고쳤다:
- 백틱 **뒤에 산문**을 붙이면 심볼에 이어붙는다 (`` `checkPlan(...)` (기존 함수…) ``)
- **파일·산출물을 `Produces` 에 적으면** `symbolName("workflows/plan-preflight.js")` 가
  `"workflows"` 가 되어 거짓 매달린 참조가 난다 (Task 12·13)
- `signatureCandidates` 가 **반쪽 수정**이었다 — `symbolName` 으로 찾고 **원문으로 비교**해서
  `Consumes: \`Foo\`` + `Produces: \`interface Foo {...}\`` 가 항상 후보가 됐다.
  봇 실측 오탐 후보 **19건**. 소비 쪽이 맨 이름만 쓴 경우를 제외하고 테스트 2건을 추가했다
  (두 번째가 중요하다 — 과하게 고쳐도 통과하는 것을 막는다)

### 나머지 3건

- Task 15 가 `const SHA` 를 **재선언**한다 (Task 8 이 이미 같은 파일 모듈 스코프에 선언).
  bun 에서 `error: "SHA" has already been declared` 로 테스트 파일 전체가 죽는다
- Task 12 의 테스트 정규식 `/\bagent\(/g` 이 **주석 안의 `agent(` 도 센다** (실측 6 vs 5).
  주석을 먼저 벗기게 고쳤다 — 한 줄만 고치면 같은 함정이 남는다
- Task 4 의 미사용 `ConsumeRef` import (TS6196) · Task 8 의 `return bad(...)` 가
  `: void` 와 충돌 (TS2322). 둘 다 `bun test` 는 통과하고 Task 11 에서 터진다

### 오버레이에 못박은 것 (Task 14 범위)

self-review 체크리스트에 3줄을 더했다 — 다음 플랜부터 자동 적용된다:
1. `Produces`·`Consumes` 백틱 뒤에 산문을 붙이지 않았다
2. 파일·산출물을 `Produces` 에 적지 않았다
3. `deterministic` 태스크의 Step 4 가 테스트 러너만 부르지 않는다 — **GREEN 이 타입
   무결성을 증명하지 않는다**

### 감사 결과 (플랜의 실제 파서 의미로)

```
관계 30개 · 매달림 0 · 순서위반 0 · 서명후보 0 · 핸드오프 계약 통과
```

## Phase 0-B 관찰 #6 — 낡은 보고를 새 결론으로 (2026-09-03, 6회전)

6차 세션이 **63분(3815초) 돌고 `build-result.json` 을 남기지 못했다.** 그런데
`bin/builder` 는 `REJECTED` 를 자신 있게 출력했다 — **5회전의 보고를 다시 읽어서**다.

실측 타임라인:

```
17:36:25  build-result.json 쓰임          ← 5회전 세션
17:37:34  e486c72 커밋 (5회전 반송 기록)
17:41:42  2eb1d98 커밋 (5회전 수정 6건)
   ~18:45  6차 세션 종료 — 파일 mtime 이 17:36 그대로다
           builder.ts 가 그 파일을 읽어 5회전 결과를 6차 결과로 보고
```

**`builder.ts` 는 "파일이 있는가"만 보고 "이번 실행이 쓴 것인가"는 보지 않았다.**

A6 은 *"파싱 실패를 조용히 성공으로 처리하지 않는다"* 를 규정했다. 그 구멍은 막혀
있었지만 **낡은 결론을 새 결론으로 처리하는** 구멍이 남아 있었다. 이것이 더 위험하다 —
파싱 실패는 `BLOCKED` 로 정직하게 끝나지만, 낡은 보고는 **그럴듯한 `REJECTED`/`SUCCESS`
로 끝난다.** 만약 5회전이 `SUCCESS` 였다면 6차가 아무 일도 안 하고 성공을 보고했고,
사람은 게이트 ② 에서 그것을 이번 빌드의 결과로 읽었을 것이다.

**수정:** `spawn` 직전 시각을 기준선으로 잡고, 보고 파일의 mtime 이 그보다 이르면
읽지 않고 `BLOCKED` 로 끝낸다 (`isStaleReport`). 순수 함수로 뽑아 테스트 4건을 붙였다 —
그중 하나가 이 실측 타임라인의 재현이다.

**교훈:** 외부 보고 계약에는 **형식**뿐 아니라 **신선도**가 포함된다. 파일 기반 경계는
견고하지만(A6), 파일은 지워지지 않고 남는다 — "존재"가 "이번 것"을 뜻하지 않는다.
