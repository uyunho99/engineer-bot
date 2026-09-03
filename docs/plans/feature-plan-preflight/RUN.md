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
