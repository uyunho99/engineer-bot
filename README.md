# engineer-bot

> **보관 브랜치 `legacy`** — 기존 planner/builder의 마지막 통합 상태입니다.
> 현재 기본 브랜치는 `claude-only`이며, Orca 변형은 `orca-orchestration`입니다.
> 2026-09-05 재검증: 타입 검사·테스트 399개·환경 검사 통과.
> 선정 근거와 복구 태그는 [브랜치 보관 기록](docs/BRANCH_ARCHIVE.md)을 참고하세요.

planner-bot · builder-bot 하네스. Slack 스레드에서 기획을 완성하고, 승인된 플랜을
headless로 완주해 PR로 끝낸다.

```
Slack 스레드 ──▶ planner-bot ──▶ ⛔ 게이트 ① 사람 승인 ──▶ builder-bot ──▶ PR ──▶ ⛔ 게이트 ② 사람 머지
              (대화형)                                    (headless)
```

## 문서

| 문서 | 역할 |
|---|---|
| [planner-builder-bot-spec.md](planner-builder-bot-spec.md) | **명세.** 2026-07-23 확정. 무엇을 만드는가 |
| [AMENDMENTS.md](AMENDMENTS.md) | **수정 사항.** 명세와 업스트림(superpowers 6.2.0·gstack) 실제 동작의 충돌 처리. **명세와 충돌하면 이 문서가 우선** |
| [BUILD-PLAN.md](BUILD-PLAN.md) | **구축 순서.** 6페이즈, 페이즈별 종료 조건 |
| [CLAUDE.md](CLAUDE.md) | 이 레포에서 작업할 때의 라우팅·하드 룰 |

## 지금 상태

| Phase | 상태 |
|---|---|
| **0-A** 환경 복구 | ✅ 완료 — `versions.lock` 기록됨 |
| **0-B** 손으로 1회전 | ⏸ **대기 — 대상 기능 1개 지정 필요** (BUILD-PLAN I6) |
| **1** 오버레이 고정 | ✅ 작성 완료 · ⏸ 1회전으로 검증 대기 |
| **2** builder headless | ✅ 컨트롤러 작성 + 단위 테스트 · ⏸ 실제 세션 미검증 |
| **3** Slack 배선 | ◐ 아웃바운드만 (`controller/slack.ts`). 인바운드는 I3 결정 후 |
| **4** 데모 파이프라인 | ⏸ 보고 패킷은 완성. Vercel 연결 미착수 |
| **5** 운영 루프 | ⏸ 미착수 |

**검증된 것과 안 된 것을 구분해서 읽어라.** 컨트롤러는 단위 테스트(93개)까지 통과했고,
계약 게이트·경로 정규화·브랜치 가드는 픽스처 레포로 실제 실행 확인했다.
**실제 `claude -p` 세션으로 플랜을 완주한 적은 없다** — 그게 Phase 0-B이고 I6 결정을 기다린다.

## 구조

```
overlay/              봇에 주입하는 프롬프트 층 (원본 스킬은 수정하지 않음 — 명세 P4)
  CLAUDE.builder.md     builder-bot 규칙: 금지 사항, 반송 조건, 모델 정책, 외부 보고 계약
  CLAUDE.planner.md     planner-bot 규칙: 상태별 허용 행동, 발화 규칙
  writing-plans-tagging.md   2축 태깅 (명세 §3.4)
config/               권한 강제 (명세 §8) — 프롬프트는 설득, 이 파일이 강제
  builder.settings.json      머지·force push·플랜 수정 차단
  planner.settings.json      소스 코드 쓰기 차단
controller/           SDD 바깥의 배선. SDD 루프 자체는 재구현하지 않는다
  paths.ts              경로 계약의 단일 진실
  contract.ts           핸드오프 스키마 체커 (§4.3)
  materialize.ts        gstack 자유 명명 → 계약 고정 경로 (AMENDMENTS B2)
  state.ts              세션 상태 머신 + SQLite (§2) — 게이트 ①이 코드가 되는 곳
  builder.ts            headless 세션 기동 + 외부 보고 수확
  report.ts             Slack 보고 패킷 (§5.6)
  slack.ts              아웃바운드
bin/
  setup-paths.sh        ~/.gstack/projects/<slug> → 레포 심링크 (멱등)
  builder               builder-bot 기동. 브랜치 가드 포함
bootstrap.sh          환경 검증/복구/핀
```

## 사용

```bash
./bootstrap.sh check              # 환경 검증
bun test                          # 컨트롤러 단위 테스트
```

제품 레포에서 (한 번만):

```bash
bin/setup-paths.sh
```

브랜치 하나를 빌드:

```bash
TARGET_REPO=/path/to/product bin/builder feature/persona-list --dry-run
```

`--dry-run`은 계약 검증까지만 하고 `claude` 세션을 띄우지 않는다. **처음 돌리는 브랜치는
항상 `--dry-run`을 먼저 통과시켜라** — 계약 위반은 빌드 시작 전에 잡는 게 유일하게 값싸다.

## 설계에서 양보하지 않는 것

1. **봇은 머지하지 않는다.** PR 생성까지다. 프롬프트 금지 + `permissions.deny` + (예정) 자격증명 분리 3층.
2. **플랜은 현장에서 고치지 않는다.** 결함 발견 → 반송. SDD는 틀린 플랜도 완주하는 도구이므로,
   완주 능력과 플랜 수정 권한을 동시에 주면 게이트 ①이 사라진다.
3. **파싱 실패는 성공이 아니다.** 경계는 파일 + JSON 스키마. 보고가 없거나 깨지면 `BLOCKED`이다.
   미완성 태스크가 조용히 PR에 들어가는 것이 이 시스템의 최악 실패 모드다.
4. **검증 공백은 숨기지 않는다.** 골든셋 없이 통과한 태스크는 성공 패킷에도 표기된다.
