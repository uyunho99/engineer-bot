# Discoveries — feature/preflight-cluster

builder-bot 이 서브에이전트 보고에서 누적한다. SDD 워크스페이스가 아니라 여기 둔다
(AMENDMENTS A5 — 워크스페이스는 최종 리뷰 후 삭제된다).

형식: `- [<task-id>] <한 줄 발견> — <왜 다음 태스크에 영향을 주는가>`

**승격 판단은 하지 않는다.** product-brain 승격은 사람의 주간 리뷰다 (명세 D1).

---

- [setup] `checkDefectShape` 와 `concernsUnit` 은 `preflight.ts` 의 비공개 함수다 — 각각 `checkPreflightRaw` · `assembleResult` 를 통해서만 테스트된다. Task 2·3 이 "기존 테스트" 라고 부르는 것이 그 간접 테스트다.
- [setup] Task 4 Step 3 의 "값을 채우는 것은 Task 7 이다" 는 Task 6 을 가리키는 오기다 — Task 7 본문에 `warnings` 가 없다. 코드는 갈리지 않지만 계획서 반영 대상이다.
- [2] `PreflightDefect` 는 `contract.ts:479` 에 있는데 Task 2 의 **Files:** 는 `preflight.ts` 만 적었다 — 이 브랜치가 만드는 클러스터 분석이 바로 이 Files 목록을 먹는다. 매니페스트가 자기 쓰기를 덜 신고하면 클러스터도 덜 나온다.
- [3] `concernsUnit` 의 두 규칙은 부분집합의 **방향**이 반대다: `relation` 은 단위 ⊆ 결함, `cluster` 는 결함 ⊆ 단위. 크기로 갈리지 않는다는 것을 원소 2개짜리 두 단위로 증명한다.
- [3] `cluster` 단위에 `file` 이 없으면 `file` 을 가진 결함을 전부 걸러낸다 — 안전 방향의 반대다. Task 6 이 `FileCluster.file`(필수)을 넘겨 그 구멍을 닫는다. 넘기지 않으면 조용히 과소 보고로 돈다.
- [5] `units_failed` 는 `string[]` 로 남고 `units_examined` 만 객체가 된다. 이 비대칭은 의도다 — 기존 실패 경로(`not_examined`)를 건드리지 않으려는 것이다.
- [6] `preflight-cli.ts` 는 아무도 import 하지 않아 `bun test` 가 로드조차 하지 않는다. 검증하려면 임시 레포(`mkdtempSync`) + `TARGET_REPO` 환경변수로 `bin/preflight` 를 실제 spawn 해야 한다. 부모 브랜치의 검증 공백이 이것이었다.
- [6] Task 6 과 Task 7 사이에 브랜치는 **조용히 깨진 상태**다 — `--plan` 은 `clusters` 를 내는데 워크플로우는 `args.pairs` 를 읽으므로 2단계 팬아웃이 0개가 되고 아무것도 안 본 채 CLEAN 이 난다. 태스크 경계가 이런 상태를 만들면 순서가 곧 위험이다.
- [6] 1단계 결함은 `file` 을 절대 달지 않는다 → `concernsUnit` 의 클러스터 분기가 그걸 전부 통과시킨다. 부모 플랜의 9-태스크 클러스터에서 무관한 `dangling_ref` 하나가 클러스터 전체를 `"defect"` 로 표시한다. 의도된 과다 보고 방향이지만 `examined[]` 의 가독성 비용은 이 태스크부터 실제로 보인다.
- [7] `workflows/plan-preflight.js` 는 tsconfig 밖이고 실행 불가라 기계 검사가 0이다. 모든 단언이 소스 문자열 검사이므로, **주석과 프롬프트를 함께 슬라이스하면 단언이 주석만으로 통과한다** — 실제로 그렇게 새어 있었다.
- [7] `examined` 원소가 객체가 되면서 크리틱 프롬프트의 `examined.join(...)` 이 `[object Object]` 를 렌더링하게 됐다. 타입 변경이 문자열 렌더링 지점을 조용히 깬다 — 컴파일러가 없는 파일에서는 아무도 못 잡는다.
- [7] `/preflight` 스킬 문서(`.claude/skills/preflight/SKILL.md:30`)가 아직 검사 단위를 "짝"으로 설명한다. 계획서 7개 태스크 중 이 문서를 고치는 태스크가 없다 — 기능이 바꾼 개념을 사람 대면 문서가 따라가지 않는 누락이다.

## 4판 실행 (2026-09-04)

- [setup] 계획서가 개정되면 SDD 레저의 "완료" 표시가 더 이상 권위가 아니다. 어느 태스크를 다시 열어야 하는지는 `git diff <구판>..<신판> -- plan.md` 만이 답한다 — 레저는 태스크 텍스트가 불변이라는 전제 위에 있다. 4판에서 Task 6·7 이 "완료" 인 채로 요건이 바뀌었다.
- [6] `parsePreviousResult` 는 형제 필드 세 개(`applied`·`defects`·`warnings`)를 검증하는데 마지막 하나만 "정규화" 방향이었다. **부재와 타입 오류를 한 분기로 뭉개면 손상 신호가 지워진다** — `--apply` 가 `{ ...previous }` 로 다시 쓰면서 `warnings: "경고 3건"` 을 `[]` 로 덮는다. 스키마 번호가 같은 채로 필드가 늘어나는 진화에서는 "없음"과 "틀림"이 항상 다른 답이어야 한다.
- [8] 이 기능의 최악 실패는 **거짓 CLEAN 이 아니라 거짓 "봤다"** 다. `examined[]` 는 `plan.md` 에서 다시 계산하고 `examined_stage2` 는 raw 파일에서 가져오는데, 둘을 비교하는 곳이 없으면 팬아웃 0개인 실행이 `examined_stage2: 0` · `not_examined: []` · 클러스터마다 `"clean"` 행을 동시에 낸다. 교차 검증은 순수 개수 비교로 충분하다 — 라벨 대조는 접두사 불일치(`cluster:${file}` vs `file`)로 곧장 자유 텍스트 파싱이 된다.
- [8] 공유 테스트 파일에서 **픽스처가 요건이다.** Task 6 의 회귀 단언 3개가 `units_examined: []` 픽스처를 쓰고 있었고, 그 입력은 Task 8 이 "CLEAN 이 아니어야 한다"고 못박는 입력과 글자 그대로 같았다. 픽스처를 채우는 쪽으로 고치면 두 회귀가 서로 다른 입력에서 각자 산다. 기대를 뒤집는 쪽으로 고쳤다면 Task 6 의 가드가 사라졌다.
- [최종] **`agent()` 는 죽을 때 던지지 않는다 — `null` 을 돌려준다.** 워크플로우의 `.then()` 네 곳이 전부 그 `null` 을 성공으로 취급하고 있었다: 죽은 클러스터 에이전트가 `examined` 에 밀려들어가 개수가 맞고, Task 8 이 만든 교차 검증이 갭 0을 보고, 아무도 안 읽은 파일에 `"clean"` 행이 붙는다. **Task 8 이 잡는 핸드오프 유실보다 에이전트 사망이 훨씬 흔하다** — 즉 새로 만든 안전장치를 우회하는 경로가 원래 경로보다 발생 확률이 높았다. 소스 문자열 검사는 이것을 구조적으로 볼 수 없다. 런타임 계약 문서를 읽는 리뷰어만 잡는다.
- [최종] 검증기가 **던지면** 그 자체가 판정으로 둔갑한다. `critic: null` 이 `checkPreflightRaw` 밖으로 예외를 던지면 `preflight-cli.ts:99` 는 top-level 이라 잡지 못하고, Bun 의 uncaught 종료 코드 1 은 `bin/preflight` 표에서 "REJECTED — 계획서를 고쳐라" 다. 검증 실패가 BLOCKED 이 아니라 반송으로 보고된다 (하드룰 #4). 옵셔널 필드의 `!== undefined` 가드는 `null` 을 통과시킨다.
- [7] `.claude/` 하위 쓰기가 이 세션의 권한 게이트에 막힌다 (Edit · Write · Bash 전부, `dangerouslyDisableSandbox` 포함). **스킬 문서를 고치는 태스크는 headless builder 세션에서 완주할 수 없다** — 계획서가 `.claude/**` 를 Files 에 넣으면 그 태스크는 구조적으로 BLOCKED 다. 계획 단계에서 알아야 할 제약이다.
