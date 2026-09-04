# 사전 검사 2단계를 파일 클러스터 단위로 바꾼다

설계: [design-doc.md](design-doc.md) — 결정 DC1~DC7.
부모 기능: [feature-plan-preflight](../feature-plan-preflight/design-doc.md) (머지됨, PR #1).

> **이 계획서는 2판이다.** 초판을 `/preflight` 에 돌려 결함 9건으로 반송당했고
> ([preflight-raw.json](preflight-raw.json)), 그 9건을 전부 요건으로 흡수했다.
> 태스크 5개 → 7개로 늘어난 것은 배선 파일(`preflight-cli.ts`)과 raw 스키마 변경이
> 초판에 없었기 때문이다.

태스크 7개 · 전부 `deterministic` / `invisible`.

## Global Constraints

- **클러스터 상한 상수는 `12` 다.** 이 값이 소스와 테스트에 verbatim 으로 들어간다.
- **부모 플랜의 실측값이 수용 기준이다:** 클러스터 2개 — `controller/preflight.ts` 가
  태스크 9개, `controller/contract.ts` 가 태스크 3개. 짝 검산 `36 + 3 = 39`.
- **`units_examined` 의 원소는 객체다:** `{ kind: "signature" | "cluster" | "critic", label: string }`.
  문자열 접두사로 종류를 알아내지 마라 — 하드룰 #4 위반이다.
- **`concernsUnit` 은 단위의 `kind` 로 분기한다.** 크기(`length`)로 분기하지 마라.
- `bun test` 는 트랜스파일만 한다 — 타입을 정의·수정하는 태스크는 Step 4 에서
  `bun run typecheck` 를 **함께** 돌린다.
- 모든 `agent()` 에 `model` 을 명시한다 (하드룰 #3).
- `docs/plans/**/plan.md` 를 수정하지 않는다 (하드룰 #2). 결함을 찾으면 `REJECTED` 로 반송한다.
- 테스트는 `controller/preflight.test.ts` 에 **append** 한다. 여러 태스크가 공유하므로
  **모듈 스코프 이름을 새로 선언하기 전에 이미 있는지 확인한다** — 중복 선언은 파일 전체를
  로드 불가로 만든다.

---

### Task 1: 파일 클러스터 생성

**Tags:** verification=deterministic validation=invisible

**Files:**
- Modify: `controller/preflight.ts`
- Test: `controller/preflight.test.ts`

**Interfaces:**
- Consumes: `ParsedTask` (기존)
- Consumes: `parseFiles` (기존)
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
      `describe("overlappingClusters", ...)` 를 append. 픽스처는 `**Files:**` 만 담은
      최소 문자열로 만들고, 헬퍼는 `describe` 콜백 안에 둔다.
- [ ] **Step 2: Run — RED**
- [ ] **Step 3: Implement**
      `overlappingPairs` **바로 아래**에 추가한다. `overlappingPairs` 는 아직 지우지 마라 —
      Task 6 이 마지막 호출자를 옮긴 뒤에 지운다. 주석에 실측(39 짝 → 2 클러스터)과
      DC1(파일 단위, 연결 성분 아님)을 적는다.
- [ ] **Step 4: Run — GREEN**
      `bun run typecheck && bun test` 둘 다 통과.

---

### Task 2: 결함이 자기 파일을 들고 다닌다

**Tags:** verification=deterministic validation=invisible

**Files:**
- Modify: `controller/preflight.ts`
- Test: `controller/preflight.test.ts`

**Interfaces:**
- Consumes: `PreflightDefect` (기존)
- Produces: `checkDefectShape`

**테스트로 증명할 것:**
- [ ] `file` 이 있는 결함이 형태 검증을 통과한다
- [ ] `file` 이 없는 결함도 통과한다 — 옵셔널이므로 하위 호환이다 (DC3)
- [ ] `file` 이 문자열이 아니면 거부한다
- [ ] `task_ids` 가 2개 미만이면 여전히 거부한다 — 기존 규칙 회귀 없음 (D27)
- [ ] 기존 결함 픽스처가 전부 그대로 통과한다

- [ ] **Step 1: Write the failing test**
      기존 `checkDefectShape` 테스트 아래에 append. **기존 테스트를 지우지 마라.**
- [ ] **Step 2: Run — RED**
- [ ] **Step 3: Implement**
      `PreflightDefect` 에 `file?: string` 을 더하고 `checkDefectShape` 가 그 타입을 본다.
      주석에 DC3(중복 소속이 정상이므로 `task_ids` 만으로는 출처를 복원할 수 없다)을 적는다.
- [ ] **Step 4: Run — GREEN**
      `bun run typecheck && bun test` 통과.

---

### Task 3: 판정 규칙을 단위 종류로 가른다

**Tags:** verification=deterministic validation=invisible

**Files:**
- Modify: `controller/preflight.ts`
- Test: `controller/preflight.test.ts`

**Interfaces:**
- Consumes: `FileCluster` from Task 1
- Consumes: `checkDefectShape` from Task 2
- Produces: `concernsUnit(defects: PreflightDefect[], unit: JudgedUnit): "clean" | "defect"`
- Produces: `interface JudgedUnit { kind: "relation" | "cluster"; task_ids: string[]; file?: string }`

**테스트로 증명할 것:**
- [ ] `kind: "cluster"` — 클러스터 9개 중 2개를 지명한 결함이 그 클러스터를 `"defect"` 로 만든다
- [ ] `kind: "cluster"` — 클러스터 밖 태스크를 하나라도 지명한 결함은 오염시키지 않는다
- [ ] **`kind: "cluster"` — `task_ids` 는 같고 `file` 만 다른 클러스터 2개에서,
      한쪽에서만 나온 결함이 다른 쪽을 오염시키지 않는다** (Ⓑ 회귀 — 초판 반송 사유)
- [ ] `kind: "cluster"` — 결함에 `file` 이 없으면 거르지 않는다. 과다 표시 쪽으로 안전하게 둔다
- [ ] **`kind: "relation"` — 원소 1개짜리 단위에서, 그 태스크를 지명한 결함이 있으면
      `"defect"` 다** (Ⓒ 회귀 — 무조건 뒤집으면 영원히 `clean` 이 된다)
- [ ] **`kind: "relation"` — 태스크 3개를 지명한 결함 `{1,3,5}` 가 단위 `{1,3}` 을
      `"defect"` 로 만든다** (Ⓒ 회귀 — 개정 전과 같은 답)
- [ ] `kind: "relation"` 은 `file` 을 무시한다 — 파일 개념이 없는 단위다
- [ ] 결함이 없으면 어느 종류든 `"clean"`
- [ ] 크기가 아니라 종류로 갈린다 — 원소 2개짜리 `"relation"` 과 `"cluster"` 가 같은
      입력에서 다른 답을 낸다

- [ ] **Step 1: Write the failing test**
      기존 `concernsUnit` 테스트를 **지우지 말고** 새 서명에 맞게 감싼다.
      1단계 회귀를 지키는 것이 이 태스크의 핵심 요건이다.
- [ ] **Step 2: Run — RED**
- [ ] **Step 3: Implement**
      함수를 **하나로 유지하고** `unit.kind` 로 분기한다. 두 함수를 만들지 마라 —
      어느 것이 어디 쓰이는지가 곧 드리프트다. 주석에 DC2 의 표(두 방향으로 깨지는 경우)를 적는다.
- [ ] **Step 4: Run — GREEN**
      `bun run typecheck && bun test` 통과.

---

### Task 4: 경고에 담을 자리를 만든다

**Tags:** verification=deterministic validation=invisible

**Files:**
- Modify: `controller/preflight.ts`
- Test: `controller/preflight.test.ts`

**Interfaces:**
- Consumes: `FileCluster` from Task 1
- Consumes: `CLUSTER_WARN_SIZE` from Task 1
- Produces: `oversizedClusterWarnings(clusters: FileCluster[]): Violation[]`
- Produces: `PreflightResult`

**테스트로 증명할 것:**
- [ ] 태스크 13개가 한 파일을 쓰면 `warn` 1건
- [ ] 정확히 12개면 경고가 없다 — 경계값
- [ ] `severity` 가 `"warn"` 이다. `"error"` 가 아니다 (DC5 — 검사기가 일을 거부하지 않는다)
- [ ] `file` 필드가 `"plan.md"` 다 — `Violation` 의 유니온에 값을 새로 추가하지 않는다
- [ ] 메시지에 파일 경로와 태스크 수가 들어가고, 다음 행동이 드러난다
- [ ] 부모 플랜의 최대 클러스터(9)에서는 경고가 없다
- [ ] **`PreflightResult` 에 `warnings: Violation[]` 필드가 있다** (Ⓓ 회귀)
- [ ] **경고가 없으면 `warnings` 가 `[]` 다** — `undefined` 도 필드 누락도 아니다
- [ ] `warn` 이 있어도 `verdict` 가 바뀌지 않는다 — 판정은 결함 수로만 정해진다

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run — RED**
- [ ] **Step 3: Implement**
      `PreflightResult` 에 `warnings` 를 더한다. 값을 채우는 것은 Task 7 이다 —
      여기서는 **자리를 만들고 기본값 `[]` 을 보장**한다.
- [ ] **Step 4: Run — GREEN**
      `bun run typecheck && bun test` 통과.

---

### Task 5: raw 스키마의 검사 단위를 객체로

**Tags:** verification=deterministic validation=invisible

**Files:**
- Modify: `controller/preflight.ts`
- Test: `controller/preflight.test.ts`

**Interfaces:**
- Produces: `interface ExaminedRawUnit { kind: "signature" | "cluster" | "critic"; label: string }`
- Produces: `checkPreflightRaw`
- Produces: `relationCoverage`

**테스트로 증명할 것:**
- [ ] `units_examined` 의 원소가 `{ kind, label }` 객체다
- [ ] `kind` 가 세 값 밖이면 `checkPreflightRaw` 가 거부한다
- [ ] 원소가 문자열이면 거부한다 — 옛 형식을 조용히 받지 않는다
- [ ] `label` 이 없으면 거부한다
- [ ] **`relationCoverage` 의 `examined_stage2` 가 `kind === "cluster"` 인 것만 센다** (Ⓔ 회귀)
- [ ] `signature` 와 `critic` 이 섞여 있어도 그 수가 부풀지 않는다
- [ ] 클러스터가 0개면 `examined_stage2` 가 0 이다
- [ ] `units_failed` 의 라벨이 `not_examined` 에 그대로 들어간다 — 기존 실패 경로 보존

- [ ] **Step 1: Write the failing test**
      2026-09-04 실측을 픽스처로 쓴다: 검사 단위 6개인데 배열이 7개(`critic` 포함)였다.
      그 픽스처에서 `examined_stage2` 가 6이 아니라 **클러스터 수**여야 한다.
- [ ] **Step 2: Run — RED**
- [ ] **Step 3: Implement**
      접두사 파싱으로 우회하지 마라 (하드룰 #4). 주석에 DC6 과 실측 숫자를 적는다.
- [ ] **Step 4: Run — GREEN**
      `bun run typecheck && bun test` 통과.

---

### Task 6: 결과 조립과 CLI 배선

**Tags:** verification=deterministic validation=invisible

**Files:**
- Modify: `controller/preflight.ts`
- Modify: `controller/preflight-cli.ts`
- Test: `controller/preflight.test.ts`

**Interfaces:**
- Consumes: `overlappingClusters` from Task 1
- Consumes: `concernsUnit` from Task 3
- Consumes: `oversizedClusterWarnings` from Task 4
- Consumes: `relationCoverage` from Task 5
- Produces: `assembleResult`
- Produces: `ExaminedUnit`

**테스트로 증명할 것:**
- [ ] `examined[]` 의 2단계 항목이 `kind: "cluster"` 다
- [ ] `ExaminedUnit.kind` 유니온에 `"pair"` 가 없다 (`@ts-expect-error` 프로브로 강제)
- [ ] `label` 이 파일 경로를 담는다 — 사람이 무엇을 봤는지 읽을 수 있어야 한다 (부모 D9)
- [ ] 클러스터가 0개면 `examined[]` 에 2단계 항목이 없고 판정이 1단계만으로 난다
- [ ] 결함 0건이면 `verdict` 가 `"CLEAN"` — 클러스터화가 판정 규칙을 바꾸지 않는다
- [ ] **`assembleResult` 가 `warnings` 를 채운다** — `oversizedClusterWarnings` 의 결과가 그대로 들어간다 (Ⓓ)
- [ ] **`--plan` 출력에 `clusters` 가 있고 `pairs` 가 없다** (Ⓐc — 없으면 검사 단위 0개가 된다)
- [ ] **소스 전체에 `overlappingPairs` 참조가 남아 있지 않다** (Ⓐa — 죽은 코드를 남기지 않는다)
- [ ] `--record` 가 쓴 `preflight.json` 에 `warnings` 배열이 있다

- [ ] **Step 1: Write the failing test**
      `--plan` 출력 검사는 `bin/preflight` 를 실제로 spawn 해서 본다 —
      `preflight-cli.ts` 는 아무도 import 하지 않아 `bun test` 가 로드조차 하지 않는다.
      부모 Task 11 의 검증 공백이 그것이었고, 컨트롤러가 임시 레포로 spawn 해 메운 방식을 따른다.
- [ ] **Step 2: Run — RED**
- [ ] **Step 3: Implement**
      `assembleResult` 를 클러스터 입력으로 바꾸고, `ExaminedUnit.kind` 에서 `"pair"` 를
      제거하고, `preflight-cli.ts` 의 `--plan` 이 `clusters` 를 내보내게 한다.
      **`overlappingPairs` 와 그 테스트를 함께 지운다** — 이 태스크가 마지막 호출자를 옮긴다.
- [ ] **Step 4: Run — GREEN**
      `bun run typecheck && bun test` 통과. `typecheck` 가 필수다 — 함수를 지우면
      남은 참조가 TS2305 로 드러난다.

---

### Task 7: 워크플로우가 클러스터마다 에이전트 1개를 띄운다

**Tags:** verification=deterministic validation=invisible

**Files:**
- Modify: `workflows/plan-preflight.js`
- Test: `controller/preflight.test.ts`

**Interfaces:**
- Consumes: `ExaminedRawUnit` from Task 5
- Consumes: `assembleResult` from Task 6
- Produces: `clusterPromptContract`

**테스트로 증명할 것:**
- [ ] 워크플로우 소스에 `overlappingPairs` 도 `args.pairs` 도 없다
- [ ] `args.clusters` 를 읽는다
- [ ] `agent(` 호출 수와 `model:` 지정 수가 같다 (하드룰 #3 — 부모 테스트와 같은 방식)
- [ ] 클러스터 프롬프트가 `kind: "undeclared_conflict"` 를 못박는다 (하드룰 #4)
- [ ] **클러스터 프롬프트가 `file` 을 그 클러스터의 파일로 채우라고 못박는다** (DC3 —
      이 값이 없으면 Task 3 의 파일 필터가 갈라지지 않는다)
- [ ] 클러스터 프롬프트가 `task_ids` 에 **충돌하는 태스크만** 지명하라고 지시한다 (DC4)
- [ ] 프롬프트가 "순차로 확장한다"는 맥락을 준다 — 짝 프롬프트보다 정보가 많은 것이 DC4 의 근거다
- [ ] `units_examined` 에 넣는 값이 `{ kind, label }` 객체다 — 세 단계 모두 (DC6)
- [ ] `meta` 블록의 `phases` 가 실제 `phase()` 호출과 일치한다

**주의 — 이 파일은 기계 검사가 0이다.** tsconfig `include` 밖이고, 파일을 **읽지도 쓰지도**
못하며(AMENDMENTS B7) 워크플로우 런타임 전역에 의존해 실행할 수 없다. 위 단언은 전부
**소스 문자열 검사**다. 실제 동작은 수용 기준 9(재실행)에서 처음 관찰된다.

- [ ] **Step 1: Write the failing test**
      소스를 `readFileSync` 로 읽고 주석을 제거한 뒤 센다 — 부모 Task 12 와 같은 방식이다.
- [ ] **Step 2: Run — RED**
- [ ] **Step 3: Implement**
      짝 팬아웃을 클러스터 팬아웃으로 바꾸고 프롬프트를 DC4 대로 다시 쓴다.
      `examined.push` 세 곳을 전부 객체로 바꾼다 (Candidates · 클러스터 · Critic).
- [ ] **Step 4: Run — GREEN**
      `bun run typecheck && bun test && bun run check` 통과.
