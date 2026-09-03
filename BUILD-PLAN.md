# engineer-bot 구축 플랜

> **입력** — `planner-builder-bot-spec.md` (2026-07-23 확정, 미결 질문 0건)
> **이 문서의 역할** — 명세가 *무엇을* 정의했다면, 이 문서는 *어떤 순서로 무엇을 만드는가*를 정의한다.
> **작성** 2026-07-30 · 환경 실측 기준 (`./bootstrap.sh check`)

---

## 0. 이 플랜이 명세에 추가하는 것

명세 §9 체크리스트에는 **인프라 항목이 없다.** 설계 전체가 "Slack 스레드 → headless Claude Code 세션"인데
그것을 실행할 호스트·이벤트 수신·상태 저장·자격증명이 미정이다. 아래 두 가지를 채운다.

### 0.1 순서 변경 1건 (권고)

명세 §9의 **마지막 줄**("CVC/DCX의 작은 visible 기능 1개로 끝까지 1회전")을 **첫 번째로** 옮긴다.

**근거** — 이 명세의 리스크는 배선이 아니라 *오버레이가 실제로 먹히는지*에 있다.
gstack `office-hours`·`plan-ceo-review`는 산출 경로가 `~/.gstack/projects/`이고(§4.1 이슈),
superpowers `writing-plans`는 2축 태깅을 모른다(§3.4). 이 둘이 프롬프트 오버레이만으로
교정되는지는 **한 번 돌려봐야만** 안다. Slack 배선을 먼저 하면, 배선 디버깅과 오버레이 디버깅이
섞여서 원인 분리가 안 된다.

### 0.2 §8 권한 매트릭스는 자격증명 분리 없이는 문서일 뿐

명세 §8은 "builder-bot: PR 머지 권한 미부여"를 규정한다. 그런데 두 봇이 같은 GitHub 토큰을 쓰면
이 줄은 **강제되지 않는다** — 프롬프트로 "머지하지 마"라고 적은 것에 불과하다.
매트릭스의 각 행은 아래 3층 중 하나로 **기계적으로** 강제되어야 한다.

| 층 | 강제 수단 | §8에서 여기 해당하는 행 |
|---|---|---|
| 자격증명 | GitHub App 2개 (또는 fine-grained PAT 2개) — planner는 contents:write만, builder는 contents+PR:write, **머지 권한 없음** | PR 머지 · PR 생성 · 브랜치 생성 · 소스 코드 쓰기 |
| 브랜치 보호 | `main` 브랜치 보호 규칙 + PR 필수 리뷰 | PR 머지 · 프로덕션 배포 |
| Claude Code 권한 | 봇별 `settings.json` 의 `permissions.deny` (planner에서 소스 경로 Edit/Write 차단) | git — 소스 코드 쓰기 |

프롬프트에만 의존하는 행이 남아 있으면 그 행은 지켜지지 않는다고 가정하라.

---

## 1. 페이즈 개요

| Phase | 목표 | 산출물 | 종료 조건 (Exit) | 상태 |
|---|---|---|---|---|
| **0-A** | 환경 복구 | `versions.lock` | browse 실행 가능 + superpowers 요구 버전 | ✅ |
| **0-B** | **손으로 1회전** | 관찰 노트 | 사람이 터미널에서 design-doc→plan→코드→PR 완주 | ⏸ I6 대기 |
| **1** | 오버레이 고정 | `CLAUDE.md`, `overlay/*`, 경로 계약 | 1회전이 **오버레이만으로** 재현됨 | ✅ 작성 / ⏸ 검증 |
| **2** | builder-bot headless | `bin/builder <branch>` | CLI 한 줄로 SDD 완주 → PR | ✅ 작성 / ⏸ 검증 |
| **3** | Slack 배선 | Slack 앱 + 컨트롤러 | 스레드에서 기획→승인→빌드→보고 | ◐ 아웃바운드만 |
| **4** | 데모 파이프라인 | Vercel 프리뷰 + 보고 패킷 | 게이트 ② 성립 (§7 Phase 1) | ◐ 패킷만 |
| **5** | 운영 루프 | Discoveries 승격 배선 | 주간 승격 리뷰 1회 실시 | ⏸ |

> **0-A에서 드러난 사실** — superpowers가 5.0.7 → **6.2.0**(메이저)으로 올라갔다.
> 명세 P5·§6.2·§5.4가 업스트림 실제 동작과 충돌한다. 충돌 처리는 [AMENDMENTS.md](AMENDMENTS.md) A1~A6.
> gstack 스킬 실측으로 §4.1의 사실 오류 2건도 드러났다 (B1·B2).
> **Phase 0-B를 시작하기 전에 AMENDMENTS.md를 읽어라.**

**Phase 2가 Phase 3보다 앞인 이유**: builder-bot은 입력이 브랜치명 하나, 출력이 정형 보고뿐이다(§5.1).
상태 머신도 대화 이력도 필요 없다. 반면 planner-bot은 stateless 재구성(§3.1 D3)에 스레드 이력 주입이
필요하다. **결정론적인 절반을 먼저 자동화하고, 상태 있는 대화 절반을 뒤로 미룬다.**

---

## Phase 0 — 환경 복구 + 손으로 1회전

### 0-A. 환경 (반나절)

```bash
./bootstrap.sh check     # 진단
./bootstrap.sh repair    # gstack 재빌드 + superpowers 업그레이드
./bootstrap.sh pin       # versions.lock 기록
```

실측된 문제 2건:

1. **gstack browse 깨짐** — 컴파일된 바이너리가 `chromium_headless_shell-1208`을 찾는데 캐시에는 1228만 있다.
   → `/browse` `/qa` `/design-review` 전부 실패. **§5.6-3 `visible` 스크린샷이 막히므로 Phase 1 크리티컬 패스다.**
   (명세 §7은 `/qa`를 Phase 2로 미뤘지만 스크린샷은 Phase 1 항목이다.)
2. **superpowers 5.0.7** — 명세 P5는 5.1.x 인라인 self-review 기준. 업그레이드 필요.

**P4 대응 — 업그레이드와 재현성의 충돌**
P4는 "fork하지 않고 원본 유지", P5는 "최신 인라인 self-review 사용"이다. 둘을 동시에 지키면
업스트림이 조용히 루프를 바꿔도 봇 동작이 따라 변한다. 그래서:

- 봇 호스트는 gstack을 **`--no-team`(자동 업데이트 끔)** 으로 설치한다. team 모드의 시간당 자동 업데이트 체크는 개발자 노트북에는 좋지만 봇에는 재현성 폭탄이다.
- `versions.lock`에 sha를 기록하고, 업그레이드는 **의도적 이벤트**로만 수행한다 (업그레이드 후 Phase 1 회귀 1회전 필수).

### 0-B. 손으로 1회전 (2~3일)

대상: **CVC/DCX의 가장 작은 `visible` 기능 1개.** 봇 없이, 본인 터미널에서, 명세의 흐름을 그대로 밟는다.

```
/office-hours          → design-doc 초안
/plan-ceo-review       → 전제·스코프 도전
/plan-eng-review       → 아키텍처 결정 추가
/writing-plans         → 태스크 분해 (태깅은 이번엔 손으로)
(SDD 루프 수동 실행)   → TDD + 인라인 self-review + 커밋
gh pr create           → PR
```

**이 회전의 목적은 기능 완성이 아니라 관찰이다.** 아래를 반드시 기록한다 — Phase 1 오버레이의 입력이 된다.

| 관찰 항목 | 왜 |
|---|---|
| 각 스킬이 파일을 **어디에** 썼는가 (실제 경로) | §4.1 경로 계약을 오버레이로 강제할 수 있는지 판정 |
| gstack이 CLAUDE.md에 **자동 삽입한 블록**의 정확한 내용 | §3.3에서 제거·대체할 대상 |
| `office-hours`가 질문을 **한 번에 몇 개** 던졌는가 | §3.2 "한 번에 1개" 규칙이 오버레이로 되는지 |
| `writing-plans`가 태스크를 몇 분 단위로 쪼갰는가 | 2~5분 목표와의 격차 |
| 스킬 라우팅이 **충돌한 지점** (superpowers brainstorming vs office-hours) | §3.3 dispatcher 규칙의 실제 필요성 |
| 사람이 개입해야만 넘어간 지점 | headless 전환 시 BLOCKED 될 후보 (§6.1) |

**Exit** — PR 하나가 열렸고, 위 표가 채워졌다.

---

## Phase 1 — 오버레이 고정

Phase 0 관찰 노트를 오버레이로 굳힌다. 코드는 아직 없다. 전부 마크다운/설정이다.

### 1-A. 봇 레포 초기화

`engineer-bot/`이 아직 git 레포가 아니다. 먼저:

```
engineer-bot/
├── planner-builder-bot-spec.md      # 명세 (기존)
├── BUILD-PLAN.md                    # 이 문서
├── bootstrap.sh  versions.lock      # 환경
├── overlay/
│   ├── CLAUDE.planner.md            # planner-bot 주입 오버레이
│   ├── CLAUDE.builder.md            # builder-bot 주입 오버레이
│   └── skills/                      # 커스텀 스킬 (원본 fork 금지 — P4)
└── controller/                      # Phase 2~3
```

### 1-B. 라우팅 소유권 회수 (P6 · §3.3)

1. gstack이 자동 삽입한 라우팅 블록을 **삭제**한다 (Phase 0에서 원문 확보).
2. 그 자리에 §3.3의 기계적 규칙 하나만 남긴다:

```
IF   docs/plans/<branch>/design-doc.md 존재
THEN superpowers brainstorming 발화 금지 → writing-plans 직행
ELSE 신규 기획 요청 → /office-hours
```

판정은 **파일 존재 여부**로만. LLM 판단 라우팅을 넣지 않는다.

### 1-C. 경로 계약 강제 (§4.1)

gstack 기본 산출 경로 `~/.gstack/projects/`를 레포 내 `docs/plans/<branch-slug>/`로 돌린다.
Phase 0 관찰 결과에 따라 셋 중 하나:

| 수단 | 조건 | 비고 |
|---|---|---|
| `~/.gstack/config.yaml` 설정 | 경로 설정 키가 존재하면 | 가장 깔끔 |
| 심링크 | 설정 키가 없으면 | 브랜치별 경로라 심링크 재지정이 매 브랜치 필요 → 컨트롤러가 수행 |
| 오버레이 프롬프트 지시 | 위 둘이 안 되면 | 가장 약함. self-review 체크리스트에 경로 검증 추가 필수 |

**심링크/설정 어느 쪽이든, 두 봇이 같은 파일을 보는지 Phase 2 시작 전에 실측 확인한다.**

### 1-D. writing-plans 오버레이 — 2축 태깅 (§3.4)

원본 스킬을 수정하지 않고(P4), 오버레이로 다음을 강제:

- 모든 태스크에 `verification`(deterministic/generative) + `validation`(visible/invisible) 태그 필수
- 모호하면 `deterministic` (엄격한 쪽 기본값)
- `invisible` 태스크에 "테스트로 증명할 것" 목록이 없으면 self-review에서 반려
- 골든셋 부재 시 폴백: 구조 assert만 수행 + `DONE_WITH_CONCERNS` 보고 (§3.4 각주, D4)

**Exit** — Phase 0에서 손으로 한 1회전이, 오버레이만 주입한 세션에서 **사람 개입 없이 같은 산출**을 낸다.
(같은 기능을 브랜치 새로 따서 다시 돌려 비교한다. 이게 Phase 1의 유일한 합격 기준이다.)

---

## Phase 2 — builder-bot headless (Slack 없음)

입력 브랜치명 하나, 출력 PR 하나. Slack은 아직 붙이지 않는다.

### 2-A. 인프라 결정 (아래 §3 결정 테이블 참조)

호스트·자격증명·상태 저장소를 여기서 확정한다.

### 2-B. `bin/builder <branch>` — **SDD 루프를 재구현하지 않는다**

> ⚠️ **이 절은 초안에서 수정됐다.** 초안은 컨트롤러가 태스크를 큐잉하고 태스크마다
> `claude -p`를 디스패치하며 §5.3 신호를 파싱한다고 썼다. superpowers 6.2.0을 실측한 결과
> **그 전부가 이미 `subagent-driven-development` 스킬 안에 있다** — ledger, resume,
> task-brief 추출, review-package 생성, 5라운드 수정 루프, 모델 선택, 4신호 처리.
> 재구현은 사실상 fork이고 명세 P4 위반이다.

컨트롤러의 책임은 SDD **바깥**의 5가지로 줄어든다 (`controller/builder.ts`):

1. **계약 검증** (§4.3) — `design-doc.md`·`plan.md` 필수 섹션 + 태스크 헤딩 형식(B4) + 2축 태그. 실패 시 빌드 **시작 전** `REJECTED`
2. **headless 세션 기동** — 오버레이 주입(`--append-system-prompt`) + 권한 파일(`--settings`)
3. **바깥 벽** — 세션 타임아웃. 명세 §6.2의 "무한 루프 방지" 의도가 여기로 옮겨진다 (AMENDMENTS A2)
4. **외부 보고 수확** — `build-result.json` 파싱·검증
5. **정직한 결론** — 보고가 없거나 깨지면 `BLOCKED`. 성공이 아니다

**§5.3 신호는 컨트롤러가 볼 수 없다.** 그 4신호는 implementer 서브에이전트 → SDD 컨트롤러(=세션 자신)
방향이고, `builder.ts`는 세션 **바깥**에 있다. 그래서 계약이 2층이다 (AMENDMENTS A6):

| 층 | 방향 | 형식 | 누가 정의 |
|---|---|---|---|
| 내부 | implementer → SDD | `DONE`/`DONE_WITH_CONCERNS`/`NEEDS_CONTEXT`/`BLOCKED` | 업스트림 (건드리지 않음) |
| **외부** | 세션 → 컨트롤러 | `build-result.json` (JSON 스키마) | 우리 (`contract.ts`) |

`claude -p` stdout을 grep하지 않는다. 파일 + 스키마가 유일하게 견고한 경계다.
파싱 실패는 `BLOCKED` — 조용히 성공으로 넘기지 않는다.

**Exit** — `bin/builder feature/<slug>` 한 줄로 Phase 1의 기능이 PR까지 완주. 사람 개입 0회.

**현재까지 검증된 범위** (2026-07-30):

- ✅ 단위 테스트 93개 통과 (`bun test`)
- ✅ 계약 게이트가 태깅 누락·헤딩 형식 위반·번호 불연속을 **빌드 시작 전에** 잡는다 (픽스처 레포 실행 확인)
- ✅ 경로 정규화(`materialize`)가 gstack 명명 → 계약 경로로 동작하고 멱등하다
- ✅ 심링크 배선이 왕복 쓰기로 확인된다
- ✅ 브랜치 가드 — `main`/`master` 및 브랜치 불일치를 거부
- ❌ **실제 `claude -p` 세션으로 플랜을 완주한 적 없음** — Phase 0-B (I6 대기)

---

## Phase 3 — Slack 배선

### 3-A. 아웃바운드 먼저 (반나절)

builder-bot의 §5.6 보고 패킷을 Slack에 게시. Incoming webhook만 필요 — 이벤트 수신 없음.
**이것만으로도 팀에게 즉시 가치가 있다** (빌드 결과가 스레드에 남는다).

### 3-B. 인바운드 — planner-bot (수일)

이쪽이 진짜 작업량이다.

- Slack 앱: Socket Mode 권장 (공개 엔드포인트 불필요 → 사내 호스트에 그대로 둘 수 있음)
- 이벤트: `app_mention` (스레드 내), `message.channels` (스레드 답글)
- **stateless 재구성** (§3.1 D3): 사람 응답마다 새 `claude -p` 세션 + ① 스레드 전체 이력 ② 브랜치 design-doc 현재 상태 ③ 상태 머신 값 주입
- 상태 저장소: `스레드 ts ↔ 브랜치 ↔ 상태` (§2). 상태 전이를 스레드에 한 줄 게시.
- `PLAN_READY` 72시간 무응답 → 리마인드 1회 → `STALE` (자동 진행 금지, §2)

### 3-C. 게이트 ① 배선 (§3.5)

- 사람의 **명시 발화**만 builder 기동. planner는 builder를 호출할 수 없다.
- 승인 발화에 브랜치명 자동 첨부 — builder의 유일한 입력.
- **검증 방법**: planner-bot 프로세스에 builder 기동 경로가 존재하지 않음을 코드로 확인한다 (프롬프트 금지로 대체하지 않음).

**Exit** — Slack 스레드에서 기획 → 승인 → 빌드 → 보고가 한 바퀴 돈다.

---

## Phase 4 — 데모 파이프라인 (§7 Phase 1)

1. PR 트리거 → **Vercel 프리뷰** 자동 배포 (D2)
2. `visible` 태스크 스크린샷 캡처 (browse — Phase 0에서 고쳐둔 것)
3. 보고 패킷 포맷 (§5.6)
4. `invisible`-only 변경이면 데모 URL 대신 **테스트 케이스 목록을 전면에**

⚠️ **프리뷰 URL은 기본 공개 접근이다** (D2 기록됨). 사내 데이터가 붙는 화면이 생기는 시점에
Vercel 배포 보호(유료) 활성화. Phase 4 착수 시 "이번 기능에 사내 데이터가 뜨는가"를 먼저 판정한다.

**Exit** — 게이트 ②가 성립. 사람이 데모 보고 머지한다. 봇은 머지하지 않는다.

---

## Phase 5 — 운영 루프

- Discoveries → `product-brain :discoveries` **draft 착지** (§5.5). 기존 draft→리뷰 게이트 재사용.
- **주간 승격 리뷰**: 윤호(CTO), 금요일 15분 고정 (D1). 기준 — 2회 이상 등장했거나 태스크를 확실히 망가뜨리는 것만. 일회성 폐기.
- published된 규율성 항목은 CLAUDE.md rule로 반영 → 다음 빌드부터 자동 적용.

---

## 3. 결정 테이블 — Phase 2 착수 전 확정 필요

명세에 없는 항목들이다. 각 행에 내 권고를 적었다.

| # | 항목 | 선택지 | 권고 | 근거 |
|---|---|---|---|---|
| I1 | 봇 호스트 | ① 사내 상시 맥미니 ② 클라우드 VM(Linux) ③ 각자 노트북 | **①  맥미니** (초기) | Claude Code 인증·gstack browse·Vercel CLI가 다 검증된 환경. Phase 3 이후 트래픽 늘면 ②로 이전 |
| I2 | Claude Code 인증 | ① API 키 ② OAuth 토큰(구독) | 팀 사용량 보고 **① API 키** | headless 세션이 다수 병렬. 사용량 추적·한도 관리가 봇에는 필수 |
| I3 | Slack 수신 | ① Socket Mode ② Events API(공개 엔드포인트) | **① Socket Mode** | 사내 호스트에 공개 엔드포인트를 노출하지 않아도 됨 |
| I4 | 상태 저장소 (§2) | ① SQLite 파일 ② git 트래킹 JSON ③ Redis | **① SQLite** | 단일 호스트·동시성 낮음. git 트래킹은 봇 커밋이 이력을 오염시킴 |
| I5 | GitHub 자격증명 | ① 공유 PAT 1개 ② **planner/builder 분리 2개** | **② 분리 2개** | §8 매트릭스를 기계적으로 강제하는 유일한 방법 (§0.2) |
| I6 | Phase 0 대상 기능 | CVC 또는 DCX의 작은 visible 기능 1개 | **미정 — 지정 필요** | `visible`이어야 게이트 ② 경로까지 검증됨 |

I6만 진행을 막는다 — Phase 0-B를 시작할 수 없다. 나머지는 Phase 2 전까지 결정하면 된다.

---

## 4. 리스크

| 리스크 | 신호 | 대응 |
|---|---|---|
| 오버레이가 원본 스킬을 못 이긴다 (P4의 대가) | Phase 1 재현 실패 — 스킬이 오버레이 지시를 무시 | fork 대신 **커스텀 스킬 신규 작성**으로 대체. 원본은 참조만 (`overlay/skills/`) |
| superpowers 업스트림 변경이 빌드 루프를 깨뜨림 | 업그레이드 직후 SDD 완주율 하락 | `versions.lock` 롤백 + 업그레이드 시 Phase 1 회귀 1회전 의무화 |
| 신호 파싱 실패가 조용히 `DONE`으로 처리됨 | PR에 미완성 태스크 포함 | 구조화 출력 강제 + 파싱 실패=`BLOCKED` (§2-B) |
| 개발자 없는 팀에서 BLOCKED가 자주 뜬다 | 게이트 ①~② 사이 대기 시간 증가 | Phase 0 관찰 노트의 "사람 개입 지점"을 오버레이로 선제 흡수 |
| 프리뷰 URL로 사내 데이터 노출 | 내부 데이터 붙는 화면 첫 배포 | Phase 4 착수 시 판정 → 필요하면 배포 보호 먼저 |

---

## 5. 다음 액션

1. ~~`./bootstrap.sh repair` → `pin`~~ ✅ 완료 (browse 수리, superpowers 6.2.0, `versions.lock`)
2. ~~레포 골격 + 오버레이 + 컨트롤러~~ ✅ 완료 (단위 테스트 93개)
3. **I6 결정** — Phase 0-B 대상 기능 1개 지정 ← **막고 있는 유일한 항목**
4. Phase 0-B 1회전 → 관찰 노트 작성 → 오버레이 교정

### I6 결정 후 실행 순서

```bash
# 제품 레포에서 (한 번만)
bin/setup-paths.sh

# 기획 — 사람이 직접, 봇 없이
git checkout -b feature/<slug>
# /office-hours → /plan-ceo-review → /plan-eng-review
bun controller/materialize.ts feature/<slug>      # gstack 산출 → 계약 경로
# superpowers:writing-plans (+ overlay/writing-plans-tagging.md)

# 계약 검증 — 빌드 전에 반드시
TARGET_REPO=<repo> bin/builder feature/<slug> --dry-run

# 통과하면 실제 빌드
TARGET_REPO=<repo> bin/builder feature/<slug>
```

### 1회전에서 관찰할 것 (오버레이 교정의 입력)

Phase 0-B의 원래 관찰 표(§Phase 0-B)에 더해, 6.2.0 전환으로 새로 생긴 항목:

| 관찰 항목 | 판정할 것 |
|---|---|
| 리뷰어 서브에이전트가 태스크당 실제로 얼마나 걸리는가 | AMENDMENTS A1 재논의 필요 여부 (P5 폐기의 대가 측정) |
| SDD가 `## Setup` 사전 스캔에서 실제로 사람에게 물으려 했는가 | A3 변환 규칙이 오버레이만으로 먹히는지 |
| 서브에이전트 디스패치에 model이 실제로 명시됐는가 | A4 하드 룰의 실효성 — 누락되면 비용이 조용히 튄다 |
| `build-result.json`이 실제로 쓰였는가 | A6 외부 계약이 지켜지는지. 안 쓰이면 컨트롤러가 BLOCKED로 처리한다 |
| discoveries가 워크스페이스가 아니라 계약 경로에 쌓였는가 | A5 |
