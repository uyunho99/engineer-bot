# engineer-bot

planner-bot · builder-bot 하네스 레포. 명세는 [planner-builder-bot-spec.md](planner-builder-bot-spec.md),
명세와 업스트림의 충돌 처리는 [AMENDMENTS.md](AMENDMENTS.md), 구축 순서는 [BUILD-PLAN.md](BUILD-PLAN.md).

**이 레포는 봇의 하네스다. 봇이 빌드하는 제품 코드가 아니다.** 여기서 작업할 때는 컨트롤러·오버레이·계약을 다룬다.

## Skill routing

> ⚠️ **이 섹션은 gstack이 자기 라우팅 블록을 삽입하지 않도록 선점한 것이다** (AMENDMENTS.md B3).
> `plan-ceo-review`는 `grep -q "## Skill routing" CLAUDE.md` 로만 판정하고 내용은 보지 않는다.
> **헤딩 문자열 `## Skill routing` 을 바꾸지 마라.** 바꾸면 gstack이 자기 테이블을 덧붙이고
> 라우팅 소유권(명세 P6)이 깨진다.

라우팅 소유권은 이 테이블 하나에 있다. gstack·superpowers의 자체 라우팅 지침은 따르지 않는다.

### 기획 라우팅 — dispatcher 규칙 (명세 §3.3)

판정은 **파일 존재 여부**로만 한다. LLM 판단 라우팅을 쓰지 않는다.

```
IF   docs/plans/<branch-slug>/design-doc.md 존재
THEN superpowers:brainstorming 발화 금지 → superpowers:writing-plans 직행
ELSE 신규 기획 요청 → /office-hours   (superpowers:brainstorming 사용 안 함)
```

브랜치 슬러그는 현재 브랜치의 `/`를 `-`로 바꾼 값이다 (`feature/foo` → `feature-foo`).
확인: `bun controller/paths.ts` 또는 `bin/paths`.

### 단계별 스킬

| 요청 | 스킬 | 비고 |
|---|---|---|
| 신규 기능 기획 시작 | `/office-hours` | superpowers:brainstorming 대신 |
| 스코프·전제 도전 | `/plan-ceo-review` | |
| 아키텍처 검토 | `/plan-eng-review` | 입력 = gstack glob 탐색. `bin/setup-paths.sh` 선행 필요 |
| 태스크 분해 | `superpowers:writing-plans` | **[2축 태깅 오버레이](overlay/writing-plans-tagging.md) 필수 적용** |
| 플랜 실행 | `superpowers:subagent-driven-development` | builder-bot 전용. [오버레이](overlay/CLAUDE.builder.md) |
| 버그·에러 조사 | `superpowers:systematic-debugging` | |
| PR 생성 | `superpowers:finishing-a-development-branch` | **머지 금지 · discard 금지** |

### 이 레포에서 쓰지 않는 스킬

| 스킬 | 이유 |
|---|---|
| `superpowers:brainstorming` | `/office-hours`가 기획 담당 (명세 §3.3) |
| `/ship`, `/land-and-deploy` | 봇은 머지·배포하지 않는다 (명세 §8) |
| `/qa`, `/design-review` | 명세 §7 Phase 2로 연기 |
| `/autoplan` | 라우팅 소유권 충돌 — 개별 스킬을 명시 호출한다 |

## 경로 계약 (명세 §4.1 · AMENDMENTS.md B1/B2)

```
docs/gstack/                              gstack 산출 (자유 명명, glob 탐색 유지)
  {user}-{branch}-design-{ts}.md            ← ~/.gstack/projects/engineer-bot 심링크 대상
docs/plans/<branch-slug>/                 계약 경로 (고정 명명)
  design-doc.md                             materialize 결과. builder 입력
  plan.md                                   writing-plans 산출 (2축 태그 포함)
  discoveries.md                            builder 누적 — SDD 워크스페이스에 두지 않는다 (A5)
  build-result.json                         builder 세션 외부 보고 (A6)
```

경로 상수의 단일 진실은 `controller/paths.ts`다. 하드코딩하지 마라.

## 하드 룰

1. **봇은 머지하지 않는다.** PR 생성까지다 (명세 §8). `gh pr merge`를 쓰지 마라.
2. **플랜은 현장에서 고치지 않는다.** 결함 발견 → `REJECTED` 반송 (명세 §6.3 · AMENDMENTS.md A3).
3. **서브에이전트 디스패치 시 모델을 항상 명시한다.** 생략하면 세션 모델(최상위)을 상속해 비용 정책이 무력화된다 (A4).
4. **자유 텍스트 파싱 금지.** 경계는 파일 + JSON 스키마다. 파싱 실패는 성공이 아니라 `BLOCKED`다 (A6).
5. **`git clean -fdx` 금지** — SDD 워크스페이스(ledger)가 날아간다. 복구는 `git log`뿐이다.

## 개발

```bash
bun test                    # 컨트롤러 단위 테스트
./bootstrap.sh check        # 환경 검증
bin/setup-paths.sh          # gstack 경로 심링크 (멱등)
```
