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
