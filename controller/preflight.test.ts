import { describe, expect, test } from "bun:test";
import { parseTasks } from "./contract";
import { buildRelationGraph, danglingRefs, orderViolations, signatureCandidates, stage1Defects } from "./preflight";

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
