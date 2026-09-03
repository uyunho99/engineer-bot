import { describe, expect, test } from "bun:test";
import {
  checkBuildResult,
  checkDesignDoc,
  checkHandoff,
  checkPlan,
  formatViolations,
  parseTasks,
} from "./contract";

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

**테스트로 증명할 것:**
- [ ] 페르소나가 0개면 빈 배열, 예외 없음
- [ ] 최신순으로 정렬된다

- [ ] **Step 1: Write the failing test**

### Task 2: 카드 렌더

**Tags:** verification=deterministic validation=visible

**Files:**
- Create: \`src/personas/Card.tsx\`

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
