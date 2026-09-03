# 계획서 사전 검사기 (plan-preflight) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `plan.md`의 할 일 사이 모순을 게이트 ① 앞에서 잡고, 통과하지 않은 플랜의 빌드를 기계가 거부하게 만든다.

**Architecture:** 2단계다. 1단계는 계획서가 이미 선언한 `**Interfaces:** Consumes/Produces` 관계 그래프를 기계가 읽어 매달린 참조와 순서 위반을 **결정론적으로** 확정한다. 2단계는 워크플로우로 AI를 팬아웃해 선언되지 않은 충돌을 찾는다. 판단 로직은 전부 `controller/preflight.ts`의 순수 함수에 있고, 워크플로우 스크립트는 `agent()` 호출만 하는 얇은 글루다 — 워크플로우 스크립트가 파일시스템에 접근할 수 없다는 플랫폼 제약이 이 분리를 강제한다.

**Tech Stack:** TypeScript · Bun (테스트 러너 `bun test`) · Claude Code Workflow 툴 · 새 의존성 없음

**Spec:** [docs/plans/feature-plan-preflight/design-doc.md](design-doc.md) — 결정 D1~D29. 이 계획은 그 문서에서 논증한다. 실행자는 둘 다 읽는다.

## Global Constraints

- **런타임 핀**: bun `1.3.14` · node `v22.22.3` (`versions.lock`). 새 런타임 의존성을 추가하지 않는다.
- **테스트 명령**: `bun test`. 전용 테스트 디렉터리를 만들지 않는다 — 이 레포는 `controller/<name>.test.ts` 방식이다.
- **기존 테스트 107개는 유지된다.** 단 Task 2에서 `contract.test.ts`의 정상 픽스처를 **의도적으로** 수정한다 (새 필수 항목 추가). 그 실패는 회귀가 아니라 계약 변경의 신호다.
- **하드룰 #4** (CLAUDE.md): *"자유 텍스트 파싱 금지. 경계는 파일 + JSON 스키마다. 파싱 실패는 성공이 아니라 `BLOCKED`다"*
- **하드룰 #3** (CLAUDE.md): *"서브에이전트 디스패치 시 모델을 항상 명시한다."* 워크플로우 레퍼런스의 "생략이 기본"을 뒤집는다 (D19).
- **하드룰 #2** (CLAUDE.md): *"플랜은 현장에서 고치지 않는다."* 적용 범위는 게이트 ① **이후**다. 게이트 앞에서 사람이 결함마다 승인한 수정은 허용된다 (전제 A4).
- **하드룰 #5** (CLAUDE.md): `git clean -fdx` 금지.
- **경로 상수의 단일 진실은 `controller/paths.ts`다.** 경로를 다른 곳에 하드코딩하지 않는다.
- **명세 P4**: 원본 스킬(superpowers·gstack)을 수정하지 않는다. 오버레이만 고친다.
- 주석과 문서는 한국어로 쓴다 — 이 레포의 기존 코드가 그렇다.
- 모델 티어 (D19): 주제/미선언 관계 탐색과 완결성 검사관은 **opus**, 후보 판정·반증·수정 제안은 **sonnet**.

---

### Task 1: 계약 파싱 — `**Files:**` 와 `**Interfaces:**`

**Tags:** verification=deterministic validation=invisible

**Files:**
- Modify: `controller/contract.ts`
- Test: `controller/contract.test.ts`

**Interfaces:**
- Consumes: `ParsedTask` (기존 — `controller/contract.ts` 의 `parseTasks` 가 반환. 플랜 내 태스크가 아니므로 `from` 절을 쓰지 않는다)
- Produces: `parseFiles(body: string): TaskFiles`, `parseInterfaces(body: string): TaskInterfaces`, `interface TaskFiles { create: string[]; modify: string[]; test: string[] }`, `interface TaskInterfaces { consumes: ConsumeRef[]; produces: string[] }`, `interface ConsumeRef { symbol: string; fromTask: string | null }`

**테스트로 증명할 것:**
- [ ] `**Files:**` 아래 `- Create: \`a.ts\`` 를 `create: ["a.ts"]` 로 뽑는다 (백틱 제거)
- [ ] `- Modify: \`b.ts:12-30\`` 를 `modify: ["b.ts:12-30"]` 로 뽑는다 (줄 범위 보존)
- [ ] `- Test: \`c.test.ts\`` 를 `test: ["c.test.ts"]` 로 뽑는다
- [ ] `**Files:**` 섹션이 없으면 세 배열 모두 빈 배열이며 예외가 없다
- [ ] `**Files:**` 섹션이 있고 항목이 없으면 세 배열 모두 빈 배열이다
- [ ] 같은 파일이 두 번 적히면 한 번만 나온다 (중복 제거)
- [ ] `- Consumes: \`X\` from Task 2` 를 `{ symbol: "X", fromTask: "2" }` 로 뽑는다
- [ ] `- Consumes: \`X\`` (from 절 없음) 를 `{ symbol: "X", fromTask: null }` 로 뽑는다
- [ ] `- Produces: \`f(a: A): B\`` 를 `produces: ["f(a: A): B"]` 로 뽑는다 (서명 전문 보존)
- [ ] `**Interfaces:**` 섹션이 없으면 두 배열 모두 빈 배열이며 예외가 없다
- [ ] 다음 `**...:**` 헤딩이 나오면 섹션이 끝난다 — 뒤 섹션의 `- ` 항목을 삼키지 않는다
- [ ] 코드펜스 안의 `- Create:` 는 무시한다 (예시 블록이 파싱되지 않는다)
- [ ] **파일 시스템을 건드리지 않는다** — 존재하지 않는 경로도 그대로 반환한다 (D21)

- [ ] **Step 1: Write the failing test**

`controller/contract.test.ts` 끝에 추가:

```ts
describe("parseFiles", () => {
  const body = [
    "### Task 1: 예시",
    "",
    "**Files:**",
    "- Create: `src/a.ts`",
    "- Modify: `src/b.ts:12-30`",
    "- Test: `src/a.test.ts`",
    "",
    "**Interfaces:**",
    "- Produces: `f(): void`",
  ].join("\n");

  test("Create/Modify/Test 를 분리해 뽑고 백틱을 벗긴다", () => {
    expect(parseFiles(body)).toEqual({
      create: ["src/a.ts"],
      modify: ["src/b.ts:12-30"],
      test: ["src/a.test.ts"],
    });
  });

  test("다음 ** 섹션에서 멈춘다 — Interfaces 항목을 삼키지 않는다", () => {
    expect(parseFiles(body).create).not.toContain("f(): void");
  });

  test("섹션이 없으면 빈 배열 세 개, 예외 없음", () => {
    expect(parseFiles("### Task 1: 없음\n\n본문만 있다")).toEqual({
      create: [], modify: [], test: [],
    });
  });

  test("중복 경로는 한 번만", () => {
    const dup = "**Files:**\n- Create: `x.ts`\n- Create: `x.ts`";
    expect(parseFiles(dup).create).toEqual(["x.ts"]);
  });

  test("존재하지 않는 경로도 그대로 반환한다 (파일시스템 미접근)", () => {
    const ghost = "**Files:**\n- Create: `아직/없는/파일.ts`";
    expect(parseFiles(ghost).create).toEqual(["아직/없는/파일.ts"]);
  });

  test("코드펜스 안의 항목은 무시한다", () => {
    const fenced = [
      "**Files:**",
      "- Create: `real.ts`",
      "",
      "```markdown",
      "**Files:**",
      "- Create: `fake.ts`",
      "```",
    ].join("\n");
    expect(parseFiles(fenced).create).toEqual(["real.ts"]);
  });
});

describe("parseInterfaces", () => {
  test("Consumes 에서 심볼과 출처 태스크를 분리한다", () => {
    const b = "**Interfaces:**\n- Consumes: `PersonaSeed` from Task 2";
    expect(parseInterfaces(b).consumes).toEqual([{ symbol: "PersonaSeed", fromTask: "2" }]);
  });

  test("from 절이 없으면 fromTask 는 null", () => {
    const b = "**Interfaces:**\n- Consumes: `Loose`";
    expect(parseInterfaces(b).consumes).toEqual([{ symbol: "Loose", fromTask: null }]);
  });

  test("Produces 는 서명 전문을 보존한다", () => {
    const b = "**Interfaces:**\n- Produces: `expand(seed: PersonaSeed): string[]`";
    expect(parseInterfaces(b).produces).toEqual(["expand(seed: PersonaSeed): string[]"]);
  });

  test("섹션이 없으면 빈 배열 둘, 예외 없음", () => {
    expect(parseInterfaces("본문만")).toEqual({ consumes: [], produces: [] });
  });
});
```

`import` 줄에 `parseFiles`, `parseInterfaces`, 타입을 추가한다.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test controller/contract.test.ts`
Expected: FAIL — `parseFiles is not a function` / `parseInterfaces is not a function`

- [ ] **Step 3: Write minimal implementation**

`controller/contract.ts`의 `parseTasks` 아래에 추가:

```ts
// ─── 태스크 메타 섹션 파싱 (설계 D6) ─────────────────────────────
//
// 형식은 overlay/writing-plans-tagging.md 가 정의한 것이다. 새로 만들지 않는다.
//
//   **Files:**
//   - Create: `src/a.ts`
//   - Test:   `src/a.test.ts`
//
//   **Interfaces:**
//   - Consumes: `PersonaSeed` from Task 2
//   - Produces: `expand(seed: PersonaSeed): string[]`
//
// 주의: 여기서 나온 경로는 **아직 존재하지 않는 파일**이 대부분이다 (계획서다).
// 존재 확인으로 걸러내면 신규 파일이 전부 사라진다 (설계 D21).

export interface TaskFiles {
  create: string[];
  modify: string[];
  test: string[];
}

export interface ConsumeRef {
  symbol: string;
  /** `from Task N` 의 N. 절이 없으면 null */
  fromTask: string | null;
}

export interface TaskInterfaces {
  consumes: ConsumeRef[];
  produces: string[];
}

/** `**Name:**` 헤딩 다음의 `- ` 항목들을 다음 `**` 헤딩 전까지 모은다. */
function metaSection(body: string, name: string): string[] {
  const lines = stripFences(body).split("\n");
  const head = new RegExp(`^\\s*\\*\\*${name}:\\*\\*\\s*$`);
  const anyHead = /^\s*\*\*[^*]+:\*\*/;
  const items: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (head.test(line)) {
      inside = true;
      continue;
    }
    if (!inside) continue;
    if (anyHead.test(line)) break;
    const m = /^\s*-\s+(.*\S)\s*$/.exec(line);
    if (m) items.push(m[1]);
  }
  return items;
}

const unbacktick = (s: string) => s.replace(/^`|`$/g, "").trim();

const dedupe = (xs: string[]) => [...new Set(xs)];

export function parseFiles(body: string): TaskFiles {
  const out: TaskFiles = { create: [], modify: [], test: [] };
  for (const item of metaSection(body, "Files")) {
    const m = /^(Create|Modify|Test)\s*:\s*(.+)$/i.exec(item);
    if (!m) continue;
    const key = m[1].toLowerCase() as keyof TaskFiles;
    out[key].push(unbacktick(m[2]));
  }
  out.create = dedupe(out.create);
  out.modify = dedupe(out.modify);
  out.test = dedupe(out.test);
  return out;
}

export function parseInterfaces(body: string): TaskInterfaces {
  const consumes: ConsumeRef[] = [];
  const produces: string[] = [];
  for (const item of metaSection(body, "Interfaces")) {
    const c = /^Consumes\s*:\s*(.+)$/i.exec(item);
    if (c) {
      const from = /\bfrom\s+Task\s+(\d+)/i.exec(c[1]);
      const symbol = unbacktick(c[1].replace(/\bfrom\s+Task\s+\d+.*$/i, "").trim());
      consumes.push({ symbol, fromTask: from ? from[1] : null });
      continue;
    }
    const p = /^Produces\s*:\s*(.+)$/i.exec(item);
    if (p) produces.push(unbacktick(p[1]));
  }
  return { consumes, produces };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test controller/contract.test.ts`
Expected: PASS — 새 테스트 전부 통과, 기존 테스트도 전부 통과

- [ ] **Step 5: Commit**

```bash
git add controller/contract.ts controller/contract.test.ts
git commit -m "feat(contract): **Files:** / **Interfaces:** 파싱 (설계 D6)"
```

---

### Task 2: 계약 필수화 — `Files` · `Interfaces` 누락을 위반으로

**Tags:** verification=deterministic validation=invisible

**Files:**
- Modify: `controller/contract.ts`
- Modify: `controller/contract.test.ts`
- Test: `controller/contract.test.ts`

**Interfaces:**
- Consumes: `parseFiles(body: string): TaskFiles` from Task 1
- Consumes: `parseInterfaces(body: string): TaskInterfaces` from Task 1
- Produces: `checkPlan(planText: string): Violation[]` (기존 함수에 규칙 추가 — 시그니처 불변)

**테스트로 증명할 것:**
- [ ] `**Files:**` 섹션이 없는 태스크에 `error` 위반이 하나 생긴다
- [ ] `**Files:**` 는 있지만 `Create`/`Modify` 항목이 하나도 없으면 `error` 위반이 생긴다 (`Test` 만으로는 부족하다)
- [ ] `**Interfaces:**` 섹션이 없는 태스크에 `error` 위반이 하나 생긴다
- [ ] `**Interfaces:**` 가 있고 `Consumes`·`Produces` 둘 다 비어 있으면 `error` 위반이 생긴다
- [ ] `Produces` 만 있고 `Consumes` 가 없는 태스크는 위반이 아니다 (첫 태스크는 소비할 것이 없다)
- [ ] 위반 메시지에 태스크 번호가 들어간다 — 어느 태스크인지 알 수 있다
- [ ] 수정된 정상 픽스처(`GOOD_PLAN`)가 위반 0건으로 통과한다
- [ ] 기존 위반 규칙(태그 누락·헤딩 형식·번호 불연속)이 그대로 작동한다

- [ ] **Step 1: Write the failing test**

`controller/contract.test.ts`에 추가:

```ts
describe("checkPlan — Files/Interfaces 필수 (설계 D6)", () => {
  const task = (extra: string) =>
    [
      "## 태스크",
      "",
      "### Task 1: 예시",
      "",
      "**Tags:** verification=deterministic validation=invisible",
      "",
      extra,
      "",
      "**테스트로 증명할 것:**",
      "- [ ] 무언가 관찰된다",
    ].join("\n");

  const errorsOf = (text: string) =>
    checkPlan(text).filter((v) => v.severity === "error");

  test("Files 섹션이 없으면 error", () => {
    const v = errorsOf(task("**Interfaces:**\n- Produces: `f(): void`"));
    expect(v.some((x) => x.message.includes("Files"))).toBe(true);
  });

  test("Create/Modify 가 하나도 없으면 error — Test 만으로는 부족", () => {
    const v = errorsOf(
      task("**Files:**\n- Test: `a.test.ts`\n\n**Interfaces:**\n- Produces: `f(): void`"),
    );
    expect(v.some((x) => x.message.includes("Files"))).toBe(true);
  });

  test("Interfaces 섹션이 없으면 error", () => {
    const v = errorsOf(task("**Files:**\n- Create: `a.ts`"));
    expect(v.some((x) => x.message.includes("Interfaces"))).toBe(true);
  });

  test("Consumes·Produces 둘 다 비면 error", () => {
    const v = errorsOf(task("**Files:**\n- Create: `a.ts`\n\n**Interfaces:**"));
    expect(v.some((x) => x.message.includes("Interfaces"))).toBe(true);
  });

  test("Produces 만 있어도 통과 — 첫 태스크는 소비할 것이 없다", () => {
    const v = errorsOf(
      task("**Files:**\n- Create: `a.ts`\n\n**Interfaces:**\n- Produces: `f(): void`"),
    );
    expect(v.filter((x) => /Files|Interfaces/.test(x.message))).toEqual([]);
  });

  test("위반 메시지에 태스크 번호가 들어간다", () => {
    const v = errorsOf(task("**Interfaces:**\n- Produces: `f(): void`"));
    expect(v.some((x) => x.message.includes("1"))).toBe(true);
  });
});
```

그리고 **기존 `GOOD_PLAN` 픽스처를 수정한다** — 각 태스크에 `**Interfaces:**` 를 넣고, `**Files:**` 에 `Create` 항목이 있게 한다. 예:

```ts
// 기존 GOOD_PLAN 의 각 Task 블록에 다음을 추가한다.
// Task 1:
//   **Interfaces:**
//   - Produces: `listPersonas(): Persona[]`
// Task 2:
//   **Interfaces:**
//   - Consumes: `listPersonas(): Persona[]` from Task 1
//   - Produces: `PersonaCard`
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test controller/contract.test.ts`
Expected: FAIL — 새 테스트가 실패한다 (`checkPlan`이 아직 Files/Interfaces 를 안 본다). 픽스처 수정 후에는 기존 `GOOD_PLAN` 테스트도 잠시 실패할 수 있다.

- [ ] **Step 3: Write minimal implementation**

`controller/contract.ts`의 `checkPlan` 안, 태스크 순회 루프에 추가:

```ts
    // ── Files / Interfaces 필수 (설계 D6) ───────────────────────
    //
    // Interfaces 가 1단계 기계 검사의 유일한 입력이다. 없으면 preflight 가
    // 관계 그래프를 만들 수 없고, 검사기가 조용히 아무것도 하지 않는다.
    const files = parseFiles(t.body);
    if (files.create.length + files.modify.length === 0) {
      v.push(
        err({
          file: "plan.md",
          rule: "§4.2",
          message: `Task ${t.id}: **Files:** 에 Create 또는 Modify 항목이 없습니다 (Test 만으로는 부족)`,
        }),
      );
    }

    const ifaces = parseInterfaces(t.body);
    if (ifaces.consumes.length + ifaces.produces.length === 0) {
      v.push(
        err({
          file: "plan.md",
          rule: "§4.2",
          message: `Task ${t.id}: **Interfaces:** 에 Consumes 또는 Produces 항목이 없습니다 — 1단계 관계 검사의 입력입니다`,
        }),
      );
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test`
Expected: PASS — 전부 통과. 픽스처 수정으로 기존 테스트도 되살아난다.

- [ ] **Step 5: Commit**

```bash
git add controller/contract.ts controller/contract.test.ts
git commit -m "feat(contract): Files/Interfaces 를 계약 필수 항목으로 (설계 D6)"
```

---

### Task 3: 계약 표면 — 결함 타입 명명과 경로 추가

**Tags:** verification=deterministic validation=invisible

**Files:**
- Modify: `controller/contract.ts`
- Modify: `controller/paths.ts`
- Test: `controller/contract.test.ts`

**Interfaces:**
- Consumes: `BuildResult` (기존 — `controller/contract.ts`)
- Consumes: `ContractPaths` (기존 — `controller/paths.ts`)
- Produces: `interface BuildDefect { task_id: string; plan_text: string; conflict: string; suggested_fix?: string }`, `interface FixPatch { op: "insert_after" | "replace"; task_id: string; anchor: string; text: string }`, `interface PreflightDefect { id: string; kind: DefectKind; task_ids: [string, string, ...string[]]; relation?: string; plan_text: string; conflict: string; patch?: FixPatch; stage: 1 | 2 }`, `type DefectKind = "dangling_ref" | "order_violation" | "signature_mismatch" | "undeclared_conflict"`, `ContractPaths.preflight: string`, `ContractPaths.preflightRaw: string`

**테스트로 증명할 것:**
- [ ] `contractPaths()` 가 `preflight` 를 `<planDir>/preflight.json` 으로 만든다
- [ ] `contractPaths()` 가 `preflightRaw` 를 `<planDir>/preflight-raw.json` 으로 만든다
- [ ] `checkBuildResult` 가 `defects` 항목을 여전히 검증한다 — 타입 이름을 빼내도 동작이 같다
- [ ] `PreflightDefect.task_ids` 에 항목이 1개인 객체는 TypeScript 컴파일이 거부한다

> ⚠️ **이 항목은 단위 테스트가 아니라 `bun run typecheck` 로 관찰한다.** 튜플 타입의
> 최소 길이 강제는 런타임에 존재하지 않으므로 `expect()` 로 확인할 수 없다.
> **리뷰어에게:** 이것을 "assert 없는 테스트"로 반려하지 마라 — 관찰 수단이 컴파일러다.
> 검증 방법은 아래 Step 3 의 주석 처리된 한 줄을 잠깐 풀고 `bun run typecheck` 가
> 실패하는 것을 확인한 뒤 되돌리는 것이다.
> (2026-09-03 봇이 BLOCKED 보고에서 오인 위험을 지적한 항목)

- [ ] **Step 1: Write the failing test**

`controller/contract.test.ts`:

```ts
test("contractPaths 가 preflight 경로 두 개를 만든다", () => {
  const p = contractPaths("/repo", "feature/x");
  expect(p.preflight).toBe("/repo/docs/plans/feature-x/preflight.json");
  expect(p.preflightRaw).toBe("/repo/docs/plans/feature-x/preflight-raw.json");
});
```

그리고 튜플 강제를 증명하는 타입 테스트를 `controller/preflight.test.ts`에 넣기 전, 이 태스크에서는 주석으로 남긴다 — 컴파일 실패는 `bun run typecheck` 로 관찰한다:

```ts
// 타입이 관계를 강제하는지는 typecheck 로 관찰한다 (설계 D27).
// 아래를 주석 해제하면 `bun run typecheck` 가 실패해야 한다:
//   const bad: PreflightDefect["task_ids"] = ["only-one"];
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test controller/contract.test.ts`
Expected: FAIL — `p.preflight` 가 `undefined`

- [ ] **Step 3: Write minimal implementation**

`controller/paths.ts`의 `ContractPaths` 인터페이스와 `contractPaths` 반환에 추가:

```ts
  /** 사전 검사 결과 (정규화됨). 새 파일이다 — build-result.json 에 합치지 않는다 (설계 D7).
   *  게이트 ① 앞에서 builder 가 읽는다 (설계 D26) */
  preflight: string;
  /** 워크플로우가 직접 쓰는 원본. 세션이 값을 옮기지 않는다 (설계 D28) */
  preflightRaw: string;
```

```ts
    preflight: join(planDir, "preflight.json"),
    preflightRaw: join(planDir, "preflight-raw.json"),
```

`controller/contract.ts`에서 익명 타입을 빼낸다:

```ts
// ─── 결함 타입 (설계 D20 · D24 · D27) ────────────────────────────
//
// 두 타입은 다른 것을 뜻한다. 공통 조상을 두지 않는다.
//   BuildDefect      빌드 중 반송 — 태스크 하나의 문제여도 된다
//   PreflightDefect  사전 검사   — 본질적으로 태스크 간 관계다
// 공유해야 하는 것은 **표현**이고, 타입이 아니었다.

export interface BuildDefect {
  task_id: string;
  plan_text: string;
  conflict: string;
  suggested_fix?: string;
}

/** 사람이 승인한 수정을 기계가 그대로 적용하기 위한 패치 (설계 D24) */
export interface FixPatch {
  op: "insert_after" | "replace";
  /** 어느 태스크 본문 안인지. anchor 는 이 범위에서만 찾는다 */
  task_id: string;
  /** 그 태스크 본문에서 찾을 기준 문자열 */
  anchor: string;
  /** 넣거나 바꿀 내용. 바이트 그대로 들어간다 (설계 D14) */
  text: string;
}

export type DefectKind =
  | "dangling_ref"
  | "order_violation"
  | "signature_mismatch"
  | "undeclared_conflict";

export interface PreflightDefect {
  /** `--apply` 의 인자 */
  id: string;
  kind: DefectKind;
  /** 최소 2개. 튜플 타입이 컴파일 시점에 관계를 강제한다 (설계 D27) */
  task_ids: [string, string, ...string[]];
  /** 어느 심볼·인터페이스 때문인지. 1단계 결함은 필수다 */
  relation?: string;
  plan_text: string;
  conflict: string;
  patch?: FixPatch;
  /** 1 = 기계가 확정 · 2 = AI 가 판단 (사람이 신뢰도를 구분할 수 있게) */
  stage: 1 | 2;
}
```

`BuildResult.defects` 를 `BuildDefect[]` 로 바꾼다:

```ts
  defects?: BuildDefect[];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run typecheck && bun test`
Expected: PASS — 타입 추출은 동작을 바꾸지 않는다

- [ ] **Step 5: Commit**

```bash
git add controller/contract.ts controller/paths.ts controller/contract.test.ts
git commit -m "feat(contract): BuildDefect/PreflightDefect/FixPatch 명명 + preflight 경로 (D20·D24·D27)"
```

---

### Task 4: 관계 그래프 — 선언된 의존을 자료구조로

**Tags:** verification=deterministic validation=invisible

**Files:**
- Create: `controller/preflight.ts`
- Test: `controller/preflight.test.ts`

**Interfaces:**
- Consumes: `parseInterfaces(body: string): TaskInterfaces` from Task 1
- Consumes: `ConsumeRef` from Task 1
- Consumes: `ParsedTask` (기존 — `controller/contract.ts`)
- Produces: `buildRelationGraph(tasks: ParsedTask[]): RelationGraph`, `interface RelationGraph { nodes: Map<string, TaskInterfaces>; order: string[]; relations: Relation[] }`, `interface Relation { consumer: string; symbol: string; declaredFrom: string | null }`

**테스트로 증명할 것:**
- [ ] 태스크 3개의 `Interfaces` 가 `nodes` 에 태스크 id 로 들어간다
- [ ] `order` 가 플랜에 나온 순서를 보존한다 (번호 정렬이 아니라 등장 순서)
- [ ] `Consumes` 항목마다 `relations` 에 항목이 하나씩 생긴다
- [ ] 한 태스크가 2개를 소비하면 `relations` 에 2개가 생긴다
- [ ] `Interfaces` 가 없는 태스크도 `nodes` 에 빈 항목으로 들어간다 (누락되지 않는다)
- [ ] 태스크가 0개면 빈 그래프이며 예외가 없다
- [ ] `relations` 의 개수가 전체 `Consumes` 항목 총계와 같다 — 커버리지 분모가 된다 (설계 D25)

- [ ] **Step 1: Write the failing test**

`controller/preflight.test.ts` 신규:

```ts
import { describe, expect, test } from "bun:test";
import { parseTasks } from "./contract";
import { buildRelationGraph } from "./preflight";

const PLAN = [
  "### Task 1: 목록",
  "",
  "**Tags:** verification=deterministic validation=invisible",
  "",
  "**Files:**",
  "- Create: `src/list.ts`",
  "",
  "**Interfaces:**",
  "- Produces: `listAll(): Item[]`",
  "",
  "### Task 2: 필터",
  "",
  "**Tags:** verification=deterministic validation=invisible",
  "",
  "**Files:**",
  "- Create: `src/filter.ts`",
  "",
  "**Interfaces:**",
  "- Consumes: `listAll(): Item[]` from Task 1",
  "- Consumes: `Config` from Task 1",
  "- Produces: `filter(xs: Item[]): Item[]`",
  "",
  "### Task 3: 메타 없음",
  "",
  "**Tags:** verification=deterministic validation=invisible",
  "",
  "본문만 있다",
].join("\n");

describe("buildRelationGraph", () => {
  const g = buildRelationGraph(parseTasks(PLAN));

  test("모든 태스크가 nodes 에 들어간다 — 메타 없는 태스크도", () => {
    expect([...g.nodes.keys()]).toEqual(["1", "2", "3"]);
    expect(g.nodes.get("3")).toEqual({ consumes: [], produces: [] });
  });

  test("order 가 등장 순서를 보존한다", () => {
    expect(g.order).toEqual(["1", "2", "3"]);
  });

  test("Consumes 항목마다 relation 이 하나씩", () => {
    expect(g.relations).toHaveLength(2);
    expect(g.relations[0]).toEqual({
      consumer: "2", symbol: "listAll(): Item[]", declaredFrom: "1",
    });
  });

  test("relations 개수가 전체 Consumes 총계와 같다 (커버리지 분모)", () => {
    const total = parseTasks(PLAN)
      .map((t) => t.body.split("\n").filter((l) => /^\s*-\s+Consumes\s*:/i.test(l)).length)
      .reduce((a, b) => a + b, 0);
    expect(g.relations).toHaveLength(total);
  });

  test("태스크가 없으면 빈 그래프, 예외 없음", () => {
    const empty = buildRelationGraph([]);
    expect(empty.nodes.size).toBe(0);
    expect(empty.relations).toEqual([]);
    expect(empty.order).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test controller/preflight.test.ts`
Expected: FAIL — `Cannot find module './preflight'`

- [ ] **Step 3: Write minimal implementation**

`controller/preflight.ts` 신규:

```ts
/**
 * 계획서 사전 검사 — 판단 로직 (설계 §6.1 D1).
 *
 * **이 파일에는 파일 I/O도 에이전트 호출도 없다.** 순수 함수만 둔다.
 * 워크플로우 스크립트가 파일시스템에 접근할 수 없다는 플랫폼 제약이
 * 이 분리를 강제하고(설계 §5.1), 덕분에 실패 시 원인이 즉시 갈린다:
 *   bun test 실패        → 여기(기계 로직)의 문제
 *   통과인데 결과가 이상 → 에이전트·워크플로우의 문제
 *
 * 1단계 흐름:
 *
 *   plan.md ──> parseTasks ──> parseInterfaces ──> buildRelationGraph
 *                                                        │
 *                       ┌────────────────────────────────┤
 *                       ▼                ▼               ▼
 *                 danglingRefs   orderViolations  signatureCandidates
 *                  (결함 확정)      (결함 확정)     (2단계로 넘김)
 */

import type { ConsumeRef, ParsedTask, TaskInterfaces } from "./contract";
import { parseInterfaces } from "./contract";

/** 하나의 선언된 의존. 커버리지의 단위다 (설계 D25) */
export interface Relation {
  consumer: string;
  symbol: string;
  /** `from Task N` 의 N. 절이 없으면 null */
  declaredFrom: string | null;
}

export interface RelationGraph {
  nodes: Map<string, TaskInterfaces>;
  /** 플랜에 등장한 순서. 번호 정렬이 아니다 — 순서 위반 판정의 기준 */
  order: string[];
  relations: Relation[];
}

export function buildRelationGraph(tasks: ParsedTask[]): RelationGraph {
  const nodes = new Map<string, TaskInterfaces>();
  const order: string[] = [];
  const relations: Relation[] = [];

  for (const t of tasks) {
    const ifaces = parseInterfaces(t.body);
    nodes.set(t.id, ifaces);
    order.push(t.id);
    for (const c of ifaces.consumes) {
      relations.push({ consumer: t.id, symbol: c.symbol, declaredFrom: c.fromTask });
    }
  }

  return { nodes, order, relations };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test controller/preflight.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add controller/preflight.ts controller/preflight.test.ts
git commit -m "feat(preflight): 선언된 관계 그래프 (설계 §6.2 1단계)"
```

---

### Task 5: 1단계 결함 검출 — 매달린 참조 · 순서 위반 · 서명 후보

**Tags:** verification=deterministic validation=invisible

**Files:**
- Modify: `controller/preflight.ts`
- Test: `controller/preflight.test.ts`

**Interfaces:**
- Consumes: `RelationGraph` from Task 4
- Consumes: `Relation` from Task 4
- Consumes: `PreflightDefect` from Task 3
- Consumes: `DefectKind` from Task 3
- Produces: `danglingRefs(g: RelationGraph): PreflightDefect[]`, `orderViolations(g: RelationGraph): PreflightDefect[]`, `signatureCandidates(g: RelationGraph): PreflightDefect[]`, `stage1Defects(g: RelationGraph): PreflightDefect[]`

**테스트로 증명할 것:**
- [ ] `X from Task 1` 을 소비하는데 Task 1 의 `Produces` 에 X 가 없으면 `dangling_ref` 결함이 하나 생긴다
- [ ] `from Task 9` 인데 Task 9 가 플랜에 없으면 `dangling_ref` 결함이 생긴다
- [ ] Task 1 이 `X from Task 3` 을 소비하면 `order_violation` 결함이 생긴다 (뒤 태스크의 산출을 앞에서 씀)
- [ ] 같은 순서 위반이 `dangling_ref` 와 중복 보고되지 않는다
- [ ] `Produces: f(): string[]` 과 `Consumes: f(): Keyword[]` 는 `signature_mismatch` 결함이 **아니라** `stage: 2` 항목으로 나온다
- [ ] 서명이 정확히 같으면 후보가 생기지 않는다
- [ ] 모든 1단계 결함의 `task_ids` 가 2개 이상이고 `relation` 이 채워져 있다
- [ ] 모든 1단계 결함의 `id` 가 서로 다르다
- [ ] `dangling_ref`·`order_violation` 은 `stage: 1`, `signature_mismatch` 는 `stage: 2` 다
- [ ] 관계가 하나도 없는 그래프는 빈 배열을 낸다 (예외 없음)
- [ ] `Produces: \`interface Foo { ... }\`` 를 `Consumes: \`Foo\`` 가 소비하면 **결함이 아니다** — 선언 키워드(`interface`/`type`/`class`/`function`/`const`/`export`)를 벗기고 심볼을 비교한다
- [ ] `Produces: \`type Bar = string\`` 과 `Consumes: \`Bar\`` 도 연결된다
- [ ] 선언 키워드가 없는 `Produces: \`baz(): void\`` 와 `Consumes: \`baz(): void\`` 는 그대로 연결된다

- [ ] **Step 1: Write the failing test**

```ts
import { danglingRefs, orderViolations, signatureCandidates, stage1Defects } from "./preflight";

const planOf = (...blocks: string[]) => blocks.join("\n\n");
const task = (n: number, ifaces: string[]) =>
  [
    `### Task ${n}: T${n}`,
    "",
    "**Tags:** verification=deterministic validation=invisible",
    "",
    "**Files:**",
    `- Create: \`src/t${n}.ts\``,
    "",
    "**Interfaces:**",
    ...ifaces,
  ].join("\n");
const graphOf = (text: string) => buildRelationGraph(parseTasks(text));

describe("danglingRefs", () => {
  test("출처가 그 심볼을 생산하지 않으면 dangling_ref", () => {
    const g = graphOf(planOf(
      task(1, ["- Produces: `alpha()`"]),
      task(2, ["- Consumes: `beta()` from Task 1"]),
    ));
    const d = danglingRefs(g);
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe("dangling_ref");
    expect(d[0].task_ids).toEqual(["2", "1"]);
    expect(d[0].relation).toBe("beta()");
    expect(d[0].stage).toBe(1);
  });

  test("출처 태스크가 아예 없으면 dangling_ref", () => {
    const g = graphOf(planOf(task(1, ["- Consumes: `x` from Task 9"])));
    expect(danglingRefs(g).map((x) => x.kind)).toEqual(["dangling_ref"]);
  });

  test("정상 연결은 결함이 아니다", () => {
    const g = graphOf(planOf(
      task(1, ["- Produces: `alpha()`"]),
      task(2, ["- Consumes: `alpha()` from Task 1"]),
    ));
    expect(danglingRefs(g)).toEqual([]);
  });
});

describe("orderViolations", () => {
  test("앞 태스크가 뒤 태스크의 산출을 소비하면 order_violation", () => {
    const g = graphOf(planOf(
      task(1, ["- Consumes: `late()` from Task 2"]),
      task(2, ["- Produces: `late()`"]),
    ));
    const d = orderViolations(g);
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe("order_violation");
    expect(d[0].stage).toBe(1);
  });

  test("순서 위반은 dangling 과 중복 보고되지 않는다", () => {
    const g = graphOf(planOf(
      task(1, ["- Consumes: `late()` from Task 2"]),
      task(2, ["- Produces: `late()`"]),
    ));
    expect(danglingRefs(g)).toEqual([]);
    expect(stage1Defects(g)).toHaveLength(1);
  });
});

describe("signatureCandidates", () => {
  test("서명이 다르면 stage 2 후보로 넘긴다 — 확정하지 않는다", () => {
    const g = graphOf(planOf(
      task(1, ["- Produces: `f(): string[]`"]),
      task(2, ["- Consumes: `f(): Keyword[]` from Task 1"]),
    ));
    const d = signatureCandidates(g);
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe("signature_mismatch");
    expect(d[0].stage).toBe(2);
  });

  test("서명이 같으면 후보가 없다", () => {
    const g = graphOf(planOf(
      task(1, ["- Produces: `f(): string[]`"]),
      task(2, ["- Consumes: `f(): string[]` from Task 1"]),
    ));
    expect(signatureCandidates(g)).toEqual([]);
  });
});

describe("symbolName 을 통한 선언 키워드 처리", () => {
  test("interface 선언을 소비하면 결함이 아니다", () => {
    const g = graphOf(planOf(
      task(1, ["- Produces: `interface Coverage { declared: number }`"]),
      task(2, ["- Consumes: `Coverage` from Task 1"]),
    ));
    expect(danglingRefs(g)).toEqual([]);
  });

  test("type 선언도 연결된다", () => {
    const g = graphOf(planOf(
      task(1, ["- Produces: `type Verdict = \"CLEAN\" | \"REJECTED\"`"]),
      task(2, ["- Consumes: `Verdict` from Task 1"]),
    ));
    expect(danglingRefs(g)).toEqual([]);
  });

  test("export interface 도 연결된다", () => {
    const g = graphOf(planOf(
      task(1, ["- Produces: `export interface Pair { a: string }`"]),
      task(2, ["- Consumes: `Pair` from Task 1"]),
    ));
    expect(danglingRefs(g)).toEqual([]);
  });

  test("키워드 없는 함수 서명은 그대로 연결된다", () => {
    const g = graphOf(planOf(
      task(1, ["- Produces: `baz(): void`"]),
      task(2, ["- Consumes: `baz(): void` from Task 1"]),
    ));
    expect(danglingRefs(g)).toEqual([]);
  });
});

describe("stage1Defects", () => {
  test("모든 결함의 id 가 서로 다르고 task_ids 가 2개 이상", () => {
    const g = graphOf(planOf(
      task(1, ["- Consumes: `late()` from Task 3", "- Produces: `alpha()`"]),
      task(2, ["- Consumes: `beta()` from Task 1"]),
      task(3, ["- Produces: `late()`"]),
    ));
    const d = stage1Defects(g);
    expect(new Set(d.map((x) => x.id)).size).toBe(d.length);
    for (const x of d) {
      expect(x.task_ids.length).toBeGreaterThanOrEqual(2);
      expect(x.relation).toBeTruthy();
    }
  });

  test("관계가 없으면 빈 배열", () => {
    expect(stage1Defects(graphOf(planOf(task(1, ["- Produces: `a()`"]))))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test controller/preflight.test.ts`
Expected: FAIL — `danglingRefs is not a function`

- [ ] **Step 3: Write minimal implementation**

`controller/preflight.ts` 에 추가:

```ts
import type { PreflightDefect } from "./contract";

/**
 * 심볼 이름만 뽑는다 — `f(a: A): B` 에서 `f`.
 *
 * **선언 키워드를 먼저 벗긴다.** 플랜의 `Produces` 는 TypeScript 선언 형태로 쓰이는 일이
 * 흔하다 (`interface Foo { ... }`, `type Bar = string`). 키워드를 안 벗기면 심볼 이름이
 * "interface" 가 되어, 그것을 `Consumes: \`Foo\`` 로 소비하는 태스크에 거짓 dangling_ref 가
 * 난다. 이 계획서를 이 형식으로 쓰다가 발견된 버그다.
 */
function symbolName(sig: string): string {
  const stripped = sig
    .trim()
    .replace(/^export\s+/, "")
    .replace(/^(interface|type|class|function|const|let|var)\s+/, "");
  const m = /^([A-Za-z_$][\w$]*)/.exec(stripped);
  return m ? m[1] : stripped;
}

/** 같은 심볼을 생산하는지 (이름 기준 — 서명 비교는 signatureCandidates 가 한다) */
function producesSymbol(ifaces: { produces: string[] }, symbol: string): boolean {
  const want = symbolName(symbol);
  return ifaces.produces.some((p) => symbolName(p) === want);
}

const pair = (a: string, b: string): [string, string] => [a, b];

/** 앞 태스크가 뒤 태스크의 산출을 소비하는가 */
function isOutOfOrder(g: RelationGraph, r: Relation): boolean {
  if (!r.declaredFrom) return false;
  const ci = g.order.indexOf(r.consumer);
  const pi = g.order.indexOf(r.declaredFrom);
  return ci !== -1 && pi !== -1 && pi > ci;
}

export function orderViolations(g: RelationGraph): PreflightDefect[] {
  return g.relations.filter((r) => isOutOfOrder(g, r)).map((r, i) => ({
    id: `order-${r.consumer}-${i}`,
    kind: "order_violation" as const,
    task_ids: pair(r.consumer, r.declaredFrom!),
    relation: r.symbol,
    plan_text: `- Consumes: \`${r.symbol}\` from Task ${r.declaredFrom}`,
    conflict:
      `Task ${r.consumer} 이 Task ${r.declaredFrom} 의 산출을 소비하지만, ` +
      `Task ${r.declaredFrom} 이 플랜에서 뒤에 온다. 실행 시점에 아직 없다.`,
    stage: 1 as const,
  }));
}

export function danglingRefs(g: RelationGraph): PreflightDefect[] {
  const out: PreflightDefect[] = [];
  g.relations.forEach((r, i) => {
    if (!r.declaredFrom) return;
    // 순서 위반으로 이미 보고되는 관계는 중복 보고하지 않는다
    if (isOutOfOrder(g, r)) return;
    const src = g.nodes.get(r.declaredFrom);
    if (src && producesSymbol(src, r.symbol)) return;
    out.push({
      id: `dangling-${r.consumer}-${i}`,
      kind: "dangling_ref",
      task_ids: pair(r.consumer, r.declaredFrom),
      relation: r.symbol,
      plan_text: `- Consumes: \`${r.symbol}\` from Task ${r.declaredFrom}`,
      conflict: src
        ? `Task ${r.consumer} 이 \`${r.symbol}\` 를 Task ${r.declaredFrom} 에서 소비하지만, ` +
          `Task ${r.declaredFrom} 의 Produces 에 그 심볼이 없다.`
        : `Task ${r.consumer} 이 Task ${r.declaredFrom} 을 참조하지만 그 태스크가 플랜에 없다.`,
      stage: 1,
    });
  });
  return out;
}

export function signatureCandidates(g: RelationGraph): PreflightDefect[] {
  const out: PreflightDefect[] = [];
  g.relations.forEach((r, i) => {
    if (!r.declaredFrom) return;
    const src = g.nodes.get(r.declaredFrom);
    if (!src) return;
    const want = symbolName(r.symbol);
    const match = src.produces.find((p) => symbolName(p) === want);
    if (!match) return;
    if (match.trim() === r.symbol.trim()) return;
    out.push({
      id: `sig-${r.consumer}-${i}`,
      kind: "signature_mismatch",
      task_ids: pair(r.consumer, r.declaredFrom),
      relation: want,
      plan_text: `- Produces: \`${match}\`  /  - Consumes: \`${r.symbol}\``,
      conflict:
        `같은 심볼 \`${want}\` 의 서명이 다르다. 생산: \`${match}\` · 소비: \`${r.symbol}\`. ` +
        `표기만 다를 수 있으므로 2단계에서 판정한다.`,
      stage: 2,
    });
  });
  return out;
}

/** 1단계 전체. 확정 결함과 2단계 후보를 함께 낸다. */
export function stage1Defects(g: RelationGraph): PreflightDefect[] {
  return [...orderViolations(g), ...danglingRefs(g), ...signatureCandidates(g)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test controller/preflight.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add controller/preflight.ts controller/preflight.test.ts
git commit -m "feat(preflight): 1단계 결함 검출 — 매달린 참조·순서 위반·서명 후보"
```

---

### Task 6: 파일 겹침 짝 — 2단계 검사 단위

**Tags:** verification=deterministic validation=invisible

**Files:**
- Modify: `controller/preflight.ts`
- Test: `controller/preflight.test.ts`

**Interfaces:**
- Consumes: `parseFiles(body: string): TaskFiles` from Task 1
- Consumes: `ParsedTask` (기존 — `controller/contract.ts`)
- Produces: `overlappingPairs(tasks: ParsedTask[]): FilePair[]`, `interface FilePair { a: string; b: string; sharedFiles: string[] }`

**테스트로 증명할 것:**
- [ ] 같은 파일을 `Create`/`Modify` 하는 두 태스크가 짝으로 나온다
- [ ] 겹치는 파일이 없으면 짝이 없다
- [ ] 자기 자신과 짝짓지 않는다
- [ ] 3×7 과 7×3 이 중복으로 나오지 않는다 (한 방향만)
- [ ] 태스크가 1개면 짝이 0개이며 예외가 없다 (엣지 E1)
- [ ] 태스크가 0개면 짝이 0개이며 예외가 없다
- [ ] `sharedFiles` 에 겹친 경로만 들어간다
- [ ] `Test` 파일이 겹쳐도 짝이 되지 않는다 — 테스트 파일 공유는 모순 신호가 아니다

- [ ] **Step 1: Write the failing test**

```ts
import { overlappingPairs } from "./preflight";

const fileTask = (n: number, lines: string[]) =>
  [
    `### Task ${n}: T${n}`,
    "",
    "**Tags:** verification=deterministic validation=invisible",
    "",
    "**Files:**",
    ...lines,
    "",
    "**Interfaces:**",
    `- Produces: \`p${n}()\``,
  ].join("\n");

describe("overlappingPairs", () => {
  test("같은 파일을 건드리는 짝만 나온다", () => {
    const p = overlappingPairs(parseTasks(planOf(
      fileTask(1, ["- Create: `src/a.ts`"]),
      fileTask(2, ["- Modify: `src/a.ts`", "- Create: `src/b.ts`"]),
      fileTask(3, ["- Create: `src/c.ts`"]),
    )));
    expect(p).toHaveLength(1);
    expect(p[0]).toEqual({ a: "1", b: "2", sharedFiles: ["src/a.ts"] });
  });

  test("겹치지 않으면 짝이 없다", () => {
    const p = overlappingPairs(parseTasks(planOf(
      fileTask(1, ["- Create: `x.ts`"]),
      fileTask(2, ["- Create: `y.ts`"]),
    )));
    expect(p).toEqual([]);
  });

  test("한 방향만 — 3×7 과 7×3 이 중복되지 않는다", () => {
    const p = overlappingPairs(parseTasks(planOf(
      fileTask(1, ["- Create: `s.ts`"]),
      fileTask(2, ["- Modify: `s.ts`"]),
    )));
    expect(p).toHaveLength(1);
  });

  test("태스크 1개면 짝 0개, 예외 없음 (E1)", () => {
    expect(overlappingPairs(parseTasks(fileTask(1, ["- Create: `a.ts`"])))).toEqual([]);
  });

  test("태스크 0개면 짝 0개, 예외 없음", () => {
    expect(overlappingPairs([])).toEqual([]);
  });

  test("Test 파일 공유는 짝이 아니다", () => {
    const p = overlappingPairs(parseTasks(planOf(
      fileTask(1, ["- Create: `a.ts`", "- Test: `shared.test.ts`"]),
      fileTask(2, ["- Create: `b.ts`", "- Test: `shared.test.ts`"]),
    )));
    expect(p).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test controller/preflight.test.ts`
Expected: FAIL — `overlappingPairs is not a function`

- [ ] **Step 3: Write minimal implementation**

```ts
import { parseFiles } from "./contract";

export interface FilePair {
  a: string;
  b: string;
  sharedFiles: string[];
}

/**
 * 같은 파일을 **쓰는** 태스크 짝만 낸다.
 *
 * Test 파일은 제외한다 — 두 태스크가 같은 테스트 파일에 케이스를 추가하는 것은
 * 정상이고 모순 신호가 아니다. Create/Modify 만 본다.
 */
export function overlappingPairs(tasks: ParsedTask[]): FilePair[] {
  const writes = tasks.map((t) => {
    const f = parseFiles(t.body);
    return { id: t.id, files: new Set([...f.create, ...f.modify]) };
  });

  const out: FilePair[] = [];
  for (let i = 0; i < writes.length; i++) {
    for (let j = i + 1; j < writes.length; j++) {
      const shared = [...writes[i].files].filter((f) => writes[j].files.has(f));
      if (shared.length) {
        out.push({ a: writes[i].id, b: writes[j].id, sharedFiles: shared });
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test controller/preflight.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add controller/preflight.ts controller/preflight.test.ts
git commit -m "feat(preflight): 파일 겹침 짝 (2단계 검사 단위)"
```

---

### Task 7: 관계 커버리지와 판정

**Tags:** verification=deterministic validation=invisible

**Files:**
- Modify: `controller/preflight.ts`
- Test: `controller/preflight.test.ts`

**Interfaces:**
- Consumes: `RelationGraph` from Task 4
- Consumes: `Relation` from Task 4
- Consumes: `PreflightDefect` from Task 3
- Produces: `relationCoverage(g: RelationGraph, examinedStage2: string[], failed: string[]): RelationCoverage`, `interface RelationCoverage { declared: number; examined_stage1: number; examined_stage2: number; not_examined: string[] }`, `preflightVerdict(defects: PreflightDefect[], coverage: RelationCoverage): Verdict`, `type Verdict = "CLEAN" | "REJECTED"`

**테스트로 증명할 것:**
- [ ] `declared` 가 그래프의 `relations` 개수와 같다
- [ ] 1단계만 돈 경우 `examined_stage1 === declared` 다 (기계는 빠뜨리지 않는다 — 설계 D25)
- [ ] `failed` 로 넘긴 단위가 `not_examined` 에 들어간다
- [ ] `not_examined` 는 비어 있어도 **항상 배열로 존재한다**
- [ ] 관계가 0개면 `declared: 0` 이고 예외가 없다
- [ ] 결함이 0개면 `CLEAN`
- [ ] 결함이 1개 이상이면 `REJECTED`
- [ ] 결함이 0개인데 `not_examined` 가 비어 있지 않으면 **`REJECTED`** — 검사 안 한 것을 통과로 기록하지 않는다

- [ ] **Step 1: Write the failing test**

```ts
import { relationCoverage, preflightVerdict } from "./preflight";

describe("relationCoverage", () => {
  const g = graphOf(planOf(
    task(1, ["- Produces: `a()`"]),
    task(2, ["- Consumes: `a()` from Task 1", "- Produces: `b()`"]),
    task(3, ["- Consumes: `b()` from Task 2"]),
  ));

  test("declared 가 relations 개수와 같다", () => {
    expect(relationCoverage(g, [], []).declared).toBe(g.relations.length);
  });

  test("1단계는 선언된 관계를 전부 본다 (D25)", () => {
    const c = relationCoverage(g, [], []);
    expect(c.examined_stage1).toBe(c.declared);
  });

  test("실패한 단위가 not_examined 에 들어간다", () => {
    expect(relationCoverage(g, ["pair:1x2"], ["pair:2x3"]).not_examined).toEqual(["pair:2x3"]);
  });

  test("not_examined 는 비어도 배열로 존재한다", () => {
    expect(relationCoverage(g, [], []).not_examined).toEqual([]);
  });

  test("관계 0개면 declared 0, 예외 없음", () => {
    const empty = buildRelationGraph([]);
    expect(relationCoverage(empty, [], []).declared).toBe(0);
  });
});

describe("preflightVerdict", () => {
  const clean = { declared: 3, examined_stage1: 3, examined_stage2: 3, not_examined: [] };

  test("결함 0 + 미검사 0 이면 CLEAN", () => {
    expect(preflightVerdict([], clean)).toBe("CLEAN");
  });

  test("결함이 있으면 REJECTED", () => {
    const d = [{ id: "x", kind: "dangling_ref", task_ids: ["1", "2"], plan_text: "", conflict: "", stage: 1 }] as any;
    expect(preflightVerdict(d, clean)).toBe("REJECTED");
  });

  test("결함 0 이라도 미검사가 있으면 REJECTED — 안 본 것을 통과로 쓰지 않는다", () => {
    const gap = { ...clean, not_examined: ["pair:2x3"] };
    expect(preflightVerdict([], gap)).toBe("REJECTED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test controller/preflight.test.ts`
Expected: FAIL — `relationCoverage is not a function`

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * 커버리지는 **관계** 단위로 센다. 태스크 단위로 세지 않는다 (설계 D25).
 *
 * 태스크 전부가 어떤 묶음에 한 번씩 들어가도 묶음 간 관계는 하나도 안 봤을 수 있다.
 * 태스크 차집합은 그때 빈 배열이 되어 거짓 안심을 준다.
 *
 * `examined_stage1 === declared` 가 항상 성립하는 것이 이 필드를 믿을 수 있는
 * 유일한 이유다 — 1단계는 결정론적이라 빠뜨리지 않는다.
 */
export interface RelationCoverage {
  declared: number;
  examined_stage1: number;
  examined_stage2: number;
  /** 검사 대상으로 뽑혔지만 에이전트가 죽거나 스킵된 단위 */
  not_examined: string[];
}

export function relationCoverage(
  g: RelationGraph,
  examinedStage2: string[],
  failed: string[],
): RelationCoverage {
  return {
    declared: g.relations.length,
    examined_stage1: g.relations.length,
    examined_stage2: examinedStage2.length,
    not_examined: [...failed],
  };
}

export type Verdict = "CLEAN" | "REJECTED";

/**
 * 결함이 없어도 **검사하지 못한 단위가 있으면 `REJECTED`** 다.
 * 안 본 것을 통과로 기록하는 것이 이 기능의 최악 실패다 (설계 §7.4).
 */
export function preflightVerdict(
  defects: PreflightDefect[],
  coverage: RelationCoverage,
): Verdict {
  if (defects.length > 0) return "REJECTED";
  if (coverage.not_examined.length > 0) return "REJECTED";
  return "CLEAN";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test controller/preflight.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add controller/preflight.ts controller/preflight.test.ts
git commit -m "feat(preflight): 관계 단위 커버리지 + 판정 (설계 D25)"
```

---

### Task 8: 워크플로우 산출 검증 — 파싱 실패는 `BLOCKED`

**Tags:** verification=deterministic validation=invisible

**Files:**
- Modify: `controller/preflight.ts`
- Test: `controller/preflight.test.ts`

**Interfaces:**
- Consumes: `PreflightDefect` from Task 3
- Consumes: `CheckResult` (기존 — `controller/contract.ts`)
- Consumes: `Violation` (기존 — `controller/contract.ts`)
- Produces: `checkPreflightRaw(raw: string, planSha256: string): CheckResult & { data?: PreflightRaw }`, `interface PreflightRaw { schema: number; plan_sha256: string; stage1: RawStage; stage2: RawStage2; critic?: { additional_defects: PreflightDefect[] } }`, `interface RawStage { relations_declared: number; defects: PreflightDefect[] }`, `interface RawStage2 { units_examined: string[]; units_failed: string[]; defects: PreflightDefect[] }`

> 설계 D11(스키마 검증 · 실패는 `BLOCKED`)의 구현이다. `contract.ts` 의 `checkBuildResult` 와
> 같은 패턴을 따른다 — 이 레포에서 외부 경계를 검증하는 방식은 하나다.

**테스트로 증명할 것:**
- [ ] 유효한 JSON + 유효한 스키마면 `ok: true` 이고 `data` 가 채워진다
- [ ] JSON 파싱 실패면 `ok: false` 이고 위반이 하나 이상 있다
- [ ] `schema` 가 1이 아니면 `ok: false`
- [ ] `plan_sha256` 이 인자와 다르면 `ok: false` — 검사 도중 플랜이 바뀐 것이다 (설계 D28)
- [ ] `stage1.defects` 항목의 `task_ids` 가 1개면 `ok: false`
- [ ] `stage1.defects` 항목에 `kind` 가 없으면 `ok: false`
- [ ] `stage2.units_failed` 가 없으면 `ok: false` — 빠뜨림 기록은 선택이 아니다
- [ ] **`defects` 가 빈 배열인 것은 유효하다** — 결함 없음과 검증 실패를 구분한다
- [ ] `critic` 이 없어도 유효하다 (선택 필드)

- [ ] **Step 1: Write the failing test**

```ts
import { checkPreflightRaw } from "./preflight";

const SHA = "a".repeat(64);
const validDefect = {
  id: "d1", kind: "dangling_ref", task_ids: ["2", "1"],
  relation: "x()", plan_text: "- Consumes: `x()` from Task 1",
  conflict: "없는 심볼", stage: 1,
};
const validRaw = (over: Record<string, unknown> = {}) => JSON.stringify({
  schema: 1,
  plan_sha256: SHA,
  stage1: { relations_declared: 2, defects: [validDefect] },
  stage2: { units_examined: ["pair:1x2"], units_failed: [], defects: [] },
  ...over,
});

describe("checkPreflightRaw", () => {
  test("유효하면 ok 이고 data 가 채워진다", () => {
    const r = checkPreflightRaw(validRaw(), SHA);
    expect(r.ok).toBe(true);
    expect(r.data?.stage1.defects).toHaveLength(1);
  });

  test("JSON 이 깨지면 ok:false", () => {
    const r = checkPreflightRaw("{ not json", SHA);
    expect(r.ok).toBe(false);
    expect(r.violations.length).toBeGreaterThan(0);
  });

  test("schema 가 1이 아니면 ok:false", () => {
    expect(checkPreflightRaw(validRaw({ schema: 2 }), SHA).ok).toBe(false);
  });

  test("plan_sha256 불일치면 ok:false (검사 도중 플랜이 바뀜)", () => {
    expect(checkPreflightRaw(validRaw(), "b".repeat(64)).ok).toBe(false);
  });

  test("task_ids 가 1개면 ok:false", () => {
    const bad = validRaw({
      stage1: { relations_declared: 1, defects: [{ ...validDefect, task_ids: ["1"] }] },
    });
    expect(checkPreflightRaw(bad, SHA).ok).toBe(false);
  });

  test("kind 가 없으면 ok:false", () => {
    const { kind, ...noKind } = validDefect;
    const bad = validRaw({ stage1: { relations_declared: 1, defects: [noKind] } });
    expect(checkPreflightRaw(bad, SHA).ok).toBe(false);
  });

  test("units_failed 가 없으면 ok:false", () => {
    const bad = validRaw({ stage2: { units_examined: [], defects: [] } });
    expect(checkPreflightRaw(bad, SHA).ok).toBe(false);
  });

  test("defects 빈 배열은 유효하다 — 결함 없음과 검증 실패는 다르다", () => {
    const ok = validRaw({ stage1: { relations_declared: 0, defects: [] } });
    expect(checkPreflightRaw(ok, SHA).ok).toBe(true);
  });

  test("critic 은 선택 필드다", () => {
    expect(checkPreflightRaw(validRaw(), SHA).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test controller/preflight.test.ts`
Expected: FAIL — `checkPreflightRaw is not a function`

- [ ] **Step 3: Write minimal implementation**

```ts
import type { CheckResult, Violation } from "./contract";

export interface RawStage {
  relations_declared: number;
  defects: PreflightDefect[];
}

export interface RawStage2 {
  units_examined: string[];
  units_failed: string[];
  defects: PreflightDefect[];
}

export interface PreflightRaw {
  schema: number;
  plan_sha256: string;
  stage1: RawStage;
  stage2: RawStage2;
  critic?: { additional_defects: PreflightDefect[] };
}

const KINDS = new Set([
  "dangling_ref", "order_violation", "signature_mismatch", "undeclared_conflict",
]);

function checkDefectShape(d: unknown, where: string, v: Violation[]): void {
  const o = d as Record<string, unknown>;
  const bad = (m: string) =>
    v.push({ severity: "error", file: "preflight-raw.json", rule: "D27", message: `${where}: ${m}` });
  if (!o || typeof o !== "object") return bad("결함 항목이 객체가 아닙니다");
  if (typeof o.id !== "string" || !o.id) bad("id 가 없습니다");
  if (typeof o.kind !== "string" || !KINDS.has(o.kind)) bad(`kind 가 유효하지 않습니다: ${String(o.kind)}`);
  if (!Array.isArray(o.task_ids) || o.task_ids.length < 2) {
    bad("task_ids 가 2개 미만입니다 — 사전 검사 결함은 관계입니다");
  }
  if (typeof o.plan_text !== "string") bad("plan_text 가 없습니다");
  if (typeof o.conflict !== "string") bad("conflict 가 없습니다");
  if (o.stage !== 1 && o.stage !== 2) bad("stage 가 1 또는 2 가 아닙니다");
}

/**
 * 워크플로우가 쓴 원본을 검증한다.
 *
 * **파싱·검증 실패를 CLEAN 으로 처리하지 않는다** (하드룰 #4). 이 함수가 위반을
 * 돌려주면 호출자는 BLOCKED 로 취급한다. 검사를 안 한 것과 검사해서 깨끗한 것은
 * 다르고, 그 둘을 섞는 것이 이 기능의 최악 실패다.
 */
export function checkPreflightRaw(
  raw: string,
  planSha256: string,
): CheckResult & { data?: PreflightRaw } {
  const v: Violation[] = [];
  const bad = (m: string) =>
    v.push({ severity: "error", file: "preflight-raw.json", rule: "D28", message: m });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    bad(`JSON 파싱 실패: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, violations: v };
  }

  const o = parsed as Record<string, unknown>;
  if (!o || typeof o !== "object") {
    bad("최상위가 객체가 아닙니다");
    return { ok: false, violations: v };
  }
  if (o.schema !== 1) bad(`schema 가 1이 아닙니다: ${String(o.schema)}`);
  if (o.plan_sha256 !== planSha256) {
    bad(`plan_sha256 이 현재 plan.md 와 다릅니다 — 검사 도중 플랜이 바뀌었습니다`);
  }

  const s1 = o.stage1 as Record<string, unknown> | undefined;
  if (!s1 || typeof s1.relations_declared !== "number" || !Array.isArray(s1.defects)) {
    bad("stage1 이 없거나 relations_declared/defects 가 빠졌습니다");
  } else {
    s1.defects.forEach((d, i) => checkDefectShape(d, `stage1.defects[${i}]`, v));
  }

  const s2 = o.stage2 as Record<string, unknown> | undefined;
  if (!s2 || !Array.isArray(s2.units_examined) || !Array.isArray(s2.units_failed) || !Array.isArray(s2.defects)) {
    bad("stage2 가 없거나 units_examined/units_failed/defects 가 빠졌습니다");
  } else {
    s2.defects.forEach((d, i) => checkDefectShape(d, `stage2.defects[${i}]`, v));
  }

  const errors = v.filter((x) => x.severity === "error");
  if (errors.length) return { ok: false, violations: v };
  return { ok: true, violations: v, data: parsed as PreflightRaw };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test controller/preflight.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add controller/preflight.ts controller/preflight.test.ts
git commit -m "feat(preflight): 워크플로우 산출 스키마 검증 — 실패는 BLOCKED (D28·하드룰 #4)"
```

---

### Task 9: 결과 조립과 `applied[]` 누적

**Tags:** verification=deterministic validation=invisible

**Files:**
- Modify: `controller/preflight.ts`
- Test: `controller/preflight.test.ts`

**Interfaces:**
- Consumes: `PreflightRaw` from Task 8
- Consumes: `RelationCoverage` from Task 7
- Consumes: `Verdict` from Task 7
- Consumes: `RelationGraph` from Task 4
- Consumes: `FilePair` from Task 6
- Consumes: `PreflightDefect` from Task 3
- Produces: `assembleResult(input: AssembleInput): PreflightResult`, `interface PreflightResult { schema: 1; branch: string; plan_sha256: string; scope: string; verdict: Verdict; relations: RelationCoverage; examined: ExaminedUnit[]; defects: PreflightDefect[]; applied: AppliedEntry[] }`, `interface AppliedEntry { defect_id: string; at: string; sha256_before: string; sha256_after: string }`, `interface ExaminedUnit { kind: "relation" | "pair" | "cluster"; label: string; task_ids: string[]; result: "clean" | "defect" }`, `interface AssembleInput { branch: string; planSha256: string; raw: PreflightRaw; graph: RelationGraph; pairs: FilePair[]; previousApplied: AppliedEntry[]; now: string }`

> 설계 D9(결과가 "검사하지 않은 것"을 담는다) · D15(무엇을 적용했는지 남긴다) · D29(재검사를
> 넘어 살아남는다)의 구현이다.

**테스트로 증명할 것:**
- [ ] `stage1`·`stage2`·`critic` 의 결함이 하나의 `defects` 배열로 합쳐진다
- [ ] 같은 `id` 의 결함이 두 곳에 있으면 한 번만 남는다 (중복 제거)
- [ ] `previousApplied` 의 항목이 결과의 `applied` 에 그대로 남는다 (설계 D29)
- [ ] `previousApplied` 가 빈 배열이면 `applied` 도 빈 배열이다
- [ ] `examined` 에 선언된 관계 전부가 항목으로 들어간다
- [ ] `verdict` 가 `preflightVerdict` 의 결과와 같다
- [ ] `scope` 가 `"interface-graph+file-overlap"` 이다 — 나중에 범위를 넓힐 때 과거 결과를 구분할 수 있다
- [ ] `raw.stage2.units_failed` 가 `relations.not_examined` 로 전달된다

- [ ] **Step 1: Write the failing test**

```ts
import { assembleResult } from "./preflight";

describe("assembleResult", () => {
  const g = graphOf(planOf(
    task(1, ["- Produces: `a()`"]),
    task(2, ["- Consumes: `a()` from Task 1"]),
  ));
  const d = (id: string, stage: 1 | 2) => ({
    id, kind: "dangling_ref" as const, task_ids: ["2", "1"] as [string, string],
    relation: "a()", plan_text: "", conflict: "", stage,
  });
  const base = {
    branch: "feature/x",
    planSha256: "a".repeat(64),
    graph: g,
    pairs: [],
    previousApplied: [],
    now: "2026-09-03T00:00:00Z",
  };
  const raw = (over: Partial<PreflightRaw> = {}): PreflightRaw => ({
    schema: 1,
    plan_sha256: "a".repeat(64),
    stage1: { relations_declared: 1, defects: [] },
    stage2: { units_examined: [], units_failed: [], defects: [] },
    ...over,
  });

  test("세 곳의 결함이 하나로 합쳐진다", () => {
    const r = assembleResult({ ...base, raw: raw({
      stage1: { relations_declared: 1, defects: [d("s1", 1)] },
      stage2: { units_examined: [], units_failed: [], defects: [d("s2", 2)] },
      critic: { additional_defects: [d("cr", 2)] },
    }) });
    expect(r.defects.map((x) => x.id).sort()).toEqual(["cr", "s1", "s2"]);
  });

  test("같은 id 는 한 번만", () => {
    const r = assembleResult({ ...base, raw: raw({
      stage1: { relations_declared: 1, defects: [d("dup", 1)] },
      stage2: { units_examined: [], units_failed: [], defects: [d("dup", 2)] },
    }) });
    expect(r.defects).toHaveLength(1);
  });

  test("previousApplied 가 살아남는다 (D29)", () => {
    const prev = [{ defect_id: "old", at: "2026-09-01T00:00:00Z", sha256_before: "x", sha256_after: "y" }];
    const r = assembleResult({ ...base, previousApplied: prev, raw: raw() });
    expect(r.applied).toEqual(prev);
  });

  test("previousApplied 가 비면 applied 도 빈 배열", () => {
    expect(assembleResult({ ...base, raw: raw() }).applied).toEqual([]);
  });

  test("선언된 관계 전부가 examined 에 들어간다", () => {
    const r = assembleResult({ ...base, raw: raw() });
    expect(r.examined.filter((u) => u.kind === "relation")).toHaveLength(g.relations.length);
  });

  test("scope 가 범위를 명시한다", () => {
    expect(assembleResult({ ...base, raw: raw() }).scope).toBe("interface-graph+file-overlap");
  });

  test("units_failed 가 not_examined 로 전달된다", () => {
    const r = assembleResult({ ...base, raw: raw({
      stage2: { units_examined: [], units_failed: ["pair:1x2"], defects: [] },
    }) });
    expect(r.relations.not_examined).toEqual(["pair:1x2"]);
    expect(r.verdict).toBe("REJECTED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test controller/preflight.test.ts`
Expected: FAIL — `assembleResult is not a function`

- [ ] **Step 3: Write minimal implementation**

```ts
export interface AppliedEntry {
  defect_id: string;
  at: string;
  sha256_before: string;
  sha256_after: string;
}

export interface ExaminedUnit {
  kind: "relation" | "pair" | "cluster";
  label: string;
  task_ids: string[];
  result: "clean" | "defect";
}

export interface PreflightResult {
  schema: 1;
  branch: string;
  plan_sha256: string;
  /** 이 검사의 범위. 나중에 넓힐 때 과거 결과를 구분하려면 필요하다 */
  scope: string;
  verdict: Verdict;
  relations: RelationCoverage;
  examined: ExaminedUnit[];
  defects: PreflightDefect[];
  /** 사람이 승인해 반영한 수정. **재검사를 넘어 누적된다** (설계 D29) */
  applied: AppliedEntry[];
}

export interface AssembleInput {
  branch: string;
  planSha256: string;
  raw: PreflightRaw;
  graph: RelationGraph;
  pairs: FilePair[];
  previousApplied: AppliedEntry[];
  /** 시각을 주입받는다 — 순수 함수를 유지하려고 (테스트 가능) */
  now: string;
}

export function assembleResult(input: AssembleInput): PreflightResult {
  const { raw, graph, pairs, previousApplied } = input;

  const all = [
    ...raw.stage1.defects,
    ...raw.stage2.defects,
    ...(raw.critic?.additional_defects ?? []),
  ];
  const byId = new Map<string, PreflightDefect>();
  for (const d of all) if (!byId.has(d.id)) byId.set(d.id, d);
  const defects = [...byId.values()];

  const defectiveTasks = new Set(defects.flatMap((d) => d.task_ids));

  const examined: ExaminedUnit[] = [
    ...graph.relations.map((r) => ({
      kind: "relation" as const,
      label: `${r.symbol} (Task ${r.declaredFrom ?? "?"} → Task ${r.consumer})`,
      task_ids: r.declaredFrom ? [r.declaredFrom, r.consumer] : [r.consumer],
      result: (defectiveTasks.has(r.consumer) ? "defect" : "clean") as "clean" | "defect",
    })),
    ...pairs.map((p) => ({
      kind: "pair" as const,
      label: p.sharedFiles.join(", "),
      task_ids: [p.a, p.b],
      result: (defectiveTasks.has(p.a) && defectiveTasks.has(p.b) ? "defect" : "clean") as
        "clean" | "defect",
    })),
  ];

  const relations = relationCoverage(
    graph,
    raw.stage2.units_examined,
    raw.stage2.units_failed,
  );

  return {
    schema: 1,
    branch: input.branch,
    plan_sha256: input.planSha256,
    scope: "interface-graph+file-overlap",
    verdict: preflightVerdict(defects, relations),
    relations,
    examined,
    defects,
    applied: [...previousApplied],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test controller/preflight.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add controller/preflight.ts controller/preflight.test.ts
git commit -m "feat(preflight): 결과 조립 + applied 누적 (설계 D29)"
```

---

### Task 10: 패치 적용 — 태스크 범위 앵커, 0/1/2+ 세 갈래

**Tags:** verification=deterministic validation=invisible

**Files:**
- Modify: `controller/preflight.ts`
- Test: `controller/preflight.test.ts`

**Interfaces:**
- Consumes: `FixPatch` from Task 3
- Consumes: `ParsedTask` (기존 — `controller/contract.ts`)
- Consumes: `parseTasks(planText: string): ParsedTask[]` (기존 — `controller/contract.ts`)
- Produces: `findFixSites(planText: string, patch: FixPatch): number[]`, `applyPatch(planText: string, patch: FixPatch, siteIndex?: number): ApplyOutcome`, `type ApplyOutcome = { status: "applied"; text: string } | { status: "not_found" } | { status: "ambiguous"; sites: number[] }`

**테스트로 증명할 것:**
- [ ] 앵커가 대상 태스크 본문에 한 번 있으면 `applied` 이고 텍스트가 바뀐다
- [ ] `insert_after` 는 앵커 **다음 줄**에 텍스트를 넣는다
- [ ] `replace` 는 앵커 줄을 텍스트로 바꾼다
- [ ] 넣은 텍스트가 `patch.text` 와 **바이트 단위로 같다** (설계 D14)
- [ ] 앵커가 없으면 `not_found` 이고 **원본이 전혀 바뀌지 않는다** (설계 D16)
- [ ] 앵커가 같은 태스크 안에 2번 있으면 `ambiguous` 이고 `sites` 에 2개가 담기며 원본이 안 바뀐다 (D22)
- [ ] **다른 태스크에 같은 앵커가 있어도 매치로 세지 않는다** — 검색 범위가 대상 태스크 본문이다 (설계 D24)
- [ ] `patch.task_id` 가 플랜에 없으면 `not_found`
- [ ] `ambiguous` 에 `siteIndex` 를 주면 그 위치에만 적용된다

- [ ] **Step 1: Write the failing test**

```ts
import { findFixSites, applyPatch } from "./preflight";

const TWO_TASKS = planOf(
  [
    "### Task 1: 저장",
    "",
    "**Tags:** verification=deterministic validation=invisible",
    "",
    "**Files:**",
    "- Create: `src/store.ts`",
    "",
    "**Interfaces:**",
    "- Produces: `save(): void`",
    "",
    "**테스트로 증명할 것:**",
    "- [ ] 공통 문구",
  ].join("\n"),
  [
    "### Task 2: 표시",
    "",
    "**Tags:** verification=deterministic validation=invisible",
    "",
    "**Files:**",
    "- Create: `src/view.ts`",
    "",
    "**Interfaces:**",
    "- Consumes: `save(): void` from Task 1",
    "",
    "**테스트로 증명할 것:**",
    "- [ ] 공통 문구",
  ].join("\n"),
);

describe("findFixSites", () => {
  test("대상 태스크 본문에서만 찾는다 — 다른 태스크의 같은 줄은 세지 않는다", () => {
    const p = { op: "insert_after" as const, task_id: "2", anchor: "- [ ] 공통 문구", text: "- [ ] 새 케이스" };
    expect(findFixSites(TWO_TASKS, p)).toHaveLength(1);
  });

  test("없으면 빈 배열", () => {
    const p = { op: "insert_after" as const, task_id: "2", anchor: "없는 줄", text: "x" };
    expect(findFixSites(TWO_TASKS, p)).toEqual([]);
  });
});

describe("applyPatch", () => {
  const anchor = "- Consumes: `save(): void` from Task 1";

  test("insert_after 는 앵커 다음 줄에 넣고 텍스트가 바이트 그대로다", () => {
    const text = "- Consumes: `Config` from Task 1";
    const r = applyPatch(TWO_TASKS, { op: "insert_after", task_id: "2", anchor, text });
    expect(r.status).toBe("applied");
    if (r.status !== "applied") return;
    const lines = r.text.split("\n");
    const i = lines.indexOf(anchor);
    expect(lines[i + 1]).toBe(text);
  });

  test("replace 는 앵커 줄을 바꾼다", () => {
    const text = "- Consumes: `save(): Promise<void>` from Task 1";
    const r = applyPatch(TWO_TASKS, { op: "replace", task_id: "2", anchor, text });
    expect(r.status).toBe("applied");
    if (r.status !== "applied") return;
    expect(r.text).toContain(text);
    expect(r.text).not.toContain(anchor);
  });

  test("앵커가 없으면 not_found 이고 원본이 안 바뀐다 (D16)", () => {
    const before = TWO_TASKS;
    const r = applyPatch(TWO_TASKS, { op: "replace", task_id: "2", anchor: "없음", text: "x" });
    expect(r.status).toBe("not_found");
    expect(TWO_TASKS).toBe(before);
  });

  test("같은 태스크에 앵커가 2번이면 ambiguous, 원본 불변 (D22)", () => {
    const dup = planOf(
      [
        "### Task 1: 중복",
        "",
        "**Tags:** verification=deterministic validation=invisible",
        "",
        "**Files:**",
        "- Create: `a.ts`",
        "",
        "**Interfaces:**",
        "- Produces: `f()`",
        "",
        "**테스트로 증명할 것:**",
        "- [ ] 같은 줄",
        "- [ ] 같은 줄",
      ].join("\n"),
    );
    const r = applyPatch(dup, { op: "insert_after", task_id: "1", anchor: "- [ ] 같은 줄", text: "x" });
    expect(r.status).toBe("ambiguous");
    if (r.status !== "ambiguous") return;
    expect(r.sites).toHaveLength(2);
  });

  test("task_id 가 없으면 not_found", () => {
    const r = applyPatch(TWO_TASKS, { op: "replace", task_id: "9", anchor, text: "x" });
    expect(r.status).toBe("not_found");
  });

  test("ambiguous 에 siteIndex 를 주면 그 위치에만 적용된다", () => {
    const dup = planOf(
      [
        "### Task 1: 중복",
        "",
        "**Tags:** verification=deterministic validation=invisible",
        "",
        "**Files:**",
        "- Create: `a.ts`",
        "",
        "**Interfaces:**",
        "- Produces: `f()`",
        "",
        "**테스트로 증명할 것:**",
        "- [ ] 같은 줄",
        "- [ ] 같은 줄",
      ].join("\n"),
    );
    const sites = findFixSites(dup, { op: "insert_after", task_id: "1", anchor: "- [ ] 같은 줄", text: "x" });
    const r = applyPatch(dup, { op: "insert_after", task_id: "1", anchor: "- [ ] 같은 줄", text: "x" }, sites[1]);
    expect(r.status).toBe("applied");
    if (r.status !== "applied") return;
    const lines = r.text.split("\n");
    expect(lines[sites[1] + 1]).toBe("x");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test controller/preflight.test.ts`
Expected: FAIL — `findFixSites is not a function`

- [ ] **Step 3: Write minimal implementation**

```ts
import { parseTasks } from "./contract";
import type { FixPatch } from "./contract";

/** 대상 태스크가 플랜 전체에서 차지하는 줄 범위 [시작, 끝) */
function taskLineRange(planText: string, taskId: string): [number, number] | null {
  const lines = planText.split("\n");
  const heading = new RegExp(`^#{1,6}[ \\t]+Task[ \\t]+${taskId}([^0-9]|$)`);
  const anyHeading = /^#{1,6}[ \t]+Task[ \t]+\d+/;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (heading.test(lines[i])) { start = i; break; }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (anyHeading.test(lines[i])) { end = i; break; }
  }
  return [start, end];
}

/**
 * 앵커 위치를 찾는다. **검색 범위는 대상 태스크 본문뿐이다** (설계 D24).
 *
 * 플랜 전체에서 찾으면 다른 태스크의 같은 줄에 매치된다 — 계획서에는
 * `- [ ] ...` 같은 줄이 반복되므로 그 사고가 흔하다.
 */
export function findFixSites(planText: string, patch: FixPatch): number[] {
  const range = taskLineRange(planText, patch.task_id);
  if (!range) return [];
  const [start, end] = range;
  const lines = planText.split("\n");
  const sites: number[] = [];
  for (let i = start; i < end; i++) {
    if (lines[i].trim() === patch.anchor.trim()) sites.push(i);
  }
  return sites;
}

export type ApplyOutcome =
  | { status: "applied"; text: string }
  | { status: "not_found" }
  | { status: "ambiguous"; sites: number[] };

/**
 * 승인된 패치를 적용한다.
 *
 * 세 갈래가 전부 다르게 처리된다 (설계 D16 · D22):
 *   0개  → not_found  (부분 적용 금지. 아무것도 바꾸지 않는다)
 *   1개  → applied
 *   2개+ → ambiguous  (첫 번째를 조용히 고르지 않는다. 사람이 고른다)
 *
 * `patch.text` 는 **바이트 그대로** 들어간다 (설계 D14) — 승인한 텍스트와
 * 실제로 들어간 텍스트가 달라지면 승인이 의미를 잃는다.
 */
export function applyPatch(
  planText: string,
  patch: FixPatch,
  siteIndex?: number,
): ApplyOutcome {
  const sites = findFixSites(planText, patch);
  if (sites.length === 0) return { status: "not_found" };
  if (sites.length > 1 && siteIndex === undefined) {
    return { status: "ambiguous", sites };
  }
  const at = siteIndex ?? sites[0];
  if (!sites.includes(at)) return { status: "not_found" };

  const lines = planText.split("\n");
  if (patch.op === "replace") {
    lines[at] = patch.text;
  } else {
    lines.splice(at + 1, 0, patch.text);
  }
  return { status: "applied", text: lines.join("\n") };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test controller/preflight.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add controller/preflight.ts controller/preflight.test.ts
git commit -m "feat(preflight): 패치 적용 — 태스크 범위 앵커, 0/1/2+ 세 갈래 (D14·D16·D22·D24)"
```

---

### Task 11: `bin/preflight` CLI — 네 모드

**Tags:** verification=deterministic validation=invisible

**Files:**
- Create: `bin/preflight`
- Create: `controller/preflight-cli.ts`
- Modify: `controller/preflight.ts`
- Test: `controller/preflight.test.ts`

**Interfaces:**
- Consumes: `stage1Defects(g: RelationGraph): PreflightDefect[]` from Task 5
- Consumes: `overlappingPairs(tasks: ParsedTask[]): FilePair[]` from Task 6
- Consumes: `checkPreflightRaw(raw: string, planSha256: string): CheckResult & { data?: PreflightRaw }` from Task 8
- Consumes: `assembleResult(input: AssembleInput): PreflightResult` from Task 9
- Consumes: `applyPatch(planText: string, patch: FixPatch, siteIndex?: number): ApplyOutcome` from Task 10
- Consumes: `ContractPaths` from Task 3
- Produces: `gateDecision(input: GateInput): GateOutcome`, `interface GateInput { planExists: boolean; planSha256: string; previous: PreflightResult | null; contractOk: boolean }`, `type GateOutcome = { action: "skip"; reason: string } | { action: "run"; reason: string } | { action: "cached"; reason: string }`, CLI: `bin/preflight <branch> --gate|--plan|--record|--apply <id...>`

> 설계 D12(적용은 검사와 분리된 별도 명령이다)의 구현이다 — `--record` 에서 멈추고,
> `--apply` 는 사람이 시작한다.

**테스트로 증명할 것:**
- [ ] `plan.md` 가 없으면 `gateDecision` 이 `skip` 을 낸다 (엣지 E4 — 오류가 아니다)
- [ ] 계약 검증이 실패하면 `skip` 을 낸다 (형식이 먼저다)
- [ ] 이전 결과가 없으면 `run` 을 낸다
- [ ] 이전 결과의 해시가 다르면 `run` 을 낸다
- [ ] 이전 결과의 해시가 같고 `verdict: "CLEAN"` 이면 `cached` 를 낸다
- [ ] 이전 결과의 해시가 같지만 `verdict: "REJECTED"` 면 **`run`** 을 낸다 (설계 D10 — 결함이 캐시를 타고 통과하지 않는다)
- [ ] 각 결정에 사람이 읽을 `reason` 이 있다

- [ ] **Step 1: Write the failing test**

```ts
import { gateDecision } from "./preflight";

describe("gateDecision (설계 D10)", () => {
  const SHA = "a".repeat(64);
  const prev = (verdict: "CLEAN" | "REJECTED", sha = SHA) =>
    ({ verdict, plan_sha256: sha } as any);

  test("plan.md 가 없으면 skip — 오류가 아니다 (E4)", () => {
    const r = gateDecision({ planExists: false, planSha256: "", previous: null, contractOk: true });
    expect(r.action).toBe("skip");
    expect(r.reason).toBeTruthy();
  });

  test("계약 검증 실패면 skip — 형식이 먼저다", () => {
    expect(gateDecision({ planExists: true, planSha256: SHA, previous: null, contractOk: false }).action)
      .toBe("skip");
  });

  test("이전 결과가 없으면 run", () => {
    expect(gateDecision({ planExists: true, planSha256: SHA, previous: null, contractOk: true }).action)
      .toBe("run");
  });

  test("해시가 다르면 run", () => {
    expect(gateDecision({
      planExists: true, planSha256: SHA, previous: prev("CLEAN", "b".repeat(64)), contractOk: true,
    }).action).toBe("run");
  });

  test("해시 같고 CLEAN 이면 cached", () => {
    expect(gateDecision({
      planExists: true, planSha256: SHA, previous: prev("CLEAN"), contractOk: true,
    }).action).toBe("cached");
  });

  test("해시 같지만 REJECTED 면 run — 결함이 캐시를 타지 않는다 (D10)", () => {
    expect(gateDecision({
      planExists: true, planSha256: SHA, previous: prev("REJECTED"), contractOk: true,
    }).action).toBe("run");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test controller/preflight.test.ts`
Expected: FAIL — `gateDecision is not a function`

- [ ] **Step 3: Write minimal implementation**

`controller/preflight.ts` 에 추가:

```ts
export interface GateInput {
  planExists: boolean;
  planSha256: string;
  previous: PreflightResult | null;
  contractOk: boolean;
}

export type GateOutcome =
  | { action: "skip"; reason: string }
  | { action: "run"; reason: string }
  | { action: "cached"; reason: string };

/**
 * 검사를 돌릴지 판정한다.
 *
 * **캐시 적중 조건은 "같은 해시 + 유효한 CLEAN"이다** (설계 D10).
 * 해시 일치만으로 통과시키면 직전 REJECTED 가 "이미 검사됨"이 되어
 * 결함 있는 플랜이 캐시를 타고 게이트 ① 을 지나간다.
 */
export function gateDecision(input: GateInput): GateOutcome {
  if (!input.planExists) {
    return { action: "skip", reason: "plan.md 가 아직 없습니다 — 검사 대상이 없습니다" };
  }
  if (!input.contractOk) {
    return { action: "skip", reason: "계약(형식) 검증이 먼저 통과해야 합니다" };
  }
  const p = input.previous;
  if (!p) {
    return { action: "run", reason: "이 플랜은 아직 검사되지 않았습니다" };
  }
  if (p.plan_sha256 !== input.planSha256) {
    return { action: "run", reason: "검사 이후 plan.md 가 바뀌었습니다" };
  }
  if (p.verdict !== "CLEAN") {
    return { action: "run", reason: `직전 결과가 ${p.verdict} 입니다 — 캐시를 쓰지 않습니다` };
  }
  return { action: "cached", reason: "같은 내용으로 이미 CLEAN 판정을 받았습니다" };
}
```

`bin/preflight` 신규 (실행 권한 필요):

```bash
#!/usr/bin/env bash
# 계획서 사전 검사 (설계 §6.2). 워크플로우는 메인 세션만 부를 수 있으므로
# 기계 단계(--gate/--plan/--record/--apply)만 여기 있다. 에이전트 단계는
# /preflight 스킬이 세션에서 돌린다.
#
#   bin/preflight <branch> --gate            형식+해시 판정 (훅이 부른다)
#   bin/preflight <branch> --plan            1단계 실행 → args JSON 을 stdout
#   bin/preflight <branch> --record          preflight-raw.json → preflight.json
#   bin/preflight <branch> --apply <id...>   승인된 패치 적용
set -uo pipefail

HARNESS="$(cd "$(dirname "$0")/.." && pwd)"
BRANCH="${1:-}"
MODE="${2:-}"

if [ -z "$BRANCH" ] || [ -z "$MODE" ]; then
  echo "usage: bin/preflight <branch> --gate|--plan|--record|--apply <id...>" >&2
  exit 2
fi

shift 2
exec bun "$HARNESS/controller/preflight-cli.ts" "$BRANCH" "$MODE" "$@"
```

`controller/preflight-cli.ts` 신규 — 파일 I/O 를 여기 모은다 (순수 함수는 `preflight.ts` 에 남는다):

```ts
/**
 * bin/preflight 의 구현. **여기에만 파일 I/O 가 있다.**
 * 판단은 전부 preflight.ts 의 순수 함수가 한다 (설계 D1).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { checkPlan, parseTasks } from "./contract";
import { contractPaths } from "./paths";
import {
  applyPatch, assembleResult, buildRelationGraph, checkPreflightRaw,
  gateDecision, overlappingPairs, stage1Defects,
  type PreflightResult,
} from "./preflight";
// findFixSites 를 import 하지 마라. 이 파일에서 쓰이지 않고,
// tsconfig 의 noUnusedLocals: true 때문에 Step 4 의 typecheck 가 실패한다.
// (2026-09-03 봇이 BLOCKED 보고에서 지적한 결함)

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const readOr = (p: string, d = "") => (existsSync(p) ? readFileSync(p, "utf8") : d);

const [branch, mode, ...rest] = process.argv.slice(2);
const p = contractPaths(process.env.TARGET_REPO ?? process.cwd(), branch);

const planText = readOr(p.plan);
const planSha = planText ? sha256(planText) : "";
const previous: PreflightResult | null = existsSync(p.preflight)
  ? (JSON.parse(readFileSync(p.preflight, "utf8")) as PreflightResult)
  : null;

if (mode === "--gate") {
  const contractOk = planText
    ? checkPlan(planText).filter((v) => v.severity === "error").length === 0
    : false;
  const d = gateDecision({ planExists: Boolean(planText), planSha256: planSha, previous, contractOk });
  console.log(`${d.action}: ${d.reason}`);
  if (d.action === "run") {
    console.log("→ /preflight 를 실행해 내용 검사를 돌리세요.");
  }
  process.exit(0); // 훅은 저장을 막지 않는다 (설계 D23)
}

if (mode === "--plan") {
  const tasks = parseTasks(planText);
  const graph = buildRelationGraph(tasks);
  const defects = stage1Defects(graph);
  const pairs = overlappingPairs(tasks);
  console.log(JSON.stringify({
    planPath: p.plan,
    rawPath: p.preflightRaw,
    planSha256: planSha,
    relationsDeclared: graph.relations.length,
    stage1Defects: defects.filter((d) => d.stage === 1),
    stage2Candidates: defects.filter((d) => d.stage === 2),
    pairs,
  }, null, 2));
  process.exit(0);
}

if (mode === "--record") {
  const raw = readOr(p.preflightRaw);
  if (!raw) {
    console.error("BLOCKED: preflight-raw.json 이 없습니다 — 워크플로우가 결과를 남기지 않았습니다");
    process.exit(1);
  }
  const checked = checkPreflightRaw(raw, planSha);
  if (!checked.ok || !checked.data) {
    console.error("BLOCKED: preflight-raw.json 검증 실패");
    for (const v of checked.violations) console.error(`  ${v.severity}: ${v.message}`);
    process.exit(1);
  }
  const tasks = parseTasks(planText);
  const result = assembleResult({
    branch,
    planSha256: planSha,
    raw: checked.data,
    graph: buildRelationGraph(tasks),
    pairs: overlappingPairs(tasks),
    previousApplied: previous?.applied ?? [],
    now: new Date().toISOString(),
  });
  writeFileSync(p.preflight, JSON.stringify(result, null, 2), "utf8");
  console.log(`${result.verdict} — 결함 ${result.defects.length}건 · 관계 ${result.relations.declared}개 검사`);
  if (result.relations.not_examined.length) {
    console.log(`검사 안 한 것: ${result.relations.not_examined.join(", ")}`);
  }
  process.exit(result.verdict === "CLEAN" ? 0 : 1);
}

if (mode === "--apply") {
  if (!previous) {
    console.error("preflight.json 이 없습니다 — 먼저 --record 를 실행하세요");
    process.exit(2);
  }
  let text = planText;
  const before = planSha;
  const applied = [...previous.applied];
  for (const id of rest) {
    const d = previous.defects.find((x) => x.id === id);
    if (!d?.patch) {
      console.error(`결함 ${id} 에 적용할 패치가 없습니다`);
      process.exit(2);
    }
    const r = applyPatch(text, d.patch);
    if (r.status === "not_found") {
      console.error(`결함 ${id}: 앵커를 찾지 못했습니다 — 아무것도 적용하지 않았습니다`);
      process.exit(1);
    }
    if (r.status === "ambiguous") {
      console.error(`결함 ${id}: 후보 위치가 ${r.sites.length}개입니다 — 사람이 골라야 합니다`);
      for (const s of r.sites) console.error(`  줄 ${s + 1}`);
      process.exit(3);
    }
    text = r.text;
    applied.push({
      defect_id: id, at: new Date().toISOString(),
      sha256_before: before, sha256_after: sha256(text),
    });
  }
  writeFileSync(p.plan, text, "utf8");
  writeFileSync(p.preflight, JSON.stringify({ ...previous, applied }, null, 2), "utf8");
  console.log(`적용 ${rest.length}건 — plan.md 가 바뀌었으므로 재검사가 필요합니다`);
  process.exit(0);
}

console.error(`알 수 없는 모드: ${mode}`);
process.exit(2);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `chmod +x bin/preflight && bun run typecheck && bun test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add bin/preflight controller/preflight-cli.ts controller/preflight.ts controller/preflight.test.ts
git commit -m "feat(preflight): bin/preflight CLI 네 모드 + gateDecision (설계 D10·D23)"
```

---

### Task 12: 워크플로우 스크립트 — 2단계 에이전트 팬아웃

**Tags:** verification=deterministic validation=invisible

**Files:**
- Create: `workflows/plan-preflight.js`
- Test: `controller/preflight.test.ts` (픽스처 왕복)

**Interfaces:**
- Consumes: `gateDecision(input: GateInput): GateOutcome` from Task 11
- Consumes: `PreflightRaw` from Task 8
- Produces: `workflows/plan-preflight.js` — `docs/plans/<slug>/preflight-raw.json` 을 쓰는 워크플로우 스크립트

**테스트로 증명할 것:**
- [ ] 스크립트가 쓰는 형식의 픽스처 JSON 을 `checkPreflightRaw` 가 `ok: true` 로 통과시킨다 (형식 왕복)
- [ ] 픽스처에서 `units_failed` 에 항목을 넣으면 `assembleResult` 가 `not_examined` 로 옮기고 `verdict` 가 `REJECTED` 가 된다
- [ ] 스크립트 파일에 `agent(` 호출이 있는 모든 곳에 `model:` 이 함께 있다 — 하드룰 #3 (스크립트를 텍스트로 읽어 `agent(` 개수와 `model:` 개수를 비교한다)

> **증거의 한계를 명기한다.** 이 파일은 워크플로우 런타임 전역(`agent`/`pipeline`)에 의존해
> 단위 테스트로 실행할 수 없다 (설계 §6.1). 위 세 항목이 이 태스크에서 얻을 수 있는 관찰의
> 전부다. 실제 에이전트 동작은 Task 14 의 픽스처 1회 실행에서 관찰한다.

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from "node:fs";

describe("워크플로우 스크립트 (Task 12)", () => {
  const src = readFileSync("workflows/plan-preflight.js", "utf8");

  test("모든 agent() 호출에 model 이 명시돼 있다 (하드룰 #3)", () => {
    const calls = (src.match(/\bagent\(/g) ?? []).length;
    const models = (src.match(/\bmodel\s*:/g) ?? []).length;
    expect(calls).toBeGreaterThan(0);
    expect(models).toBeGreaterThanOrEqual(calls);
  });

  test("meta 블록이 있다", () => {
    expect(src).toContain("export const meta");
  });
});

describe("워크플로우 산출 형식 왕복", () => {
  const SHA = "a".repeat(64);
  const asWorkflowWrites = {
    schema: 1,
    plan_sha256: SHA,
    stage1: { relations_declared: 2, defects: [] },
    stage2: { units_examined: ["pair:1x2"], units_failed: [], defects: [] },
    critic: { additional_defects: [] },
  };

  test("스크립트가 쓰는 형식이 checkPreflightRaw 를 통과한다", () => {
    expect(checkPreflightRaw(JSON.stringify(asWorkflowWrites), SHA).ok).toBe(true);
  });

  test("units_failed 가 있으면 REJECTED 로 이어진다", () => {
    const withFail = {
      ...asWorkflowWrites,
      stage2: { ...asWorkflowWrites.stage2, units_failed: ["pair:1x2"] },
    };
    const checked = checkPreflightRaw(JSON.stringify(withFail), SHA);
    expect(checked.ok).toBe(true);
    const g = graphOf(planOf(task(1, ["- Produces: `a()`"]), task(2, ["- Consumes: `a()` from Task 1"])));
    const r = assembleResult({
      branch: "feature/x", planSha256: SHA, raw: checked.data!, graph: g,
      pairs: [], previousApplied: [], now: "2026-09-03T00:00:00Z",
    });
    expect(r.relations.not_examined).toEqual(["pair:1x2"]);
    expect(r.verdict).toBe("REJECTED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test controller/preflight.test.ts`
Expected: FAIL — `ENOENT: workflows/plan-preflight.js`

- [ ] **Step 3: Write minimal implementation**

`workflows/plan-preflight.js` 신규:

```js
export const meta = {
  name: 'plan-preflight',
  description: '게이트 ① 앞에서 계획서의 할 일 간 모순을 찾는다 (2단계 AI 검사)',
  phases: [
    { title: 'Candidates', detail: '1단계가 넘긴 서명 후보 판정' },
    { title: 'Undeclared', detail: '선언되지 않은 충돌 탐색' },
    { title: 'Critic', detail: '완결성 검사관 — 놓친 관계' },
    { title: 'Verify', detail: '반증 — 애매하면 결함이 아니다' },
    { title: 'Fix', detail: '살아남은 결함의 수정 패치' },
  ],
}

// args = bin/preflight <branch> --plan 의 출력
// { planPath, rawPath, planSha256, relationsDeclared,
//   stage1Defects[], stage2Candidates[], pairs[] }
//
// 이 스크립트는 파일을 읽을 수 없다 (플랫폼 제약). 판단 로직도 두지 않는다 —
// controller/preflight.ts 가 그것을 갖는다 (설계 D1). 여기 있는 것은
// agent() 호출과 결과 수집뿐이다.
//
// 모델은 모든 호출에 명시한다 (하드룰 #3 · 설계 D19). 워크플로우 레퍼런스는
// 생략을 기본으로 하지만, 에이전트가 20개 넘게 뜨는 곳에서 생략하면 세션
// 모델을 상속해 티어 정책이 조용히 무력화된다.

const DEFECT_SCHEMA = {
  type: 'object',
  required: ['defects'],
  properties: {
    defects: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'kind', 'task_ids', 'plan_text', 'conflict', 'stage'],
        properties: {
          id: { type: 'string' },
          kind: { enum: ['dangling_ref', 'order_violation', 'signature_mismatch', 'undeclared_conflict'] },
          task_ids: { type: 'array', items: { type: 'string' }, minItems: 2 },
          relation: { type: 'string' },
          plan_text: { type: 'string' },
          conflict: { type: 'string' },
          stage: { enum: [1, 2] },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['refuted', 'why'],
  properties: { refuted: { type: 'boolean' }, why: { type: 'string' } },
}

const PATCH_SCHEMA = {
  type: 'object',
  required: ['op', 'task_id', 'anchor', 'text'],
  properties: {
    op: { enum: ['insert_after', 'replace'] },
    task_id: { type: 'string' },
    anchor: { type: 'string' },
    text: { type: 'string' },
  },
}

const PLAN = args.planPath
const examined = []
const failed = []

// ── 1) 서명 후보 판정 ────────────────────────────────────────────
phase('Candidates')
const sigResults = await parallel((args.stage2Candidates ?? []).map((c) => () =>
  agent(
    `${PLAN} 의 Task ${c.task_ids[0]} 과 Task ${c.task_ids[1]} 는 심볼 \`${c.relation}\` 의\n` +
    `서명이 텍스트로 다르다:\n${c.plan_text}\n\n` +
    `표기만 다른가, 실제로 타입이 안 맞는가? 실제로 안 맞을 때만 결함으로 보고하라.\n` +
    `보고할 때 id 는 "${c.id}" 를 그대로 쓰고 stage 는 2 로 한다.`,
    { label: `sig:${c.id}`, phase: 'Candidates', schema: DEFECT_SCHEMA, model: 'sonnet' },
  ).then((r) => { examined.push(`sig:${c.id}`); return r })
    .catch(() => { failed.push(`sig:${c.id}`); return null })))

// ── 2) 선언되지 않은 충돌 탐색 (파일 겹침 짝마다) ────────────────
phase('Undeclared')
const pairResults = await parallel((args.pairs ?? []).map((p) => () => {
  const unit = `pair:${p.a}x${p.b}`
  return agent(
    `${PLAN} 의 Task ${p.a} 와 Task ${p.b} 는 다음 파일을 함께 건드린다:\n` +
    `${p.sharedFiles.join(', ')}\n\n` +
    `**Interfaces:** 에 선언되지 않았지만 실제로 충돌하는 것이 있는가?\n` +
    `예: 한쪽이 값을 어떤 형식으로 저장하고 다른 쪽이 다른 형식으로 읽는 경우.\n` +
    `선언된 관계는 이미 기계가 검사했으니 중복 보고하지 마라.\n` +
    `id 는 "${unit}-<번호>" 형식으로, kind 는 "undeclared_conflict", stage 는 2 로 한다.`,
    { label: unit, phase: 'Undeclared', schema: DEFECT_SCHEMA, model: 'opus' },
  ).then((r) => { examined.push(unit); return r })
    .catch(() => { failed.push(unit); return null })
}))

const found = [...sigResults, ...pairResults]
  .filter(Boolean)
  .flatMap((r) => r.defects ?? [])

// ── 3) 완결성 검사관 (설계 D17) ──────────────────────────────────
phase('Critic')
log(`검사 단위 ${examined.length}개 · 실패 ${failed.length}개 · 발견 ${found.length}건`)
const critic = await agent(
  `${PLAN} 전문을 읽어라. 지금까지 검사한 단위와 발견한 결함은 이렇다:\n` +
  `검사 단위: ${examined.join(', ') || '(없음)'}\n` +
  `발견: ${found.map((d) => `${d.id}(${d.task_ids.join('×')})`).join(', ') || '(없음)'}\n\n` +
  `**놓친 관계가 있는가?** 위 단위에 포함되지 않은 태스크 조합에서 모순을 찾아라.\n` +
  `id 는 "critic-<번호>", kind 는 "undeclared_conflict", stage 는 2 로 한다.`,
  { label: 'critic', phase: 'Critic', schema: DEFECT_SCHEMA, model: 'opus' },
).catch(() => { failed.push('critic'); return null })

const candidates = [...found, ...(critic?.defects ?? [])]

// ── 4) 반증 — 애매하면 결함이 아니다 (설계 D4) ───────────────────
phase('Verify')
const survivors = (await parallel(candidates.map((d) => () =>
  agent(
    `다음 주장을 반증하라: ${d.conflict}\n관련 태스크: ${d.task_ids.join(', ')}\n` +
    `인용된 플랜 원문: ${d.plan_text}\n\n` +
    `계획서 ${PLAN} 를 읽고 판단하라. **불확실하면 refuted=true 가 기본값이다.**\n` +
    `오탐이 정상 플랜을 반송시키는 것이 놓치는 것보다 비싸다.`,
    { label: `refute:${d.id}`, phase: 'Verify', schema: VERDICT_SCHEMA, model: 'sonnet' },
  ).then((v) => (v && !v.refuted ? d : null)).catch(() => null))))
  .filter(Boolean)

// ── 5) 수정 패치 (설계 D24) ──────────────────────────────────────
phase('Fix')
const withPatch = await pipeline(
  survivors,
  (d) => agent(
    `계획서 ${PLAN} 의 다음 결함을 고칠 패치를 내라:\n${d.conflict}\n` +
    `관련 태스크: ${d.task_ids.join(', ')}\n\n` +
    `anchor 는 **task_id 로 지정한 태스크 본문 안에 실제로 존재하는 한 줄**이어야 한다.\n` +
    `text 는 그 자리에 들어갈 내용을 그대로 쓴다 — 사람이 승인한 텍스트가 그대로 삽입된다.`,
    { label: `fix:${d.id}`, phase: 'Fix', schema: PATCH_SCHEMA, model: 'sonnet' },
  ).then((patch) => ({ ...d, patch: patch ?? undefined })).catch(() => d),
)

return {
  schema: 1,
  plan_sha256: args.planSha256,
  stage1: { relations_declared: args.relationsDeclared, defects: args.stage1Defects ?? [] },
  stage2: { units_examined: examined, units_failed: failed, defects: withPatch },
  critic: { additional_defects: [] },
}
```

> 수정 제안이 적용 가능한 형태여야 한다는 설계 D5 는 `PATCH_SCHEMA` 로 강제된다.
>
> 워크플로우 반환값을 `rawPath` 에 쓰는 것은 `/preflight` 스킬이 담당한다 (Task 13) —
> 워크플로우 스크립트는 파일을 쓸 수 없다.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test controller/preflight.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add workflows/plan-preflight.js controller/preflight.test.ts
git commit -m "feat(preflight): 2단계 워크플로우 — 후보 판정·미선언 탐색·검사관·반증·패치"
```

---

### Task 13: `/preflight` 스킬과 훅 배선

**Tags:** verification=deterministic validation=invisible

**Files:**
- Create: `.claude/skills/preflight/SKILL.md`
- Create: `.claude/settings.json`
- Test: `controller/preflight.test.ts`

**Interfaces:**
- Consumes: `gateDecision(input: GateInput): GateOutcome` from Task 11

> **파일 의존은 여기 적지 않는다.** 이 태스크는 `bin/preflight`(Task 11)와
> `workflows/plan-preflight.js`(Task 12)가 **존재하고 동작할 것**에 의존한다. 그것은
> 심볼 의존이 아니라 파일 의존이고, `**Interfaces:**`는 심볼만 표현한다 — 파일 경로를
> 심볼로 적으면 `symbolName("bin/preflight")`가 `"bin"`이 되어 거짓 매달린 참조가 난다.
> 순서는 플랜의 선형 순서가 강제한다 (설계 §4.2 한계).
- Produces: `/preflight` 스킬 (검사 → 사람 결정 → 적용 → 재검사 순서를 묶는다), `PostToolUse` 훅 설정

**테스트로 증명할 것:**
- [ ] `.claude/settings.json` 의 훅이 `PostToolUse` 다 — `PreToolUse` 가 아니다 (설계 D23: 쓰기를 막으면 안 된다)
- [ ] 훅 명령이 `--gate` 를 부른다
- [ ] `bin/preflight <branch> --gate` 가 `plan.md` 가 없는 레포에서 **종료 코드 0** 으로 끝난다 (엣지 E4 · 저장을 막지 않는다)
- [ ] 스킬 마크다운이 네 모드를 순서대로 지시한다 (`--plan` → Workflow → `--record` → 사람 결정 → `--apply`)
- [ ] 스킬 마크다운에 "일괄 승인 금지"가 명시돼 있다 (설계 D13)

- [ ] **Step 1: Write the failing test**

```ts
import { existsSync, readFileSync } from "node:fs";

describe("훅과 스킬 배선 (Task 13)", () => {
  test("훅이 PostToolUse 다 — 쓰기를 막지 않는다 (설계 D23)", () => {
    const s = JSON.parse(readFileSync(".claude/settings.json", "utf8"));
    expect(s.hooks?.PostToolUse).toBeDefined();
    expect(s.hooks?.PreToolUse).toBeUndefined();
    expect(JSON.stringify(s.hooks.PostToolUse)).toContain("--gate");
  });

  test("스킬이 네 모드를 순서대로 지시한다", () => {
    const md = readFileSync(".claude/skills/preflight/SKILL.md", "utf8");
    const order = ["--plan", "Workflow", "--record", "--apply"];
    let cursor = -1;
    for (const token of order) {
      const at = md.indexOf(token, cursor + 1);
      expect(at).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  test("스킬에 일괄 승인 금지가 명시돼 있다 (D13)", () => {
    const md = readFileSync(".claude/skills/preflight/SKILL.md", "utf8");
    expect(md).toContain("일괄");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test controller/preflight.test.ts`
Expected: FAIL — `ENOENT: .claude/settings.json`

- [ ] **Step 3: Write minimal implementation**

`.claude/settings.json` 신규:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "if echo \"$CLAUDE_TOOL_INPUT\" | grep -q 'docs/plans/.*/plan\\.md'; then bin/preflight \"$(git branch --show-current)\" --gate; fi"
          }
        ]
      }
    ]
  }
}
```

`.claude/skills/preflight/SKILL.md` 신규:

```markdown
---
name: preflight
description: 계획서(plan.md)의 할 일 간 모순을 게이트 ① 앞에서 찾는다. 기계 1단계 + AI 2단계. 결함을 찾으면 하나씩 채택/기각을 물어보고 채택분만 반영한다.
---

# 계획서 사전 검사

설계: [docs/plans/<slug>/design-doc.md](../../../docs/plans) · 결정 D1~D29

## 순서 — 이 순서를 바꾸지 마라

**1. 1단계 기계 검사**

\`\`\`bash
bin/preflight "$(git branch --show-current)" --plan
\`\`\`

출력 JSON 을 그대로 다음 단계의 `args` 로 쓴다. 값을 손으로 옮기지 마라.

**2. 2단계 AI 검사**

`Workflow({ scriptPath: "workflows/plan-preflight.js", args: <1단계 출력> })`

시작 전에 규모를 한 줄로 알린다 — 짝 개수, 예상 에이전트 수, 동시성 캡으로 나눈 웨이브 수.
묻는 것이 아니라 알리는 것이다.

워크플로우 반환값을 `docs/plans/<slug>/preflight-raw.json` 에 **그대로** 쓴다.
요약하거나 다시 쓰지 마라 — 파일 + JSON 이 유일한 경계다 (하드룰 #4).

**3. 결과 기록**

\`\`\`bash
bin/preflight "$(git branch --show-current)" --record
\`\`\`

`CLEAN` 이면 여기서 끝이다. 게이트 ① 로 넘어간다.

**4. 사람 결정 — 결함마다 하나씩**

`REJECTED` 면 결함마다 `AskUserQuestion` 을 **하나씩** 던진다.

- **일괄 승인을 제공하지 마라.** "전부 적용" 선택지를 만들지 마라 (설계 D13).
  결함이 많아 번거롭다면 그것은 계획서를 다시 만들라는 신호다.
- `stage: 1` 결함은 기계가 확정한 것이다. `stage: 2` 는 AI 판단이므로 오탐일 수 있다.
  사람에게 이 차이를 알려라.
- 결함의 `patch.text` 를 **그대로** 보여줘라. 다시 쓰지 마라 — 승인한 텍스트가
  그대로 들어간다 (설계 D14).

**5. 채택분 적용**

\`\`\`bash
bin/preflight "$(git branch --show-current)" --apply <채택한 결함 id들>
\`\`\`

종료 코드 3 은 앵커 후보가 여럿이라는 뜻이다. 후보 위치를 사람에게 보여주고 고르게 한다
(설계 D22). 첫 번째를 조용히 고르지 마라.

**6. 재검사**

적용하면 `plan.md` 해시가 바뀌므로 1단계로 돌아간다. `CLEAN` 이 나올 때까지 반복한다.

## 하지 않는 것

- `plan.md` 를 직접 편집하지 마라. `--apply` 만이 계획서를 바꾼다
- 결함을 요약해서 한꺼번에 묻지 마라 (D13)
- `preflight-raw.json` 의 값을 손으로 옮기지 마라 (하드룰 #4)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test && bin/preflight "$(git branch --show-current)" --gate; echo "exit=$?"`
Expected: PASS, 그리고 `--gate` 가 `exit=0`

- [ ] **Step 5: Commit**

```bash
git add .claude/settings.json .claude/skills/preflight/SKILL.md controller/preflight.test.ts
git commit -m "feat(preflight): /preflight 스킬 + PostToolUse 훅 (설계 D13·D23)"
```

---

### Task 14: 오버레이·라우팅 갱신과 픽스처 왕복 검증

**Tags:** verification=deterministic validation=invisible

**Files:**
- Modify: `overlay/writing-plans-tagging.md`
- Modify: `CLAUDE.md`
- Test: `controller/contract.test.ts`

**Interfaces:**
- Consumes: `checkPlan(planText: string): Violation[]`, `parseTasks(planText: string): ParsedTask[]` from Task 2
- Produces: (문서 변경 — 새 코드 심볼 없음). 오버레이가 `**Interfaces:**` 를 필수로 규정하고, `CLAUDE.md` 라우팅에 `/preflight` 행이 생긴다

**테스트로 증명할 것:**
- [ ] **오버레이의 예시 블록을 뽑아 `checkPlan` 에 넣으면 error 위반이 0건이다** — 오버레이가 자기 계약을 지킨다
- [ ] 오버레이 본문에 `**Interfaces:**` 가 필수임을 말하는 문장이 있다
- [ ] 오버레이의 self-review 체크리스트에 `**Interfaces:**` 항목이 있다
- [ ] `CLAUDE.md` 에 `## Skill routing` 헤딩이 정확히 한 번 있다 (AMENDMENTS B3 — gstack 삽입 방어)
- [ ] `CLAUDE.md` 라우팅 테이블에 `/preflight` 행이 있다

- [ ] **Step 1: Write the failing test**

```ts
describe("오버레이가 자기 계약을 지킨다 (Task 14)", () => {
  const overlay = readFileSync("overlay/writing-plans-tagging.md", "utf8");

  /** 오버레이의 ```` 로 감싼 markdown 예시 블록을 뽑는다 */
  function exampleBlock(src: string): string {
    const m = /````markdown\n([\s\S]*?)\n````/.exec(src);
    if (!m) throw new Error("오버레이에서 markdown 예시 블록을 찾지 못했습니다");
    return m[1];
  }

  test("예시 블록이 checkPlan 을 통과한다", () => {
    const plan = ["## 태스크", "", exampleBlock(overlay)].join("\n");
    const errors = checkPlan(plan).filter((v) => v.severity === "error");
    expect(errors).toEqual([]);
  });

  test("Interfaces 가 필수임을 본문이 말한다", () => {
    expect(/\*\*Interfaces:\*\*[\s\S]{0,400}필수/.test(overlay)).toBe(true);
  });

  test("self-review 체크리스트에 Interfaces 항목이 있다", () => {
    const list = overlay.slice(overlay.indexOf("Self-Review"));
    expect(list).toContain("Interfaces");
  });
});

describe("CLAUDE.md 라우팅 (AMENDMENTS B3)", () => {
  const claudeMd = readFileSync("CLAUDE.md", "utf8");

  test("## Skill routing 헤딩이 정확히 한 번 — gstack 삽입 방어", () => {
    expect(claudeMd.split("\n").filter((l) => l === "## Skill routing")).toHaveLength(1);
  });

  test("라우팅 테이블에 /preflight 행이 있다", () => {
    expect(claudeMd).toContain("/preflight");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test controller/contract.test.ts`
Expected: FAIL — 오버레이 예시 블록에 `Interfaces` 필수 문구가 없고, `CLAUDE.md` 에 `/preflight` 행이 없다

- [ ] **Step 3: Write minimal implementation**

`overlay/writing-plans-tagging.md` — `## 형식` 섹션 뒤에 추가:

```markdown
## `**Interfaces:**` 는 필수다

`**Files:**` 와 `**Interfaces:**` 는 **모든 태스크에 필수다.** 계약 체커가 검증하며,
없으면 빌드가 시작되지 않는다.

`**Interfaces:**` 가 필수인 이유는 사전 검사(`/preflight`)의 1단계가 이것만 입력으로 쓰기
때문이다. 이것이 태스크 간 의존을 선언하는 유일한 자리이고, 기계가 다음 셋을 결정론적으로
잡는다:

- **매달린 참조** — `X from Task N` 인데 Task N 이 X 를 생산하지 않는다
- **순서 위반** — 앞 태스크가 뒤 태스크의 산출을 소비한다
- **서명 불일치** — 같은 심볼의 생산·소비 서명이 다르다

형식:

- `- Consumes: \`심볼\` from Task N` — 출처 태스크를 반드시 적는다. `from` 절이 없으면
  기계가 연결을 검증할 수 없다
- `- Produces: \`서명 전문\`` — 소비 쪽과 **글자 그대로 같게** 적는다. 다르면 후보로 올라가
  AI 판정 단계를 한 번 더 태운다
- 첫 태스크처럼 소비할 것이 없으면 `Produces` 만 있어도 된다
```

그리고 self-review 체크리스트에 두 줄 추가:

```markdown
- [ ] 모든 태스크에 `**Files:**` 가 있고 `Create` 또는 `Modify` 항목이 하나 이상이다
- [ ] 모든 태스크에 `**Interfaces:**` 가 있고, `Consumes` 의 심볼이 출처 태스크의 `Produces` 에 글자 그대로 존재한다
```

`CLAUDE.md` 의 단계별 스킬 테이블에 `writing-plans` 행 **다음**에 추가:

```markdown
| 계획서 모순 검사 | `/preflight` | 게이트 ① **앞**에 돈다. 통과하지 않은 플랜은 `bin/builder`가 거부한다 (설계 D26) |
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test && bun run typecheck && ./bootstrap.sh check`
Expected: PASS — 전체 테스트 통과, `## Skill routing` 헤딩 1개 유지

- [ ] **Step 5: Commit**

```bash
git add overlay/writing-plans-tagging.md CLAUDE.md controller/contract.test.ts
git commit -m "feat(overlay): Interfaces 를 필수로 승격 + /preflight 라우팅 (설계 D6·P6)"
```

---

### Task 15: builder 게이트 강제 — 통과하지 않은 플랜은 빌드하지 않는다

**Tags:** verification=deterministic validation=invisible

> **이 태스크가 마지막인 이유 — 재시도가 막히는 것을 피한다.**
> `bin/builder`는 세션을 띄우기 **전에** 한 번만 게이트를 검사한다. 그래서 이 태스크가
> 빌드 중간에 커밋돼도 이미 돌고 있는 세션은 영향받지 않는다. 문제는 **재시도**다 —
> SDD가 타임아웃이나 실패로 중단된 뒤 `bin/builder`를 다시 실행하면, 게이트가 이미
> 있고 `preflight.json`은 아직 없으므로 `REJECTED`로 막힌다. 마지막에 두면 그 창이 닫힌다.
>
> **대가:** Task 1~14는 게이트 없이 빌드된다. 게이트가 실제로 작동하는지는 이 태스크의
> 단위 테스트로만 관찰되고, 실제 `bin/builder` 경로에서의 동작은 **다음 기능의 1회전**에서
> 처음 관찰된다 (설계 §7.4 관찰 항목).
>
> **부트스트랩:** 이 태스크가 끝나면 `bin/builder`가 `preflight.json`을 요구한다.
> 이 브랜치를 다시 빌드하려면 먼저 `/preflight`를 한 번 돌려 그 파일을 만들어야 한다.

**Files:**
- Modify: `controller/builder.ts`
- Modify: `controller/preflight.ts`
- Test: `controller/preflight.test.ts`

**Interfaces:**
- Consumes: `PreflightResult` from Task 9
- Consumes: `Violation` (기존 — `controller/contract.ts`)
- Produces: `checkPreflightGate(raw: string | null, planSha256: string): GateVerdict`, `type GateVerdict = { ok: true } | { ok: false; outcome: "REJECTED" | "BLOCKED"; violations: Violation[] }`

**테스트로 증명할 것:**
- [ ] `preflight.json` 이 없으면 `REJECTED` 이고 이유에 "사전 검사"가 들어간다
- [ ] `plan_sha256` 이 현재 플랜과 다르면 `REJECTED` — 검사 후 플랜이 바뀐 것이다
- [ ] `verdict: "REJECTED"` 면 `REJECTED` 이고 결함 개수가 이유에 들어간다
- [ ] JSON 이 깨졌으면 **`BLOCKED`** — `REJECTED` 가 아니다 (하드룰 #4)
- [ ] `schema` 가 1이 아니면 `BLOCKED`
- [ ] `verdict: "CLEAN"` + 해시 일치면 `ok: true`
- [ ] `runBuilder` 가 사전 검사 미통과 시 **`claude` 프로세스를 띄우지 않는다** (`dryRun: false` 인데도 세션이 시작되지 않는다)

- [ ] **Step 1: Write the failing test**

```ts
import { checkPreflightGate } from "./preflight";

describe("checkPreflightGate (설계 D26)", () => {
  const SHA = "a".repeat(64);
  const result = (over: Record<string, unknown> = {}) => JSON.stringify({
    schema: 1, branch: "feature/x", plan_sha256: SHA, scope: "interface-graph+file-overlap",
    verdict: "CLEAN", relations: { declared: 1, examined_stage1: 1, examined_stage2: 1, not_examined: [] },
    examined: [], defects: [], applied: [], ...over,
  });

  test("파일이 없으면 REJECTED", () => {
    const r = checkPreflightGate(null, SHA);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.outcome).toBe("REJECTED");
    expect(r.violations[0].message).toContain("사전 검사");
  });

  test("해시가 다르면 REJECTED", () => {
    const r = checkPreflightGate(result(), "b".repeat(64));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.outcome).toBe("REJECTED");
  });

  test("verdict REJECTED 면 REJECTED", () => {
    const r = checkPreflightGate(result({ verdict: "REJECTED", defects: [{ id: "d1" }] }), SHA);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.outcome).toBe("REJECTED");
    expect(r.violations.some((v) => v.message.includes("1"))).toBe(true);
  });

  test("JSON 이 깨지면 BLOCKED — REJECTED 가 아니다 (하드룰 #4)", () => {
    const r = checkPreflightGate("{ broken", SHA);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.outcome).toBe("BLOCKED");
  });

  test("schema 가 1이 아니면 BLOCKED", () => {
    const r = checkPreflightGate(result({ schema: 99 }), SHA);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.outcome).toBe("BLOCKED");
  });

  test("CLEAN + 해시 일치면 통과", () => {
    expect(checkPreflightGate(result(), SHA).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test controller/preflight.test.ts`
Expected: FAIL — `checkPreflightGate is not a function`

- [ ] **Step 3: Write minimal implementation**

`controller/preflight.ts`:

```ts
export type GateVerdict =
  | { ok: true }
  | { ok: false; outcome: "REJECTED" | "BLOCKED"; violations: Violation[] };

/**
 * 게이트 강제 (설계 D26).
 *
 * **이것이 없으면 이 기능 전체가 강제되지 않는다.** 초안에는 이 함수가 없었고,
 * builder 가 preflight.json 을 읽지 않았다 — 검사를 안 돌려도, REJECTED 가
 * 나와도 빌드가 시작됐다.
 *
 * 게이트 ① 의 의미가 이 함수로 바뀐다:
 *   "사람이 승인한다" → "검사를 통과한 것만 사람이 승인할 수 있다"
 */
export function checkPreflightGate(raw: string | null, planSha256: string): GateVerdict {
  const v = (message: string): Violation[] => [
    { severity: "error", file: "preflight.json", rule: "D26", message },
  ];

  if (raw === null) {
    return {
      ok: false, outcome: "REJECTED",
      violations: v("사전 검사를 돌리지 않았습니다 — /preflight 를 실행하세요"),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false, outcome: "BLOCKED",
      violations: v(`preflight.json JSON 파싱 실패: ${e instanceof Error ? e.message : String(e)}`),
    };
  }

  const o = parsed as Partial<PreflightResult>;
  if (o?.schema !== 1) {
    return { ok: false, outcome: "BLOCKED", violations: v(`preflight.json schema 가 1이 아닙니다: ${String(o?.schema)}`) };
  }
  if (o.plan_sha256 !== planSha256) {
    return {
      ok: false, outcome: "REJECTED",
      violations: v("사전 검사 이후 plan.md 가 바뀌었습니다 — 다시 검사하세요"),
    };
  }
  if (o.verdict !== "CLEAN") {
    return {
      ok: false, outcome: "REJECTED",
      violations: v(`사전 검사가 ${o.verdict} 입니다 — 결함 ${o.defects?.length ?? 0}건`),
    };
  }
  return { ok: true };
}
```

`controller/builder.ts` — 계약 검증 직후, `dryRun` 판정 **전에** 삽입:

```ts
  // ── 1-B. 사전 검사 게이트 (설계 D26) ────────────────────────────
  // 계약(형식)이 통과해도 사전 검사를 통과하지 않은 플랜은 빌드하지 않는다.
  const { checkPreflightGate } = await import("./preflight");
  const { createHash } = await import("node:crypto");
  const planSha = createHash("sha256").update(planText, "utf8").digest("hex");
  let preflightRawText: string | null = null;
  try {
    preflightRawText = await readFile(p.preflight, "utf8");
  } catch {
    preflightRawText = null;
  }
  const gate = checkPreflightGate(preflightRawText, planSha);
  if (!gate.ok) {
    return done({
      outcome: gate.outcome,
      contractViolations: formatViolations(gate.violations),
      tasks,
      reason: "사전 검사 게이트 미통과 — 빌드를 시작하지 않았습니다",
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run typecheck && bun test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add controller/preflight.ts controller/builder.ts controller/preflight.test.ts
git commit -m "feat(builder): 사전 검사 게이트 강제 (설계 D26) — 이것이 없으면 전체가 강제되지 않는다"
```

---

---

## 태그 분포

```
📋 태스크 15개 · deterministic 15 / generative 0 · visible 0 / invisible 15
🧪 invisible 태스크 테스트 케이스 118건 명기됨
```

`generative` 0건이다 — 이 기능의 모든 코드는 입출력이 확정적이다. AI를 부르는 부분은
워크플로우 스크립트 하나뿐이고, 그 파일은 판단 로직을 갖지 않으므로(D1) 검증 대상이
"형식 왕복 + 모델 명시"로 좁혀진다 (Task 12에 한계를 명기했다).

`visible` 0건이다 — 화면이 없다. 게이트 ②의 데모 경로는 이번 회전에서 검증되지 않고,
`invisible`-only 보고 패킷 경로가 대신 검증된다 (명세 §5.6).

골든셋은 이 플랜의 범위가 아니다 (명세 D4). `generative` 태스크가 없으므로 폴백 규칙도
적용되지 않는다.
