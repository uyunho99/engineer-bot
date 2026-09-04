# 사전 검사 2단계를 파일 클러스터 단위로 바꾼다

설계: [design-doc.md](design-doc.md) — 결정 DC1~DC7.
부모 기능: [feature-plan-preflight](../feature-plan-preflight/design-doc.md) (머지됨, PR #1).

> **이 계획서는 4판이다.**
>
> 3판은 빌드 자체는 7/7 완주했지만 **계획서 결함 6건으로 반송당했다**
> (`build-result.json`). 그중 셋이 무겁다:
>
> - **3판 서문이 없는 커밋을 근거로 결함 2건을 각하했다.** 최종 리뷰어가
>   `git log -S"additional_defects" -- controller/preflight.ts` 로 확인했다 —
>   각하 근거로 가리킨 커밋은 이 브랜치에 없었다. `fix/d28-raw-write` 에만 있고
>   합병 시점이 그 커밋보다 앞이었다. **각하를 철회한다.** 지금은 다시 합병해
>   `checkPreflightRaw` 가 critic 버킷도 검증한다 (검증: `cr.additional_defects.forEach`).
> - **수용 기준 6을 구현하는 태스크가 없었다** — 아래 Task 8 로 신설한다.
> - **Task 6 의 `warnings` 지시가 자기 근거보다 넓었다** — 아래에서 좁혔다.
>
> 나머지 3건(Task 2 매니페스트 · Task 4 오기 · SKILL.md)도 반영했다.
>
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
- Modify: `controller/contract.ts`
- Test: `controller/preflight.test.ts`

**Interfaces:**
- Consumes: `PreflightDefect` (기존)
- Produces: `checkDefectShape`

**테스트로 증명할 것:**
- [ ] `file` 이 있는 결함이 형태 검증을 통과한다
- [ ] `file` 이 없는 결함도 통과한다 — 옵셔널이므로 하위 호환이다 (DC3)
- [ ] `file` 이 문자열이 아니면 거부한다
- [ ] **`file` 이 빈 문자열이면 거부한다** — `id` 를 `!o.id` 로, `patch.anchor` 를
      `!p.anchor.trim()` 으로 거르는 것과 같은 방향이다. 이 규칙이 없으면 `""` 가
      Task 3 의 필터에서 "없음"(`d.file &&`)으로도 "있음"(`!== undefined`)으로도
      해석될 수 있고, **두 구현이 둘 다 이 태스크와 Task 3 의 증명 목록을 통과하면서
      안전 방향이 정반대로 갈린다** (2판 반송 사유 `pair:2x3-4`)
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
      `PreflightResult` 에 `warnings` 를 더한다. 값을 채우는 것은 Task 6 이다 —
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
- [ ] **`--apply` 가 다시 쓰는 `preflight.json` 에도 `warnings` 가 남는다** —
      `parsePreviousResult` 는 `schema`·`applied`·`defects` 세 필드만 보고
      `as PreflightResult` 로 캐스팅하므로, 이 기능 이전에 쓰인 schema 1 파일에는
      `warnings` 가 없는데 스키마 번호는 그대로 `1` 이라 읽는 쪽이 구분할 수 없다.
      **`warnings` 가 없으면 `[]` 로 채운다. 배열이 아니면 `broken` 이다** —
      두 경우를 한 분기로 뭉개지 마라. 없는 것은 정상적인 구버전 파일이고,
      타입이 틀린 것은 손상이다. 형제 필드 `applied`·`defects` 가 정확히 그
      조건에서 `{ status: "broken" }` 을 낸다. 뭉개면 `warnings: "경고 3건"` 인
      파일이 통과하고 `--apply` 가 `[]` 로 다시 써서 **손상 신호를 지운다** —
      검증 실패는 BLOCKED 이지 성공이 아니다 (하드룰 #4 · 3판 반송 사유). 픽스처로 `warnings`
      없는 구 파일을 두고 `--apply` 를 돌려 결과에 `[]` 가 채워지는 것을 확인한다
      (2판 반송 사유 `pair:4x6-2`)
- [ ] **`--plan` 출력에도 `warnings` 가 있다** — `oversizedClusterWarnings` 는
      클러스터만으로 계산되므로 팬아웃 **전**에 낼 수 있다. 여기서 안 내면 경고가
      팬아웃이 끝난 뒤에야 계산되어 파일 안에만 남는다
- [ ] **경고가 있으면 사람이 읽는 콘솔에 닿는다** — `--record` 판정 줄에 `· 경고 K건`
      을 붙이고(0건이면 붙이지 않는다), 각 경고의 `message` 를 `console.error` 로
      한 줄씩 찍는다. `severity: "warn"` 이 종료 코드를 바꾸지 않는다는 DC5 는 그대로다 —
      **콘솔이 경고가 사람에게 닿는 유일한 경로다.** 이것이 없으면 Task 4 가 요구한
      "다음 행동이 드러난다"가 두 태스크를 합쳐도 성립하지 않는다 (2판 반송 사유 `pair:4x6-3`)

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

> **`.claude/skills/preflight/SKILL.md` 는 이 태스크의 Files 가 아니다** —
> headless 세션은 `.claude/` 하위를 쓸 수 없다 (AMENDMENTS B8, 2026-09-04 두 번
> 실측). `--settings` 의 allow 에 `Write(.claude/**)` 를 넣어도 이기지 못한다.
> **그 한 줄은 사람이 이미 적용했다** (커밋 98d4b55):
> `검사 단위 (짝 + …)` → `검사 단위 (파일 클러스터 + …)`.
> 이 태스크는 그것을 **단언만** 한다.

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
- [ ] **`.claude/skills/preflight/SKILL.md` 의 규모 산식이 "짝" 이 아니라
      "파일 클러스터" 를 말한다** — 사람이 이미 적용했으므로(위 주석) 이 태스크는
      파일을 읽어 그 문자열을 **단언만** 한다. 고치려 하지 마라 — 쓸 수 없다.
      **`39 에이전트` 실측 인용(같은 파일 아래)은 건드리지 마라** — 2026-09-04 자
      경고성 기록이고 테스트가 못박고 있다 (3판 반송 사유)

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

---

### Task 8: 안 본 단위를 봤다고 주장하지 않는다

**Tags:** verification=deterministic validation=invisible

**Files:**
- Modify: `controller/preflight.ts`
- Test: `controller/preflight.test.ts`

**Interfaces:**
- Consumes: `FileCluster` from Task 1
- Consumes: `relationCoverage` from Task 5
- Produces: `assembleResult`
- Consumes: `assembleResult` from Task 6

**Task 6과 같은 입력에 정반대 답을 요구하는 충돌 — 조정 지점을 여기 못박는다.**
Task 6(245행)이 `assembleResult`를 이미 Produces로 선언했고, 이 태스크는 신규 함수가
아니라 **그 함수를 이어받아 고친다.** 그런데 Task 6의 순수 함수 테스트들 — 249행
(`examined[]`의 2단계 항목이 `kind: "cluster"`다), 253행(결함 0건이면 `verdict`가
`CLEAN`), 254행(`assembleResult`가 `warnings`를 채운다 — 이 단언도 결함 0건 픽스처를
써서 함께 `verdict === "CLEAN"`을 검증한다) — 은 전부 `raw.stage2.units_examined`에
아무 제약을 걸지 않는다. 그 픽스처들을 그대로 두면 `units_examined`는 자연히 `[]`가
되고(3판 `raw6()` 헬퍼가 정확히 그 모양이었다), 클러스터 1개 · `units_examined: []`
· 결함 0건이라는 입력이 남는다 — 이것은 바로 위 "클러스터 1개 · `units_examined: []`
→ `verdict`가 `CLEAN`이 **아니다**" 단언과 **글자 그대로 같은 입력**이다.

Step 1에서 3판이 못박은 `--record` spawn 케이스의 기대를 뒤집는 것만으로는 이 충돌이
해소되지 않는다 — 그 케이스는 spawn 경로고, 위 세 단언은 순수 함수 경로다. **이 태스크는
Task 6이 쓴 그 세 픽스처도 함께 고쳐야 한다**: `units_examined`에 클러스터마다 하나씩
`{ kind: "cluster", label: <그 클러스터의 file> }`를 채워 원소 수를 `clusters.length`와
맞춘다. `units_examined`를 비워둔 채로 Task 6의 "결함 0건이면 CLEAN" 기대 쪽을 뒤집어
REJECTED로 바꾸는 것은 금지한다 — 그러면 Task 6이 요건으로 못박은 "클러스터화가 판정
규칙을 바꾸지 않는다" 회귀 가드가 사라진다. 픽스처를 채우는 쪽으로 고치면 Task 6의
회귀("결함 없음 + 커버리지 일치 → CLEAN")와 Task 8의 회귀("커버리지 불일치 → CLEAN
아님")가 서로 다른 입력에서 각자 성립해 둘 다 살아남는다.

**왜 이 태스크가 필요한가.** `examined[]` 는 `plan.md` 에서 **다시 계산한** 클러스터로
만들고 `relations.examined_stage2` 는 `raw.stage2.units_examined` 에서 가져오는데,
**그 둘을 비교하는 곳이 없다.** 그래서 워크플로우가 클러스터 에이전트를 하나도 띄우지
못하면(핸드오프에서 `args.clusters` 유실, raw 파일 절단 — 에이전트가 "던지지" 않는
모든 경우) `failed` 가 비고 `not_examined` 가 비어서 이런 보고가 나온다:

```
verdict         : CLEAN
examined_stage2 : 0                                       ← 아무것도 안 봤다
not_examined    : []                                      ← 실패한 것도 없다
examined[]      : [{ cluster, "preflight.ts", "clean" }]   ← 봤다고 주장
```

실측했다 (3판 빌드 후). **설계 §7.4 가 "이 기능의 최악 실패" 라고 부른 것이다** —
사람이 고른 "자세히" 옵션(부모 D9)이 정확히 거짓말을 하는 자리다.

3판은 이 상태를 **테스트로 못박고 있었다** (`units_examined: []` + 클러스터 1개에서
exit 0 과 cluster 행을 함께 단언). 그 테스트를 뒤집는 것이 이 태스크의 일부다.

**테스트로 증명할 것:**
- [ ] `units_examined` 의 클러스터 수가 `clusters.length` 보다 **적으면** 그 차이가
      `not_examined` 에 들어간다 — `preflight-cli.ts` 의 기존 분기가 그것을 BLOCKED
      (exit 4)로 라우팅한다. 자유 텍스트 파싱이 필요 없다
- [ ] 클러스터 1개 · `units_examined: []` → `verdict` 가 `CLEAN` 이 **아니다**
      (3판이 못박았던 상태를 뒤집는다)
- [ ] 개수가 같으면 `not_examined` 에 아무것도 추가하지 않는다 — 정상 경로를 벌하지 않는다
- [ ] `units_examined` 가 `clusters.length` 보다 **많으면** 그것도 `not_examined` 에
      기록한다 — 있을 수 없는 상태이므로 조용히 넘기지 않는다
- [ ] `failed` 로 들어온 항목과 개수 불일치가 **함께** 있으면 둘 다 `not_examined` 에 남는다
- [ ] 클러스터가 0개면 불일치가 없다 — `examined_stage2` 도 0 이어야 정상이다
- [ ] `examined[]` 의 행 수는 여전히 클러스터 수다 — 이 태스크는 **판정**을 고치고
      `examined[]` 의 구성은 건드리지 않는다

- [ ] **Step 1: Write the failing test**
      3판이 못박은 `--record` spawn 케이스를 찾아 기대를 뒤집는다. **지우지 말고 고쳐라** —
      그 테스트가 관찰하려던 것(클러스터 행이 생긴다)은 여전히 유효하다.
- [ ] **Step 2: Run — RED**
- [ ] **Step 3: Implement**
      `assembleResult` 에서 순수 개수 비교를 한다. 라벨 대조는 하지 마라 —
      워크플로우는 단위를 `cluster:${c.file}` 로 라벨링하고 `ExaminedUnit.label` 은
      맨 `c.file` 이라 접두사가 다르다. **그 접두사를 떼는 것은 이 태스크의 범위가
      아니다** (DC6 이 없애려던 자유 텍스트 접두사 모양이므로 별도로 다룬다).
- [ ] **Step 4: Run — GREEN**
      `bun run typecheck && bun test && bun run check` 통과.
