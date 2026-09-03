# 사전 검사 2단계를 파일 클러스터 단위로 바꾼다

설계: [design-doc.md](design-doc.md) — 결정 DC1~DC5.
부모 기능: [feature-plan-preflight](../feature-plan-preflight/design-doc.md) (머지됨, PR #1).

태스크 5개 · 전부 `deterministic` / `invisible`.

## Global Constraints

- **클러스터 상한 상수는 `12` 다.** 이 값이 소스와 테스트에 verbatim 으로 들어간다.
- **부모 플랜의 실측값이 수용 기준이다:** 클러스터 2개 — `controller/preflight.ts` 가
  태스크 9개, `controller/contract.ts` 가 태스크 3개. 짝 검산 `36 + 3 = 39`.
- `bun test` 는 트랜스파일만 한다 — 타입을 정의·수정하는 태스크는 Step 4 에서
  `bun run typecheck` 를 **함께** 돌린다.
- 모든 `agent()` 에 `model` 을 명시한다 (하드룰 #3).
- `docs/plans/**/plan.md` 를 수정하지 않는다 (하드룰 #2). 결함을 찾으면 `REJECTED` 로 반송한다.
- 테스트는 `controller/preflight.test.ts` 에 **append** 한다. 이 파일은 여러 태스크가
  공유하므로 **모듈 스코프 이름을 새로 선언하기 전에 이미 있는지 확인한다** —
  중복 선언은 파일 전체를 로드 불가로 만든다 (부모 5회전 반송 사유).

---

### Task 1: 파일 클러스터 생성

**Tags:** verification=deterministic validation=invisible

**Files:**
- Modify: `controller/preflight.ts`
- Test: `controller/preflight.test.ts`

**Interfaces:**
- Consumes: `ParsedTask` (기존 — `controller/contract.ts`)
- Consumes: `parseFiles` (기존 — `controller/contract.ts`)
- Produces: `overlappingClusters(tasks: ParsedTask[]): FileCluster[]`
- Produces: `interface FileCluster { file: string; task_ids: string[] }`
- Produces: `CLUSTER_WARN_SIZE`

**테스트로 증명할 것:**
- [ ] 태스크 2개가 같은 파일을 `Modify` 하면 클러스터 1개, `task_ids` 가 두 태스크
- [ ] 태스크 1개만 쓰는 파일은 클러스터가 아니다 (2개 이상만)
- [ ] `Test:` 파일은 클러스터를 만들지 않는다 — 현재 규칙 유지
- [ ] `Create` 와 `Modify` 를 섞어도 같은 파일이면 한 클러스터
- [ ] 한 태스크가 두 파일을 쓰면 두 클러스터에 각각 나온다 (DC1 — 연결 성분이 아니다)
- [ ] `task_ids` 가 플랜 등장 순서다 — 프롬프트가 "순차로 확장한다"를 말하려면 순서가 의미를 가진다
- [ ] `file` 이 오름차순으로 정렬된다 — 같은 플랜에 두 번 돌리면 같은 순서가 나와야 캐시가 성립한다
- [ ] 태스크가 0개면 빈 배열, 예외 없음
- [ ] `CLUSTER_WARN_SIZE` 가 `12` 다 (Global Constraints 의 exact value)

- [ ] **Step 1: Write the failing test**
      `controller/preflight.test.ts` 에 `describe("overlappingClusters", ...)` 를 append.
      태스크 본문 픽스처는 `**Files:**` 만 담은 최소 문자열로 만든다.
      **모듈 스코프에 새 이름을 만들지 마라** — 헬퍼는 `describe` 콜백 안에 둔다.
- [ ] **Step 2: Run — RED**
      `bun test controller/preflight.test.ts` 가 실패하는 것을 확인한다.
- [ ] **Step 3: Implement**
      `overlappingClusters` 를 `overlappingPairs` **바로 아래**에 추가한다.
      `overlappingPairs` 는 아직 지우지 않는다 — Task 3 이 마지막 호출자를 옮긴 뒤에 지운다.
      주석에 실측 숫자(39 짝 → 2 클러스터)와 DC1(파일 단위, 연결 성분 아님)을 적는다.
- [ ] **Step 4: Run — GREEN**
      `bun run typecheck && bun test` 둘 다 통과. 타입을 새로 만들었으므로 typecheck 가 필수다.

---

### Task 2: 클러스터 결함 판정 규칙

**Tags:** verification=deterministic validation=invisible

**Files:**
- Modify: `controller/preflight.ts`
- Test: `controller/preflight.test.ts`

**Interfaces:**
- Consumes: `PreflightDefect` (기존 — `controller/preflight.ts`)
- Produces: `concernsUnit(defects: PreflightDefect[], unitTaskIds: string[]): "clean" | "defect"`

**테스트로 증명할 것:**
- [ ] 클러스터 9개 중 2개를 지명한 결함이 그 클러스터를 `"defect"` 로 만든다
      (부모 규칙에서는 원리적으로 불가능했다 — 거짓 음성)
- [ ] 클러스터 밖 태스크를 하나라도 지명한 결함은 그 클러스터를 오염시키지 않는다
- [ ] 1단계 `"relation"` 단위(태스크 2개)에서 부모와 같은 답을 낸다 — 회귀 없음
- [ ] 결함이 없으면 `"clean"`
- [ ] 결함의 `task_ids` 가 클러스터와 정확히 같으면 `"defect"`
- [ ] 부분집합 방향이 뒤집히지 않았다 — 클러스터가 결함의 부분집합인 경우는 `"clean"`

- [ ] **Step 1: Write the failing test**
      기존 `concernsUnit` 테스트 아래에 클러스터 케이스를 append 한다.
      **기존 테스트를 지우지 마라** — 1단계 회귀를 지키는 것이 이 태스크의 요건이다.
- [ ] **Step 2: Run — RED**
      클러스터 케이스가 실패하고 기존 케이스는 통과하는 것을 확인한다.
- [ ] **Step 3: Implement**
      `concernsUnit` 의 부분집합 방향을 뒤집는다. 주석에 부모 6회전의 합집합 결함과
      이번 크기 의존 문제를 함께 적는다 (DC2).
- [ ] **Step 4: Run — GREEN**
      `bun run typecheck && bun test` 통과.

---

### Task 3: 결과 조립을 클러스터 단위로

**Tags:** verification=deterministic validation=invisible

**Files:**
- Modify: `controller/preflight.ts`
- Test: `controller/preflight.test.ts`

**Interfaces:**
- Consumes: `overlappingClusters` from Task 1
- Consumes: `concernsUnit` from Task 2
- Produces: `assembleResult`

**테스트로 증명할 것:**
- [ ] `examined[]` 의 2단계 항목이 `kind: "cluster"` 다
- [ ] `ExaminedUnit.kind` 유니온에 `"pair"` 가 없다 (DC4 — `@ts-expect-error` 프로브로 강제)
- [ ] `label` 이 파일 경로를 담는다 — 사람이 무엇을 봤는지 읽을 수 있어야 한다 (D9)
- [ ] `relations.examined_stage2` 가 클러스터 수를 센다
- [ ] 클러스터가 0개면 `examined[]` 에 2단계 항목이 없고 판정이 1단계만으로 난다
- [ ] `not_examined` 에 실패한 클러스터의 라벨이 들어간다 — 기존 실패 경로 보존
- [ ] 결함 0건이면 `verdict` 가 `"CLEAN"` — 클러스터화가 판정 규칙을 바꾸지 않는다

- [ ] **Step 1: Write the failing test**
      기존 `assembleResult` 테스트 아래에 append. `@ts-expect-error` 프로브로
      `kind: "pair"` 가 타입 오류인 것을 단언한다 — 런타임이 아니라 typecheck 가 잡는다.
- [ ] **Step 2: Run — RED**
      `bun run typecheck` 가 프로브에서 실패하는 것을 확인한다(아직 `"pair"` 가 유효하므로
      `@ts-expect-error` 가 "사용되지 않은 지시"로 오류를 낸다).
- [ ] **Step 3: Implement**
      `ExaminedUnit.kind` 에서 `"pair"` 를 제거하고, `assembleResult` 가 클러스터를
      받도록 바꾼다. `overlappingPairs` 의 마지막 호출자가 없어지면 **함수와 그 테스트를
      함께 지운다** — 죽은 코드를 남기지 않는다.
- [ ] **Step 4: Run — GREEN**
      `bun run typecheck && bun test` 통과.

---

### Task 4: 큰 클러스터 경고

**Tags:** verification=deterministic validation=invisible

**Files:**
- Modify: `controller/preflight.ts`
- Test: `controller/preflight.test.ts`

**Interfaces:**
- Consumes: `FileCluster` from Task 1
- Consumes: `CLUSTER_WARN_SIZE` from Task 1
- Produces: `oversizedClusterWarnings(clusters: FileCluster[]): Violation[]`

**테스트로 증명할 것:**
- [ ] 태스크 13개가 한 파일을 쓰면 `warn` 1건
- [ ] 정확히 12개면 경고가 없다 — 경계값
- [ ] `severity` 가 `"warn"` 이다. `"error"` 가 아니다 (DC5 — 검사기가 일을 거부하지 않는다)
- [ ] 메시지에 파일 경로와 태스크 수가 들어간다
- [ ] 메시지가 사람에게 다음 행동을 준다 — 플랜 구조를 다시 보라는 뜻이 드러난다
- [ ] 부모 플랜의 최대 클러스터(9)에서는 경고가 없다

- [ ] **Step 1: Write the failing test**
      `controller/preflight.test.ts` 에 append.
- [ ] **Step 2: Run — RED**
- [ ] **Step 3: Implement**
      `Violation` 의 `file` 유니온에 값을 추가하지 마라 — `"plan.md"` 를 쓴다.
      큰 클러스터는 플랜의 성질이다.
- [ ] **Step 4: Run — GREEN**
      `bun run typecheck && bun test` 통과.

---

### Task 5: 워크플로우가 클러스터마다 에이전트 1개를 띄운다

**Tags:** verification=deterministic validation=invisible

**Files:**
- Modify: `workflows/plan-preflight.js`
- Test: `controller/preflight.test.ts`

**Interfaces:**
- Consumes: `overlappingClusters` from Task 1
- Consumes: `oversizedClusterWarnings` from Task 4
- Produces: `clusterPromptContract`

**테스트로 증명할 것:**
- [ ] 워크플로우 소스에 `overlappingPairs` 참조가 없다
- [ ] `agent(` 호출 수와 `model:` 지정 수가 같다 (하드룰 #3 — 부모 테스트와 같은 방식)
- [ ] 클러스터 프롬프트가 `kind: "undeclared_conflict"` 를 못박는다 (하드룰 #4)
- [ ] 클러스터 프롬프트가 `task_ids` 구성 방법을 지시한다 — **충돌하는 태스크만** 지명하고
      클러스터 전체를 지명하지 않는다 (DC3)
- [ ] 프롬프트가 "순차로 확장한다"는 맥락을 준다 — 짝 프롬프트보다 정보가 많은 것이 DC3 의 근거다
- [ ] `meta` 블록의 `phases` 가 실제 `phase()` 호출과 일치한다

**주의 — 이 파일은 기계 검사가 0이다.** tsconfig `include` 밖이고 워크플로우 런타임
전역에 의존해 실행할 수 없다. 위 단언은 전부 **소스 문자열 검사**다. 실제 동작은
사람이 `/preflight` 를 돌릴 때 처음 관찰된다 (수용 기준 7).

- [ ] **Step 1: Write the failing test**
      `describe("워크플로우 클러스터 배선", ...)` 을 append. 소스를 `readFileSync` 로
      읽고 주석을 제거한 뒤 센다 — 부모 Task 12 테스트와 같은 방식이다.
- [ ] **Step 2: Run — RED**
- [ ] **Step 3: Implement**
      짝 팬아웃을 클러스터 팬아웃으로 바꾼다. 프롬프트 문구를 DC3 대로 다시 쓴다.
      `oversizedClusterWarnings` 결과를 `preflight-raw.json` 에 싣지 마라 — 그것은
      워크플로우 산출 스키마 밖이다. 경고는 `--record` 단계에서 컨트롤러가 낸다.
- [ ] **Step 4: Run — GREEN**
      `bun run typecheck && bun test && bun run check` 통과.
