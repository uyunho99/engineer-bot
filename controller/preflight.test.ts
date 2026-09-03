import { describe, expect, test } from "bun:test";
import { parseTasks } from "./contract";
import { buildRelationGraph, danglingRefs, orderViolations, signatureCandidates, stage1Defects, overlappingPairs, relationCoverage, preflightVerdict, checkPreflightRaw, assembleResult, findFixSites, applyPatch, gateDecision, type PreflightRaw } from "./preflight";
// PreflightRaw 를 함께 import 하라 — 아래 raw() 헬퍼가 그 타입을 쓴다.
// tsconfig 의 include 가 controller/**/*.ts 이고 noUnusedLocals: true 라
// 테스트 파일도 타입체크 대상이다 (2026-09-03 봇 지적).

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

  test("타입을 이름으로 소비하면 후보가 아니다 — 서명을 주장하지 않았다", () => {
    const g = graphOf(planOf(
      task(1, ["- Produces: `interface Foo { a: string }`"]),
      task(2, ["- Consumes: `Foo` from Task 1"]),
    ));
    expect(signatureCandidates(g)).toEqual([]);
  });

  test("그래도 실제 불일치는 여전히 후보가 된다 — 위 규칙이 삼키지 않는다", () => {
    const g = graphOf(planOf(
      task(1, ["- Produces: `f(): string[]`"]),
      task(2, ["- Consumes: `f(): Keyword[]` from Task 1"]),
    ));
    expect(signatureCandidates(g)).toHaveLength(1);
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
    // bullet 6: 결함이 있으면 verdict 는 preflightVerdict 규칙대로 REJECTED 다.
    expect(r.verdict).toBe("REJECTED");
  });

  test("같은 id 는 한 번만", () => {
    const r = assembleResult({ ...base, raw: raw({
      stage1: { relations_declared: 1, defects: [d("dup", 1)] },
      stage2: { units_examined: [], units_failed: [], defects: [d("dup", 2)] },
    }) });
    expect(r.defects).toHaveLength(1);
    // 첫 등장(=stage1)이 남아야 한다 — concat 순서를 뒤집으면 이 assertion 이 깨진다.
    expect(r.defects[0].stage).toBe(1);
  });

  test("verdict 가 CLEAN 도 낼 수 있다 — REJECTED 로 하드코딩되면 이 테스트가 잡는다", () => {
    expect(assembleResult({ ...base, raw: raw() }).verdict).toBe("CLEAN");
  });

  test("관계 두 개 중 결함이 있는 것만 defect 로 표시된다 — 합집합이 아니라 개별 결함 기준", () => {
    const gMulti = graphOf(planOf(
      task(1, ["- Produces: `a()`"]),
      task(3, ["- Produces: `b()`"]),
      task(2, ["- Consumes: `a()` from Task 1", "- Consumes: `b()` from Task 3"]),
    ));
    const r = assembleResult({ ...base, graph: gMulti, raw: raw({
      stage1: { relations_declared: 2, defects: [d("bad-a", 1)] },
    }) });
    const rels = r.examined.filter((u) => u.kind === "relation");
    expect(rels.find((u) => u.task_ids.includes("1"))?.result).toBe("defect");
    expect(rels.find((u) => u.task_ids.includes("3"))?.result).toBe("clean");
  });

  test("짝 판정은 하나의 결함이 양쪽을 지목하는지로 정해진다 — 두 독립 결함의 합집합이 아니다", () => {
    const covering = {
      id: "cov", kind: "dangling_ref" as const, task_ids: ["A", "B"] as [string, string],
      relation: "z()", plan_text: "", conflict: "", stage: 1 as const,
    };
    const defectX = {
      id: "dx", kind: "dangling_ref" as const, task_ids: ["C", "X"] as [string, string],
      relation: "x()", plan_text: "", conflict: "", stage: 1 as const,
    };
    const defectY = {
      id: "dy", kind: "dangling_ref" as const, task_ids: ["D", "Y"] as [string, string],
      relation: "y()", plan_text: "", conflict: "", stage: 1 as const,
    };
    const r = assembleResult({ ...base,
      pairs: [
        { a: "A", b: "B", sharedFiles: ["ab.ts"] },
        { a: "C", b: "D", sharedFiles: ["cd.ts"] },
      ],
      raw: raw({ stage1: { relations_declared: 1, defects: [covering, defectX, defectY] } }),
    });
    const pairUnits = r.examined.filter((u) => u.kind === "pair");
    // A,B 는 하나의 결함(covering)이 양쪽을 다 지목한다 — defect.
    expect(pairUnits.find((u) => u.task_ids.join(",") === "A,B")?.result).toBe("defect");
    // C,D 는 서로 무관한 결함 둘(dx, dy)이 한쪽씩만 지목한다 — 합집합으로 보면 오판, clean 이어야 한다.
    expect(pairUnits.find((u) => u.task_ids.join(",") === "C,D")?.result).toBe("clean");
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

  test("앵커가 없으면 not_found 다 — 부분 적용이 타입 수준에서 불가능하다 (D16)", () => {
    const r = applyPatch(TWO_TASKS, { op: "replace", task_id: "2", anchor: "없음", text: "x" });
    expect(r.status).toBe("not_found");
    // `not_found` 분기에는 `text` 필드가 없다 — 부분 적용이 타입으로 막힌다.
    expect("text" in r).toBe(false);
    // 주의: `expect(TWO_TASKS).toBe(before)` 같은 단언을 넣지 마라. 문자열은 불변이므로
    // 어떤 구현에서도 통과하는 항진명제다 (2026-09-03 봇 지적).
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

  test("펜스 안의 열-0 가짜 Task 헤딩에 범위 탐지가 속지 않는다 — 그 뒤 앵커도 본문 범위 안이다", () => {
    // overlay/writing-plans-tagging.md 처럼 태스크 본문이 예시로 펜스 블록에
    // `### Task N: ...` 를 열 0부터 담을 수 있다. 펜스를 무시하고 원본 줄만 보면
    // 그 가짜 헤딩에서 범위(end)가 끊겨, 그 뒤에 오는 진짜 앵커를 놓친다.
    const withFakeHeadingInFence = planOf(
      [
        "### Task 1: 실제",
        "",
        "**Tags:** verification=deterministic validation=invisible",
        "",
        "**Files:**",
        "- Create: `a.ts`",
        "",
        "**Interfaces:**",
        "- Produces: `f()`",
        "",
        "예시 태그 형식:",
        "```",
        "### Task 3: 가짜 헤딩",
        "```",
        "",
        "**테스트로 증명할 것:**",
        "- [ ] 진짜 앵커",
      ].join("\n"),
    );
    const p = { op: "insert_after" as const, task_id: "1", anchor: "- [ ] 진짜 앵커", text: "x" };
    const r = applyPatch(withFakeHeadingInFence, p);
    expect(r.status).toBe("applied");
  });

  test("task_id 가 숫자가 아니면(정규식 특수문자 포함) 예외를 던지지 않고 not_found 다", () => {
    expect(() =>
      applyPatch(TWO_TASKS, { op: "replace", task_id: "(", anchor, text: "x" }),
    ).not.toThrow();
    const r = applyPatch(TWO_TASKS, { op: "replace", task_id: "(", anchor, text: "x" });
    expect(r.status).toBe("not_found");
  });
});

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
    const r = gateDecision({ planExists: true, planSha256: SHA, previous: null, contractOk: true });
    expect(r.action).toBe("run");
    expect(r.reason).toBeTruthy();
  });

  test("해시가 다르면 run", () => {
    expect(gateDecision({
      planExists: true, planSha256: SHA, previous: prev("CLEAN", "b".repeat(64)), contractOk: true,
    }).action).toBe("run");
  });

  test("해시 같고 CLEAN 이면 cached", () => {
    const r = gateDecision({
      planExists: true, planSha256: SHA, previous: prev("CLEAN"), contractOk: true,
    });
    expect(r.action).toBe("cached");
    expect(r.reason).toBeTruthy();
  });

  test("해시 같지만 REJECTED 면 run — 결함이 캐시를 타지 않는다 (D10)", () => {
    expect(gateDecision({
      planExists: true, planSha256: SHA, previous: prev("REJECTED"), contractOk: true,
    }).action).toBe("run");
  });
});
