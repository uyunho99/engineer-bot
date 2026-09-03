import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import {
  checkBuildResult,
  checkDesignDoc,
  checkHandoff,
  checkPlan,
  formatViolations,
  parseFiles,
  parseInterfaces,
  parseTasks,
  type PreflightDefect,
} from "./contract";
import { contractPaths } from "./paths";

const errorsOnly = (vs: ReturnType<typeof checkPlan>) => vs.filter((v) => v.severity === "error");

const GOOD_DESIGN = `# 페르소나 카드 목록

## 문제 정의
사용자가 만든 페르소나를 다시 찾을 방법이 없다.

## 전제
- 페르소나 수는 사용자당 100개 이하 (ceo-review에서 도전 후 유지)

## 스코프 / 비스코프
- 스코프: 목록 화면, 정렬
- 비스코프: 검색, 공유

## 제약
- 기존 API 변경 없음

## 수용 기준
- 목록이 최신순으로 렌더된다

## 아키텍처 결정
- 서버 컴포넌트로 렌더, 클라이언트 정렬 없음
`;

const GOOD_PLAN = `# 페르소나 카드 목록 Implementation Plan

**Goal:** 목록 화면을 만든다

## Global Constraints
- Node 22 이상
- 기존 \`/api/personas\` 응답 스키마 변경 금지

---

### Task 1: 목록 조회 함수

**Tags:** verification=deterministic validation=invisible

**Files:**
- Create: \`src/personas/list.ts\`

**Interfaces:**
- Produces: \`listPersonas(): Persona[]\`

**테스트로 증명할 것:**
- [ ] 페르소나가 0개면 빈 배열, 예외 없음
- [ ] 최신순으로 정렬된다

- [ ] **Step 1: Write the failing test**

### Task 2: 카드 렌더

**Tags:** verification=deterministic validation=visible

**Files:**
- Create: \`src/personas/Card.tsx\`

**Interfaces:**
- Consumes: \`listPersonas(): Persona[]\` from Task 1
- Produces: \`PersonaCard\`

- [ ] **Step 1: Write the failing test**
`;

describe("checkDesignDoc", () => {
  test("필수 섹션이 다 있으면 error 없음", () => {
    expect(errorsOnly(checkDesignDoc(GOOD_DESIGN))).toEqual([]);
  });

  test("수용 기준이 빠지면 error", () => {
    const without = GOOD_DESIGN.replace("## 수용 기준\n- 목록이 최신순으로 렌더된다\n", "");
    const errs = errorsOnly(checkDesignDoc(without));
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain("수용 기준");
  });

  test("영어 헤딩도 통과한다 — gstack 스킬이 영어로 쓸 수 있다", () => {
    const english = `# Feature
## Problem
x
## Assumptions
x
## Scope
in scope / out of scope
## Constraints
x
## Acceptance Criteria
x
## Architecture
x
`;
    expect(errorsOnly(checkDesignDoc(english))).toEqual([]);
  });

  test("코드 펜스 안의 헤딩은 섹션으로 세지 않는다", () => {
    const fenced = `# Doc
\`\`\`markdown
## 문제 정의
## 전제
## 스코프
## 제약
## 수용 기준
## 아키텍처 결정
\`\`\`
`;
    // 펜스를 무시하지 않으면 이 문서가 통과해버린다 — 그게 이 테스트가 막는 것
    expect(errorsOnly(checkDesignDoc(fenced)).length).toBeGreaterThan(0);
  });

  test("빈 파일은 단일 error", () => {
    const errs = errorsOnly(checkDesignDoc("   "));
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain("비어");
  });
});

describe("parseTasks", () => {
  test("헤딩과 태그를 뽑는다", () => {
    const tasks = parseTasks(GOOD_PLAN);
    expect(tasks.map((t) => t.id)).toEqual(["1", "2"]);
    expect(tasks[0].verification).toBe("deterministic");
    expect(tasks[0].validation).toBe("invisible");
    expect(tasks[1].validation).toBe("visible");
  });

  test("태스크 본문이 다음 태스크로 새지 않는다", () => {
    const tasks = parseTasks(GOOD_PLAN);
    expect(tasks[0].body).toContain("최신순으로 정렬된다");
    expect(tasks[0].body).not.toContain("Card.tsx");
  });

  test("펜스 안의 'Task N' 헤딩은 태스크가 아니다", () => {
    const plan = `## Global Constraints
- x

### Task 1: 진짜

**Tags:** verification=deterministic validation=visible

\`\`\`markdown
### Task 99: 예시일 뿐
\`\`\`
`;
    expect(parseTasks(plan).map((t) => t.id)).toEqual(["1"]);
  });
});

describe("checkPlan", () => {
  test("정상 플랜은 error 없음", () => {
    expect(errorsOnly(checkPlan(GOOD_PLAN))).toEqual([]);
  });

  test("Global Constraints가 없으면 error", () => {
    const without = GOOD_PLAN.replace(/## Global Constraints[\s\S]*?---\n/, "");
    expect(errorsOnly(checkPlan(without)).some((v) => v.message.includes("Global Constraints"))).toBe(true);
  });

  test("task-brief가 못 읽는 헤딩 형식을 잡는다 (AMENDMENTS B4)", () => {
    const bad = GOOD_PLAN.replace("### Task 2: 카드 렌더", "### 2. 카드 렌더");
    const errs = errorsOnly(checkPlan(bad));
    expect(errs.some((v) => v.rule === "AMENDMENTS B4")).toBe(true);
  });

  test("'태스크 3' 처럼 한국어 헤딩도 잡는다", () => {
    const bad = GOOD_PLAN + "\n### 태스크 3: 한국어 헤딩\n";
    expect(errorsOnly(checkPlan(bad)).some((v) => v.rule === "AMENDMENTS B4")).toBe(true);
  });

  test("태스크 번호가 끊기면 error — task-brief가 조용히 건너뛴다", () => {
    const gap = GOOD_PLAN.replace("### Task 2:", "### Task 3:");
    const errs = errorsOnly(checkPlan(gap));
    expect(errs.some((v) => v.message.includes("Task 2이 없습니다"))).toBe(true);
  });

  test("태스크 번호 중복은 error", () => {
    const dup = GOOD_PLAN + `
### Task 1: 중복

**Tags:** verification=deterministic validation=visible
`;
    expect(errorsOnly(checkPlan(dup)).some((v) => v.message.includes("중복"))).toBe(true);
  });

  test("Tags 라인이 없으면 error", () => {
    const noTags = GOOD_PLAN.replace("**Tags:** verification=deterministic validation=visible\n", "");
    const errs = errorsOnly(checkPlan(noTags));
    expect(errs.some((v) => v.taskId === "2" && v.message.includes("Tags"))).toBe(true);
  });

  test("잘못된 태그 값은 error", () => {
    const badTag = GOOD_PLAN.replace("verification=deterministic validation=visible", "verification=maybe validation=visible");
    const errs = errorsOnly(checkPlan(badTag));
    expect(errs.some((v) => v.message.includes("verification"))).toBe(true);
  });

  test("invisible 태스크에 테스트 케이스 섹션이 없으면 error (명세 §3.4)", () => {
    const noCases = GOOD_PLAN.replace(
      /\*\*테스트로 증명할 것:\*\*\n- \[ \] 페르소나가 0개면 빈 배열, 예외 없음\n- \[ \] 최신순으로 정렬된다\n/,
      "",
    );
    const errs = errorsOnly(checkPlan(noCases));
    expect(errs.some((v) => v.taskId === "1" && v.message.includes("테스트로 증명할 것"))).toBe(true);
  });

  test("invisible 태스크의 케이스 목록이 비면 error", () => {
    const emptyCases = GOOD_PLAN.replace(
      "- [ ] 페르소나가 0개면 빈 배열, 예외 없음\n- [ ] 최신순으로 정렬된다\n",
      "",
    ).replace("- [ ] **Step 1: Write the failing test**\n\n### Task 2", "### Task 2");
    const errs = errorsOnly(checkPlan(emptyCases));
    expect(errs.some((v) => v.taskId === "1")).toBe(true);
  });

  test("visible 태스크에는 테스트 케이스 섹션을 요구하지 않는다", () => {
    // Task 2는 visible이고 테스트 케이스 섹션이 없다 — error가 없어야 한다
    expect(errorsOnly(checkPlan(GOOD_PLAN)).filter((v) => v.taskId === "2")).toEqual([]);
  });

  test("generative인데 골든셋 언급이 없으면 warn (error 아님)", () => {
    const gen = GOOD_PLAN.replace(
      "### Task 2: 카드 렌더\n\n**Tags:** verification=deterministic validation=visible",
      "### Task 2: 키워드 발산\n\n**Tags:** verification=generative validation=visible",
    );
    const vs = checkPlan(gen);
    expect(errorsOnly(vs)).toEqual([]);
    expect(vs.some((v) => v.severity === "warn" && v.message.includes("골든셋"))).toBe(true);
  });

  test("태스크가 하나도 없으면 error", () => {
    expect(errorsOnly(checkPlan("# Plan\n\n## Global Constraints\n- x\n")).length).toBeGreaterThan(0);
  });
});

describe("checkHandoff", () => {
  test("둘 다 정상이면 ok", () => {
    expect(checkHandoff(GOOD_DESIGN, GOOD_PLAN).ok).toBe(true);
  });

  test("어느 한쪽이라도 error면 ok=false — 빌드 시작 전 게이트", () => {
    expect(checkHandoff("", GOOD_PLAN).ok).toBe(false);
    expect(checkHandoff(GOOD_DESIGN, "").ok).toBe(false);
  });

  test("warn만 있으면 ok=true — 경고가 빌드를 막지는 않는다", () => {
    const warnOnly = GOOD_DESIGN.replace("- 비스코프: 검색, 공유", "");
    const r = checkHandoff(warnOnly.replace("비스코프", "제외"), GOOD_PLAN);
    expect(r.ok).toBe(true);
    expect(r.violations.some((v) => v.severity === "warn")).toBe(true);
  });
});

describe("checkBuildResult", () => {
  const success = {
    schema: 1,
    branch: "feature/foo",
    outcome: "SUCCESS",
    pr_url: "https://github.com/o/r/pull/1",
    tests: { passed: 12, failed: 0 },
  };

  test("정상 SUCCESS는 ok이고 result를 돌려준다", () => {
    const r = checkBuildResult(JSON.stringify(success));
    expect(r.ok).toBe(true);
    expect(r.result?.pr_url).toBe("https://github.com/o/r/pull/1");
  });

  test("JSON이 깨지면 ok=false — 성공으로 처리되지 않는다 (A6)", () => {
    const r = checkBuildResult("{ not json");
    expect(r.ok).toBe(false);
    expect(r.result).toBeUndefined();
  });

  test("빈 문자열도 ok=false", () => {
    expect(checkBuildResult("").ok).toBe(false);
  });

  test("최상위가 배열이면 ok=false", () => {
    expect(checkBuildResult("[]").ok).toBe(false);
  });

  test("알 수 없는 outcome은 ok=false", () => {
    const r = checkBuildResult(JSON.stringify({ ...success, outcome: "DONE" }));
    expect(r.ok).toBe(false);
    expect(r.violations[0].message).toContain("outcome");
  });

  test("SUCCESS인데 pr_url이 없으면 ok=false", () => {
    const { pr_url, ...noPr } = success;
    expect(checkBuildResult(JSON.stringify(noPr)).ok).toBe(false);
  });

  test("SUCCESS인데 실패 테스트가 있으면 ok=false", () => {
    const r = checkBuildResult(JSON.stringify({ ...success, tests: { passed: 10, failed: 2 } }));
    expect(r.ok).toBe(false);
  });

  test("REJECTED인데 defects가 비면 ok=false (§6.3)", () => {
    const r = checkBuildResult(
      JSON.stringify({ schema: 1, branch: "b", outcome: "REJECTED", defects: [] }),
    );
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.message.includes("defects"))).toBe(true);
  });

  test("REJECTED에 defects가 있으면 ok", () => {
    const r = checkBuildResult(
      JSON.stringify({
        schema: 1,
        branch: "b",
        outcome: "REJECTED",
        defects: [{ task_id: "2", plan_text: "...", conflict: "..." }],
      }),
    );
    expect(r.ok).toBe(true);
  });

  test("BLOCKED인데 reason이 없으면 ok=false", () => {
    expect(checkBuildResult(JSON.stringify({ schema: 1, branch: "b", outcome: "BLOCKED" })).ok).toBe(false);
  });

  test("BLOCKED에 attempts가 없으면 warn — ok는 유지", () => {
    const r = checkBuildResult(
      JSON.stringify({ schema: 1, branch: "b", outcome: "BLOCKED", blocked: { task_id: "4", reason: "x" } }),
    );
    expect(r.ok).toBe(true);
    expect(r.violations.some((v) => v.severity === "warn")).toBe(true);
  });

  test("schema 버전이 다르면 ok=false", () => {
    expect(checkBuildResult(JSON.stringify({ ...success, schema: 2 })).ok).toBe(false);
  });

  test("SUCCESS에 검증 공백이 있으면 warn으로 남는다 — 조용히 사라지지 않는다", () => {
    const r = checkBuildResult(
      JSON.stringify({ ...success, verification_gaps: [{ task_id: "6", reason: "골든셋 없음" }] }),
    );
    expect(r.ok).toBe(true);
    expect(r.violations.some((v) => v.message.includes("검증 공백"))).toBe(true);
  });
});

describe("formatViolations", () => {
  test("위반이 없으면 그렇게 말한다", () => {
    expect(formatViolations([])).toBe("계약 위반 없음");
  });

  test("error를 warn보다 먼저 배치한다", () => {
    const out = formatViolations([
      { severity: "warn", file: "plan.md", rule: "r", message: "w" },
      { severity: "error", file: "plan.md", rule: "r", message: "e" },
    ]);
    expect(out.indexOf("ERROR")).toBeLessThan(out.indexOf("WARN"));
  });
});

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

  test("섹션이 있지만 항목이 없으면 빈 배열 세 개", () => {
    expect(parseFiles("**Files:**\n")).toEqual({
      create: [], modify: [], test: [],
    });
  });

  test("섹션이 있지만 바로 다음 섹션이 나오면 빈 배열 세 개", () => {
    const emptyBeforeNext = "**Files:**\n\n**Interfaces:**\n- Produces: `f(): void`";
    expect(parseFiles(emptyBeforeNext)).toEqual({
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

  test("위반 메시지에 태스크 번호가 들어간다 — taskId 필드로도 노출된다", () => {
    // Files/Interfaces 둘 다 비운다 — 두 위반 모두에서 확인한다.
    const v = errorsOf(task(""));
    const filesViolation = v.find((x) => x.message.includes("Files"));
    const ifacesViolation = v.find((x) => x.message.includes("Interfaces"));
    expect(filesViolation?.message.includes("1")).toBe(true);
    expect(ifacesViolation?.message.includes("1")).toBe(true);
    // 메시지 문자열 파싱이 아니라 구조화된 taskId 필드로 태스크를 식별할 수 있어야 한다
    // (하드룰 #4: 자유 텍스트 파싱 금지).
    expect(filesViolation?.taskId).toBe("1");
    expect(ifacesViolation?.taskId).toBe("1");
  });
});

describe("contractPaths — preflight 경로 (설계 D7 · D28)", () => {
  test("contractPaths 가 preflight 경로 두 개를 만든다", () => {
    const p = contractPaths("/repo", "feature/x");
    expect(p.preflight).toBe("/repo/docs/plans/feature-x/preflight.json");
    expect(p.preflightRaw).toBe("/repo/docs/plans/feature-x/preflight-raw.json");
  });
});

// 타입이 관계를 강제하는지는 typecheck 가 관찰한다 (설계 D27).
//
// 이전에는 "주석을 해제하면 실패해야 한다"는 **사람에게 보내는 지시**였다.
// 아무도 해제하지 않으므로 아무것도 증명하지 못했고, 해제해도 `PreflightDefect`
// 가 import 되지 않아 TS2304(다른 이유)로 실패했다.
//
// `@ts-expect-error` 는 방향이 반대라서 강하다: 오류가 **사라지면** 빌드가 깨진다.
// 즉 누군가 task_ids 를 `string[]` 로 되돌리는 회귀를 `bun run typecheck` 가 잡는다.
// @ts-expect-error task_ids 는 최소 2개짜리 튜플이다 — 1개는 대입될 수 없다 (D27)
const badTaskIds: PreflightDefect["task_ids"] = ["only-one"];
void badTaskIds; // noUnusedLocals 충족. 런타임에서는 아무 일도 하지 않는다

describe("오버레이가 자기 계약을 지킨다 (Task 14)", () => {
  const overlay = readFileSync("overlay/writing-plans-tagging.md", "utf8");

  /** 오버레이의 ```` 로 감싼 markdown 예시 블록을 뽑는다 */
  function exampleBlock(src: string): string {
    const m = /````markdown\n([\s\S]*?)\n````/.exec(src);
    if (!m) throw new Error("오버레이에서 markdown 예시 블록을 찾지 못했습니다");
    return m[1];
  }

  /**
   * 예시 블록을 **완전한 플랜으로 감싼다.**
   *
   * `checkPlan` 은 플랜 전체 불변식도 검사한다 — `## Global Constraints` 존재와
   * `Task 1..N` 번호 연속성. 태스크 조각 하나만 넣으면 그 셋이 원리적으로 실패하고,
   * 오버레이 예시는 `Consumes: PersonaSeed from Task 2` 를 시연하려고 **의도적으로
   * Task 3** 이므로 번호를 고칠 수도 없다.
   *
   * 이 테스트가 증명하려는 것은 "예시가 **태스크 단위** 계약을 지키는가" 다.
   * 그래서 플랜 단위 요건은 자리표시로 채우고 예시를 Task 3 자리에 그대로 놓는다.
   *
   * (2026-09-03 봇이 3회전에서 이 테스트를 "통과 불가"로 판정해 반송했다.
   *  실측 error 3건 — Global Constraints 1 · 번호 2. 봇 판정이 옳았다.)
   */
  function planAround(example: string): string {
    const stub = (n: number, produces: string) =>
      [
        `### Task ${n}: 자리표시`,
        "",
        "**Tags:** verification=deterministic validation=invisible",
        "",
        "**Files:**",
        `- Create: \`src/stub${n}.ts\``,
        "",
        "**Interfaces:**",
        `- Produces: \`${produces}\``,
        "",
        "**테스트로 증명할 것:**",
        "- [ ] 자리표시 — 관찰 가능한 행동 하나",
      ].join("\n");
    return [
      "# 감싼 플랜",
      "",
      "## Global Constraints",
      "",
      "- 자리표시 제약 하나",
      "",
      stub(1, "bootstrap(): void"),
      "",
      // 예시의 Task 3 이 `PersonaSeed from Task 2` 를 소비하므로 Task 2 가 그것을 생산해야 한다
      stub(2, "PersonaSeed"),
      "",
      example,
    ].join("\n");
  }

  test("예시 블록이 태스크 단위 계약을 지킨다", () => {
    const errors = checkPlan(planAround(exampleBlock(overlay)))
      .filter((v) => v.severity === "error");
    expect(errors).toEqual([]);
  });

  test("감싸지 않으면 플랜 단위 요건 때문에 실패한다 — 왜 감싸는지의 증거", () => {
    const bare = ["## 태스크", "", exampleBlock(overlay)].join("\n");
    const errors = checkPlan(bare).filter((v) => v.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((v) => v.message.includes("Global Constraints"))).toBe(true);
  });

  test("Interfaces 가 필수임을 본문이 말한다", () => {
    // 전체 문서를 정규식으로 훑으면 오버레이 예시 블록(Task 3)의
    // `**Interfaces:**` 헤딩과, 그로부터 400자 이내에 있는 무관한 문장
    // ("테스트로 증명할 것 섹션이 필수다") 이 먼저 매칭돼 거짓 통과한다.
    // "Interfaces 가 필수다" 라는 요건 자체를 선언하는 새 섹션 헤딩을 정확히
    // 찾아 그 본문에서만 확인한다 — self-review 체크리스트 검사와 같은 패턴.
    const heading = "## `**Interfaces:**` 는 필수다";
    const headingIdx = overlay.indexOf(heading);
    expect(headingIdx).not.toBe(-1);
    const body = overlay.slice(headingIdx + heading.length, headingIdx + heading.length + 400);
    expect(body).toContain("필수");
  });

  test("self-review 체크리스트에 Interfaces 항목이 있다", () => {
    // "Interfaces" 라는 낱말이 체크리스트 구역 어딘가의 산문에 등장하기만
    // 해도 통과하는 검사는 실제 체크리스트 항목 존재를 증명하지 못한다.
    // 어떤 줄이 체크박스(`- [ ]`)로 시작하면서 `**Interfaces:**` 를
    // 언급하는지까지 확인한다.
    // -1 가드를 형제 테스트(Interfaces 헤딩)와 같이 둔다. 없으면 헤딩이
    // 사라진 순간 `slice(-1)` 이 마지막 한 글자를 훑고 **조용히 false** 를 내
    // "체크리스트 항목이 없다"로 보고한다 — 그건 이 테스트가 죽은 것이다.
    const at = overlay.indexOf("Self-Review");
    expect(at).not.toBe(-1);
    const list = overlay.slice(at);
    const hasInterfacesChecklistItem = list
      .split("\n")
      .some((line) => line.trimStart().startsWith("- [ ]") && line.includes("**Interfaces:**"));
    expect(hasInterfacesChecklistItem).toBe(true);
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
