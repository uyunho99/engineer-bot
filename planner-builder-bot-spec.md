# planner-bot · builder-bot 명세

> **목표** — engineer-bot을 상호작용 모드 기준으로 두 봇으로 분리한다.
> planner-bot은 Slack 스레드에서 사람과 티키타카하며 기획을 완성하고,
> builder-bot은 승인된 플랜을 받아 사람 개입 없이 SDD 루프를 완주해 PR로 끝낸다.
>
> **상위 문서** — 「하네스 구축 방법론: gstack 기획 + superpowers 개발 루프」 · agent-org-graph
> **작성** 2026-07-23 · superpowers v5.1.x(인라인 self-review) 기준 · **미결 질문 4건 결정 완료 (§10 결정 기록)**

---

## 0. 설계 원칙

| # | 원칙 | 근거 |
|---|---|---|
| P1 | **분리 기준 = 상호작용 모드.** 대화형(planner) vs headless(builder). 직무(기획/개발)가 아니다 | office-hours는 멀티턴 문답이 본체, SDD는 무정지 완주가 본체 — 요구하는 실행 환경이 다름 |
| P2 | **권한은 상보적.** planner는 코드 쓰기 없음, builder는 자유 발화 없음(정형 보고만) | 최소 권한 · 봇 오작동 시 피해 범위 격리 |
| P3 | **사람 게이트 2개.** ① 플랜 승인(planner→builder 핸드오프) ② PR 머지(데모+테스트 확인 후) | SDD는 안 멈추므로, 넘기는 순간과 머지가 유일한 안전장치 |
| P4 | **superpowers는 fork하지 않는다.** 원본 플러그인 유지 + CLAUDE.md·커스텀 스킬 오버레이 | 업스트림이 빠르게 변함(5.0.x→5.1.0) — rebase 비용 회피 |
| P5 | **리뷰는 최신 구조(인라인 self-review + Spec Self-Review 체크리스트).** 별도 리뷰어 서브에이전트 2단 루프는 사용하지 않음 | 업스트림 회귀 테스트: 2단 서브에이전트 리뷰는 실행시간 ~2배, 품질 개선 미측정 |
| P6 | **라우팅 소유권은 CLAUDE.md 한 곳.** gstack·superpowers의 자체 라우팅 지침은 비활성화하고 우리 라우팅 테이블만 살린다 | 두 플러그인이 같은 트리거를 자기 기획 스킬로 가져가는 충돌 방지 |
| P7 | **파일이 단일 진실.** design-doc·plan은 레포 안 고정 경로. Slack 메시지로 문서 내용을 전달하지 않는다 | 핸드오프 계약이 봇 경계를 넘으므로 |

### 비목표 (Non-Goals)
- 사람에 의한 코드 리뷰 — 팀에 개발자가 없다는 전제. 검증은 테스트(기계) + 데모(사람)로 대체
- 사람에 의한 태스크 태깅 — 태깅은 writing-plans 단계에서 에이전트가 수행 (§3.4)
- 자동 머지·자동 배포(프로덕션) — PR self-merge 금지, 프로덕션 배포는 사람
- 구버전 superpowers의 spec-reviewer/code-quality-reviewer 서브에이전트 복원
- Phase 1에서의 /qa(에이전트 브라우저 QA) — Phase 2로 연기 (§7)
- **골든셋 구축·관리** — 에이전트 출력 품질 트랙에서 별도 관리 (§10 D4). 본 명세는 골든셋이 존재할 때의 사용 규칙과 부재 시 폴백만 정의

---

## 1. 전체 흐름

```
Slack #dcx-개발
│
│  사람: @planner-bot 새 기능 스레드 시작
▼
[planner-bot · 대화형]
  office-hours ──── 소크라테스 문답 (스레드 티키타카)
       │ design-doc.md
  plan-ceo-review ─ 스코프·전제 도전 (질문 있으면 스레드로)
       │
  plan-eng-review ─ 아키텍처 검토
       │
  writing-plans ─── 2~5분 태스크 분해 + 태깅 (headless, 결과만 스레드 게시)
       │ plan.md
       ▼
  ⛔ 게이트 ①  사람이 스레드에서 명시 승인 ("@builder-bot 이 플랜으로 빌드해")
       │            자동 트리거 금지
       ▼
[builder-bot · headless]
  SDD 루프: fresh subagent/태스크 → TDD → 인라인 self-review → 커밋
  Project Discoveries 누적·주입
       │ 전 태스크 통과
       ▼
  PR 생성 + 프리뷰 배포 + 스크린샷
       ▼
  Slack 보고 패킷: [PR 링크 · 데모 URL · 스크린샷 · 테스트 결과]
       ▼
  ⛔ 게이트 ②  사람이 데모 확인 → 머지 (봇은 머지하지 않음)
```

---

## 2. 세션 모델 — 스레드 = 세션 = 문서 = 브랜치 (1:1:1:1)

| 대상 | 규칙 |
|---|---|
| Slack 스레드 | 기능 하나당 스레드 하나. 스레드 최상단 메시지가 세션의 앵커 |
| git 브랜치 | 스레드 시작 시 planner-bot이 `feature/<slug>` 생성. slug는 스레드 첫 메시지에서 유도 |
| design-doc / plan | 해당 브랜치에만 존재 (§4 경로 계약). gstack plan-ceo-review가 문서를 **브랜치 단위**로 찾는 특성과 정합 |
| 세션 상태 | planner-bot이 `스레드 ts ↔ 브랜치 ↔ 상태` 매핑을 유지 (KV 저장) |

**상태 머신** (planner-bot 세션):

```
DRAFTING → CEO_REVIEW → ENG_REVIEW → PLAN_READY → APPROVED → BUILDING → PR_OPEN → MERGED
                                          │                       │
                                       REJECTED ◀── (빌드 중 플랜 결함 발견 시 반송, §6.3)
```

- 상태 전이는 스레드에 한 줄로 게시한다 (`▸ ENG_REVIEW 진입 — 아키텍처 검토 중`).
- `PLAN_READY`에서 72시간 무응답 시 리마인드 1회, 이후 `STALE` 표기 (자동 진행 금지).

---

## 3. planner-bot 명세

### 3.1 정체·환경
- 채널: `#dcx-개발` (스레드 안에서만 동작)
- 실행: **stateless 재구성 (확정 — §10 D3).** 사람 응답마다 새 세션을 띄우고 ① 스레드 전체 이력 ② 브랜치의 design-doc 현재 상태 ③ 상태 머신 값(§2)을 주입해 문맥을 복원한다. 상시 세션은 유지하지 않는다 — 진실은 스레드 이력과 git 파일에 있고(P7), 세션은 소모품이다
- 이식 스킬: gstack `office-hours` · `plan-ceo-review` · `plan-eng-review` + superpowers `writing-plans`
- **plan-eng-review 포함 이유**: 아키텍처 검토 층을 비우면 아키텍처 결정이 writing-plans(태스크 분해기)에 암묵 위임됨 — 그 스킬의 용도가 아님

### 3.2 워크플로 단계별 규칙

| 단계 | 모드 | 규칙 |
|---|---|---|
| office-hours | 대화형 | 질문은 **한 번에 1개**씩 스레드에 게시. 사람 응답으로 다음 질문. 완료 시 design-doc.md 커밋 |
| plan-ceo-review | 반대화형 | 전제 도전·스코프 판정. 사람 확인이 필요한 항목만 스레드로 질문, 나머지는 자체 진행 |
| plan-eng-review | 반대화형 | 아키텍처·leverage 체크. 결과를 design-doc에 추가 커밋 |
| writing-plans | headless | design-doc을 입력으로 태스크 분해 + 태깅(§3.4). plan.md 커밋 후 **요약(태스크 수·태그 분포·예상 검증 방식)을 스레드에 게시**하고 승인 대기 |

### 3.3 브레인스토밍 우회 (dispatcher 규칙)

CLAUDE.md 라우팅 테이블에 단일 규칙으로 고정:

```
IF   docs/plans/<branch>/design-doc.md 존재
THEN superpowers brainstorming 스킬 발화 금지 → writing-plans 직행
ELSE 신규 기획 요청은 /office-hours로 라우팅 (superpowers brainstorming 사용 안 함)
```

- 판정 조건은 **파일 존재 여부**(기계적)로만. LLM 판단 라우팅 최소화.
- gstack이 CLAUDE.md에 자동 삽입하는 자체 라우팅 블록은 설치 후 삭제하고 위 테이블로 대체 (P6).

### 3.4 태스크 태깅 규칙 — **에이전트가 수행, 사람 개입 없음**

writing-plans 프롬프트 오버레이에 다음을 명시한다. 모든 태스크는 2축 태그 필수:

**축 1 — 검증 방법 (verification)**

| 태그 | 대상 | 검증 방식 |
|---|---|---|
| `deterministic` | API · 크롤 · UI 로직 · 데이터 처리 등 입출력이 확정적인 코드 | TDD 강제 (red-green-refactor, Iron Law) |
| `generative` | 키워드 발산 · 페르소나 등 비결정적 생성 로직 | 골든셋 / 스냅샷 검증 (구조·범위·금지어 assert) |

> **골든셋 폴백**: 레포에 해당 기능의 골든셋이 없으면 builder-bot은 구조 assert(스키마·개수 범위·금지어)만 수행하고, 해당 태스크를 `DONE_WITH_CONCERNS`로 보고해 검증 공백을 패킷에 명시한다. 골든셋 구축 자체는 별도 품질 트랙 (§10 D4).

**축 2 — 가시성 (validation)**

| 태그 | 대상 | 사람 게이트에서의 확인 수단 |
|---|---|---|
| `visible` | UI · 화면에 드러나는 변경 | 프리뷰 데모 + 스크린샷 |
| `invisible` | 백엔드 로직 · 스키마 · 배치 | **테스트 커버리지가 전부** — plan에 커버해야 할 케이스 목록 명기 |

- **모호하면 `deterministic`으로** (더 엄격한 쪽 기본값).
- `invisible` 태스크는 plan.md에 "테스트로 증명할 것" 목록이 없으면 writing-plans self-review에서 반려.

### 3.5 게이트 ① — 핸드오프 승인
- `PLAN_READY` 게시 후, **사람의 명시 발화**(`@builder-bot 이 플랜으로 빌드해` 또는 승인 버튼)만이 builder-bot을 기동한다.
- planner-bot은 builder-bot을 직접 호출할 수 없다 (자동 트리거 금지).
- 승인 발화에는 브랜치명이 자동 첨부된다 — builder-bot의 유일한 입력.

---

## 4. 핸드오프 계약 (Handoff Contract)

### 4.1 경로 (브랜치별 고정)

```
docs/plans/<branch-slug>/
├── design-doc.md      # office-hours + ceo/eng-review 산출
├── plan.md            # writing-plans 산출 (태그 포함)
└── discoveries.md     # builder-bot이 세션 중 기록 (§5.5)
```

- gstack 기본 경로(`~/.gstack/projects/`)는 **레포 내 경로로 심링크 또는 설정 변경** — 두 봇이 같은 파일을 봐야 하므로 홈 디렉터리 산출 금지.

### 4.2 포맷 필수 섹션

**design-doc.md**: 문제 정의 · 전제(도전 결과 포함) · 스코프 / 비스코프 · 제약 · 수용 기준 · 아키텍처 결정(eng-review 산출)

**plan.md**: 태스크 목록 — 각 태스크에 `[id] [verification 태그] [validation 태그] 파일 경로 · 완료 정의 · (invisible이면) 테스트 케이스 목록`

### 4.3 계약 위반 처리
- builder-bot은 기동 시 두 파일의 필수 섹션을 스키마 체크. 누락 시 **빌드 시작 전** `REJECTED` + 스레드에 누락 항목 게시 → planner 세션으로 반송.
- 태스크 디스패치는 **풀텍스트 주입**(파일 참조 아님) — 단계 간 핸드오프(파일)와 다른 메커니즘임을 유지.

---

## 5. builder-bot 명세

### 5.1 정체·환경
- 실행: headless Claude Code 세션. 발화는 §5.6 정형 보고와 §6 에스컬레이션만.
- 입력: 승인된 브랜치명 하나. 그 외 입력 없음.
- 기반: superpowers 최신 (subagent-driven-development · TDD · 인라인 self-review), 프롬프트 오버레이로 회사 컨벤션 주입.

### 5.2 SDD 루프
1. plan.md의 태스크를 순서대로 큐잉 (완료 게이트 통과해야 다음).
2. 태스크마다 **fresh subagent** 디스패치 — 태스크 풀텍스트 + 누적 Discoveries 주입.
3. 태그별 검증: `deterministic` → 실패 테스트 먼저(Iron Law), `generative` → 골든셋/스냅샷.
4. **인라인 self-review + Spec Self-Review 체크리스트** 통과 시 커밋. (별도 리뷰어 서브에이전트 없음 — P5)
5. self-review 실패 → 같은 subagent가 수정 후 재검, **3회 실패 시 `BLOCKED`** (§6.1).

### 5.3 상태 신호 처리

| 신호 | 컨트롤러 동작 |
|---|---|
| `DONE` | 다음 태스크 |
| `DONE_WITH_CONCERNS` | 진행하되 concern을 discoveries.md에 기록, 최종 보고 패킷에 포함 |
| `NEEDS_CONTEXT` | Discoveries·design-doc에서 컨텍스트 보강해 1회 재디스패치. 재실패 시 `BLOCKED` |
| `BLOCKED` | §6.1 에스컬레이션 |

### 5.4 모델 선택 정책

| 태스크 성격 | 모델 |
|---|---|
| 기계적 1~2파일 수정 | 저비용 모델 |
| 멀티파일 통합 | 표준 모델 |
| 아키텍처 관련 · self-review | 최상위 모델 |

### 5.5 Project Discoveries → 승격 루프
- 세션 내: subagent 보고의 Discoveries 필드를 discoveries.md에 누적, 이후 subagent마다 주입.
- **세션 종료 시**: 반복 가능성 있는 항목만 골라 `product-brain :discoveries`에 **draft로 착지** → 기존 draft→리뷰 게이트를 그대로 재사용. published된 규율성 항목은 CLAUDE.md rule로 반영.
- **승격 리뷰 (확정 — §10 D1)**: 주체 윤호(CTO), 주기 주간 금요일 15분 고정. 승격 기준 — "2회 이상 등장했거나, 등장 시 태스크를 확실히 망가뜨리는 것"만. 일회성은 폐기.

### 5.6 완료 시퀀스 (게이트 ② 준비)
1. 전 태스크 통과 → PR 생성. **self-merge 금지** — 머지 권한 자체를 부여하지 않음.
2. PR 트리거로 **Vercel 프리뷰 배포** (확정 — §10 D2, §7 Phase 1).
3. `visible` 태스크의 화면 스크린샷 캡처.
4. **Slack 보고 패킷** — 스레드에 게시:

```
✅ 빌드 완료 — feature/<slug>
🔗 PR: <url>            🌐 데모: <preview-url>
🖼 스크린샷 N장          🧪 테스트: M/M pass (커버 케이스 목록 링크)
⚠ concerns: (있으면)     👉 데모 확인 후 직접 머지해주세요. 저는 머지하지 않습니다.
```

- `invisible`-only 변경이면 데모 URL 대신 **테스트 케이스 목록과 결과를 전면에** 배치 (보이는 건 데모로, 안 보이는 건 테스트로).

---

## 6. 실패 처리

### 6.1 BLOCKED 에스컬레이션
- builder-bot의 유일한 자유 발화 지점. 스레드에 `⛔ BLOCKED — 태스크 [id], 사유, 시도 내역 3줄` 게시 후 **대기** (임의 우회 금지).
- 사람 지시로 재개 / 태스크 스킵 / 세션 중단 중 택일.

### 6.2 리뷰 반복 한도
- 태스크당 self-review 재시도 3회. 초과 시 BLOCKED. (무한 루프 방지)

### 6.3 플랜 결함 발견 시 — 반송, 현장 수정 금지
- 빌드 중 "플랜 자체가 틀렸다"고 판정되면 builder-bot은 **플랜을 고치지 않는다.** 세션을 `REJECTED`로 전환하고 결함 요약과 함께 planner 스레드로 반송 → 사람 + planner-bot이 플랜 수정 → 게이트 ① 재승인 후 재빌드.
- 근거: SDD는 틀린 플랜도 끝까지 완주하는 도구다. 플랜 수정 권한을 builder에 주면 게이트 ①이 무력화된다.

---

## 7. 데모 파이프라인 (단계적)

| Phase | 범위 | 비고 |
|---|---|---|
| **1** | PR → **Vercel** 프리뷰 자동 배포 + `visible` 스크린샷 + 보고 패킷 | /qa 없이. 이것만으로 게이트 ②가 성립. ⚠ 프리뷰 URL은 기본 공개 접근 — 내부 데이터가 붙는 화면이 생기면 Vercel 배포 보호(유료) 활성화 검토 |
| **2** | gstack `/qa` 통합 — 에이전트 브라우저 테스트 결과를 패킷에 추가 | /qa는 로컬 브라우저·쿠키 전제라 봇 서버 환경 손질 필요 (headless Chromium · 쿠키 의존 제거) |

---

## 8. 권한 매트릭스

| 권한 | planner-bot | builder-bot |
|---|---|---|
| Slack 자유 발화 (스레드 내) | ● | ○ (정형 보고 · BLOCKED만) |
| git — docs/plans/** 쓰기 | ● | ◐ (discoveries.md만) |
| git — 소스 코드 쓰기 | ○ | ● (feature 브랜치 한정) |
| 브랜치 생성 | ● | ○ |
| PR 생성 | ○ | ● |
| PR 머지 | ○ | ○ (**권한 미부여**) |
| 프리뷰 배포 | ○ | ● (자동 트리거) |
| 프로덕션 배포 | ○ | ○ |
| product-brain 쓰기 | ○ | ◐ (:discoveries draft만) |
| 서로 호출 | ○ (게이트 ① 사람 경유) | ○ |

---

## 9. 구축 체크리스트

- [ ] superpowers 원본 설치 (fork 아님) + CLAUDE.md 오버레이 골격 생성
- [ ] gstack에서 office-hours · plan-ceo-review · plan-eng-review 이식, 산출 경로를 레포 내 `docs/plans/<branch>/`로 변경
- [ ] gstack 자동 삽입 라우팅 블록 제거 → §3.3 라우팅 테이블로 대체
- [ ] writing-plans 오버레이: 2축 태깅(§3.4) + invisible 테스트 케이스 필수 규칙
- [ ] planner-bot: 스레드↔브랜치↔상태 매핑 저장소 + 상태 머신(§2)
- [ ] 게이트 ① 승인 발화 → builder-bot 기동 배선 (자동 트리거 없음 확인)
- [ ] builder-bot: 계약 스키마 체크(§4.3) · 신호 처리(§5.3) · 재시도 한도(§6.2)
- [ ] PR → Vercel 프리뷰 배포 연결 + 보고 패킷 포맷(§5.6) — 프리뷰 URL 접근 정책 확인
- [ ] Discoveries → product-brain draft 착지 배선(§5.5) + 윤호 주간 승격 리뷰(금) 일정 등록
- [ ] **CVC/DCX의 작은 visible 기능 1개로 끝까지 1회전** → 끊기는 지점 관찰 → 오버레이로 굳힘

---

## 10. 결정 기록 (Decision Log) — 2026-07-23 확정

| # | 항목 | 결정 | 반영 위치 |
|---|---|---|---|
| D1 | Discoveries 승격 리뷰 | **윤호(CTO) · 주간 금요일 15분.** 기준: 2회 이상 등장 또는 태스크를 확실히 망가뜨리는 것만 승격, 일회성 폐기 | §5.5 |
| D2 | 프리뷰 배포 플랫폼 | **Vercel.** 프리뷰 URL 기본 공개 접근 — 내부 데이터 화면 발생 시 배포 보호(유료) 검토 | §5.6 · §7 · §9 |
| D3 | planner-bot 세션 방식 | **stateless 재구성 확정.** 상시 세션 없음 — 스레드 이력 + design-doc + 상태 머신 값으로 매 응답 시 재수화 | §3.1 |
| D4 | 골든셋 구축·관리 | **본 명세 범위에서 제외** — 에이전트 출력 품질 트랙에서 별도 관리. 명세에는 골든셋 부재 시 폴백 규칙(구조 assert + `DONE_WITH_CONCERNS`)만 유지 | §0 비목표 · §3.4 |

미결 질문 없음 — 구현 착수 가능.
