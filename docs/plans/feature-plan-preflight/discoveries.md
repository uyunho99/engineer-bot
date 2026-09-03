# Discoveries — feature/plan-preflight

builder 세션이 누적한다. SDD 워크스페이스는 최종 리뷰 후 삭제되므로 여기 쌓는다 (A5).
형식: `- [<task-id>] <한 줄 발견> — <왜 다음 태스크에 영향을 주는가>`

## 2026-09-03 · 1회전 (BLOCKED, Task 1 착수 전)

- [setup] **세션이 `bun`·`git add`·`npm` 을 실행할 수 없었다** — Bash 가 읽기 전용
  허용목록으로 제한돼 있었다. `pwd`·`git status`·`ls`·`find`·`which` 는 통과하고
  테스트 러너와 git 쓰기는 전부 `This command requires approval` 로 거부됐다.
  15개 태스크가 전부 `verification=deterministic` 이라 RED→GREEN 관찰이 필수인데,
  그 관찰을 만들 수단이 없으므로 어떤 태스크도 완료 판정을 받을 수 없다.
- [setup] **서브에이전트도 같은 제한을 받는다** — haiku 프로브를 띄워 `bun test` 를
  시켰더니 동일하게 거부됐다. 권한은 컨트롤러 세션 로컬이 아니라 세션 전체에 걸린다.
  즉 "권한 있는 서브에이전트에게 시킨다"는 우회는 존재하지 않는다.
- [setup] **superpowers 의 `scripts/sdd-workspace`·`task-brief`·`review-package` 를
  실행할 수 없다** — 샌드박스가 세션을 프로젝트 디렉터리로 가두는데, 그 스크립트들은
  `~/.claude/plugins/cache/…` 에 있다. RUN.md 가 기록한 `--add-dir` 버그와 같은 계열의
  문제다: **하네스가 외부 프로세스·외부 경로에 의존하는 지점은 단위 테스트가 닿지 않고,
  실제 세션에서만 드러난다.** `bin/builder` 가 세션을 띄울 때 권한 모드와 `--add-dir`
  대상을 명시적으로 검증하는 프리플라이트가 필요하다는 신호다.
- [plan] **Task 3 의 네 번째 "테스트로 증명할 것" 항목은 단위 테스트가 아니다** —
  `PreflightDefect["task_ids"]` 튜플 강제는 `bun run typecheck` 로만 관찰된다.
  계획서가 그 한계를 명기하고 있으므로 결함이 아니지만, Task 3 리뷰어가 "assert 없는
  테스트"로 오인할 수 있다. 디스패치에 미리 알려야 한다.
- [plan] **Task 11 의 예시 `controller/preflight-cli.ts` 는 `findFixSites` 를
  import 하고 쓰지 않는다** — `tsconfig.json` 의 `noUnusedLocals: true` 때문에
  그대로 옮기면 Task 11 Step 4 의 `bun run typecheck` 가 실패한다. 전사할 때
  그 import 를 빼야 한다. 계획서의 코드 블록과 통과 기준이 충돌하는 것이 아니라,
  통과 기준이 전사 세부를 지배하는 경우다.

## 2026-09-03 · 3회전 (REJECTED, Task 1 착수 전)

- [setup] **권한 결함이 해소됐다** — 1·2회전을 막았던 것이 이번엔 전부 통과했다.
  `bun --version`(1.3.14) · `bun test`(130/130) · `git status` · `bun run typecheck` ·
  `~/.claude/plugins/cache/.../scripts/sdd-workspace` 실행까지 정상이다. RUN.md 관찰 #2
  의 `allow` 목록 + `--add-dir` 수정이 실효했다. **A4 하드룰·A6 계약보다 먼저 검증해야
  하는 것은 "세션이 애초에 손발을 갖는가"였다**는 것이 1~3회전의 누적 교훈이다.
- [setup] **SDD 워크스페이스 경로가 모든 플랜에서 충돌한다** — `sdd-workspace` 는
  플랜 파일의 **basename** 으로 디렉터리를 만든다: `plan.md` → `.superpowers/sdd/plan`.
  그런데 이 레포의 경로 계약(§4.1)은 모든 플랜을 `docs/plans/<slug>/plan.md` 로
  고정한다 — 즉 **모든 기능의 플랜이 `plan.md` 라서 단 하나의 워크스페이스를 공유한다.**
  지금은 ledger 첫 줄의 플랜 경로 대조가 유일한 방어선이고(스킬이 "다른 플랜의
  ledger 면 그대로 두고 새로 시작하라"고 지시), 브리프·리포트·리뷰 패키지 파일명은
  `task-N-*` 로 겹친다. 다음 기능을 빌드할 때 이전 기능의 잔여 파일을 읽을 위험이 있다.
  → 오버레이나 `bin/builder` 가 워크스페이스를 슬러그로 분리하도록 손볼 값이 있다.
- [setup] **worktree 를 만들지 않고 현재 브랜치에서 작업하기로 판정했다** — 설계 §5.3 이
  `controller/builder.ts` 가 오버레이를 `HARNESS_ROOT` 에서 읽으므로 worktree 사본과
  원본이 갈릴 수 있다고 경고한다. 그 오버레이가 이 세션을 구동하는 당사자다. 이미
  `feature/plan-preflight`(main 아님)에 있어 SDD Setup 이 요구하는 "main 격리"는 충족된다.
- [plan] **Task 14 의 첫 테스트는 통과할 수 없다 — 이번 반송 사유다** (실측 확인).
  `checkPlan` 은 **플랜 전체** 불변식(`## Global Constraints` 존재 · `Task 1..N` 번호 연속)을
  보는데, 테스트는 오버레이에서 뽑은 **태스크 한 개 조각**을 넣고 error 0건을 요구한다.
  실측 error 3건: Global Constraints 누락 + Task 1 없음 + Task 2 없음. 뒤 둘은 원리적으로
  못 고친다 — 오버레이 예시는 `Consumes: PersonaSeed from Task 2` 를 시연하려고 **의도적으로
  `### Task 3`** 이다. 결함이 Step 1 코드가 아니라 **요건 문장(plan.md:2725)** 에 있다.
- [plan] **같은 계열의 Task 2 테스트는 왜 안 깨지는가 — 이것이 재사용할 관용구다.**
  Task 2 의 테스트들(plan.md:296-331)은 같은 조각·같은 `checkPlan` 을 쓰면서도
  `errorsOf(...).some((x) => x.message.includes("Files"))` 처럼 **메시지로 필터**한다.
  그래서 봉투 위반 3건이 결과에 있어도 무해하다. Task 14 만 `toEqual([])` 를 써서
  플랜 전체 규칙까지 떠안았다. **전체 문서를 검사하는 함수에 문서 조각을 먹일 때는
  기대를 "빈 배열"이 아니라 "관심 있는 위반의 유무"로 써야 한다** — 다음 플랜을 쓸 때
  이 관용구를 오버레이에 못박을 값이 있다.
- [plan] **`v.taskId` 로 필터하는 우회는 함정이다** — Task 2 Step 3 이 추가하는
  Files/Interfaces 위반은 `err({ file, rule, message })` 로만 push 하고 `taskId` 를
  넣지 않는다(plan.md:365-382). taskId 필터는 Task 14 가 잡아야 할 위반을 정확히 숨긴다.
- [plan] **Task 15 의 7번째 테스트 케이스는 Step 1 블록에 코드가 없다** — `runBuilder` 가
  게이트 미통과 시 `claude` 를 띄우지 않는다는 항목이다. 요건 7개, 전사된 테스트 6개.
  요건이 코드를 지배하므로 결함은 아니지만, 전사 태스크로 최저가 모델에 맡기면 조용히
  누락된다.
- [plan] **Task 9 의 테스트는 `PreflightRaw` 를 import 하지 않는다** — tsconfig 의
  `include` 가 `controller/**/*.ts` 라 테스트 파일도 타입체크 대상이고
  `noUnusedLocals: true` 다. Task 11 의 `bun run typecheck` 에서 드러난다.
  2회전이 Task 11 에서 찾은 것과 같은 계열(전사 시 import 정리)이다.
- [plan] **Global Constraints 의 "기존 테스트 107개"가 실측과 다르다** — 현재 130개다.
  리뷰어의 attention lens 에 틀린 수치가 들어가면 회귀 판정 기준이 흔들린다.

## 2026-09-03 · 4회전 (REJECTED, Task 1 착수 전)

- [setup] **3회전의 반송 6건이 전부 반영됐다** — 특히 Task 14 의 `planAround` 봉투가
  들어갔고, 실측으로 확인했다: 오버레이 예시 블록(`### Task 3`, generative/invisible)을
  Task 1·2 스텁 + `## Global Constraints` 로 감싸면 `checkPlan` error 0건이다
  (generative 골든셋 부재는 `warn` 이라 필터를 통과한다). Task 14 는 이제 통과 가능하다.
- [setup] 기준선 재실측: `bun test` **130 pass / 0 fail**, `bun run typecheck` 통과
  (bun 1.3.14). Global Constraints 의 130 이 실측과 일치한다.
- [plan] **`Violation["file"]` 이 닫힌 리터럴 유니온이다 — 이번 반송 사유다** (실측 확인).
  `contract.ts:18` 이 `file: "design-doc.md" | "plan.md" | "build-result.json"` 으로
  좁혀 놓았는데, Task 8 Step 3 은 `file: "preflight-raw.json"` 을, Task 15 Step 3 은
  `file: "preflight.json"` 을 push 한다. 두 태스크 모두 `Consumes: Violation (기존)` 을
  선언하고 `Modify: controller/contract.ts` 는 **선언하지 않는다.** 유니온을 넓힐 권한을
  가진 태스크가 플랜에 없다. 프로브로 `bun run typecheck` → `TS2322` 2건 확인.
  **왜 다음 태스크에 영향을 주는가:** Task 11·14·15 의 Step 4 통과 기준이
  `bun run typecheck` 다. 플랜의 마지막 3분의 1이 전부 이 결함 위에서 실패한다.
- [plan] **이것이 정확히 이 기능이 잡으려는 `undeclared_conflict` 다 — 자기 시연이다.**
  `**Interfaces:**` 그래프는 **심볼**을 모델링하고 **심볼의 필드 모양**은 모델링하지
  않는다. `Consumes: Violation` 은 "이 타입을 쓴다"까지만 말하고 "이 타입의 `file`
  필드가 내 파일명을 받아주는가"는 말하지 못한다. 1단계 기계 검사(설계 §6.2)는 이
  결함을 원리적으로 못 잡고, 2단계 파일 겹침 짝도 못 잡는다 — Task 8 과 contract.ts 를
  함께 건드리는 태스크가 없으므로 짝이 만들어지지 않는다.
  → **설계 §7.4 관찰 항목에 추가할 값이 있다:** "기존 타입을 소비하는 태스크가 그
  타입의 리터럴 유니온을 넓혀야 하는 경우"는 이 검사기의 알려진 사각지대다.
- [plan] **Task 15 Step 1 의 두 번째 `describe` 가 첫 `describe` 의 지역 변수를 쓴다** —
  `SHA`·`result` 는 `describe("checkPreflightGate")` 콜백 **안**에 선언돼 있는데
  (plan.md:2933-2938), `describe("runBuilder — ...")` 의 테스트가 `result()`·`SHA` 를
  참조한다 (plan.md:2997). 스코프 밖이라 `TS2304` + 런타임 ReferenceError 다.
  결함이 아니라 전사 세부다 — 두 const 를 모듈 스코프로 올리면 끝이고 요건은 안 바뀐다.
  다만 최저가 모델에 전사를 맡기면 조용히 깨진다.
- [plan] **Task 12·13 이 같은 테스트 파일에 `node:fs` import 를 각각 추가한다** —
  Task 12 는 `import { readFileSync }` (plan.md:2319), Task 13 은
  `import { existsSync, readFileSync }` (plan.md:2574). 같은 파일에서 `readFileSync`
  중복 선언이고, Task 13 의 `existsSync` 는 쓰이지 않아 `noUnusedLocals` 에도 걸린다.
  Task 9·11 과 같은 계열(전사 시 import 정리)이다.
- [plan] **Task 3·14 의 테스트가 쓰는 심볼이 `contract.test.ts` import 목록에 없다** —
  Task 3 은 `contractPaths`(plan.md:432), Task 14 는 `readFileSync`(plan.md:2738).
  현재 `contract.test.ts` 는 둘 다 import 하지 않는다. Task 1 이 "`import` 줄에
  `parseFiles`, `parseInterfaces`, 타입을 추가한다"를 명시한 것처럼 명시가 필요하다.
- [plan] **Task 10 의 "원본이 안 바뀐다" 단언은 항진명제다** — `const before = TWO_TASKS;`
  뒤에 `expect(TWO_TASKS).toBe(before)` 다 (plan.md:1833-1836). 문자열은 불변이라
  어떤 구현에서도 통과한다. D16(부분 적용 금지)을 실제로 증명하려면 반환값 쪽을 봐야
  한다 — `not_found` 일 때 `r` 에 `text` 필드가 없다는 것이 진짜 관찰이고, 그건 이미
  `expect(r.status).toBe("not_found")` 가 하고 있다. Minor.
- [setup] **SDD 워크스페이스 경로 충돌이 그대로 남아 있다** (3회전 관찰 재확인) —
  `sdd-workspace` 가 플랜 basename 으로 디렉터리를 만들어 `.superpowers/sdd/plan` 이다.
  이 레포의 모든 플랜이 `plan.md` 라서 단 하나를 공유한다. ledger 첫 줄 대조가 유일한
  방어선이다.
