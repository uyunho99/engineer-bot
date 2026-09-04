import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { parseTasks } from "./contract";
import { buildRelationGraph, danglingRefs, orderViolations, signatureCandidates, stage1Defects, overlappingClusters, CLUSTER_WARN_SIZE, oversizedClusterWarnings, relationCoverage, preflightVerdict, checkPreflightRaw, assembleResult, findFixSites, applyPatch, gateDecision, checkPreflightGate, parsePreviousResult, planSha256, concernsUnit, type PreflightRaw, type JudgedUnit, type ExaminedRawUnit, type ExaminedUnit, type FileCluster } from "./preflight";
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

describe("overlappingClusters", () => {
  test("같은 파일을 Modify 하는 태스크 2개 → 클러스터 1개, task_ids 둘 다", () => {
    const c = overlappingClusters(parseTasks(planOf(
      fileTask(1, ["- Modify: `src/a.ts`"]),
      fileTask(2, ["- Modify: `src/a.ts`"]),
    )));
    expect(c).toEqual([{ file: "src/a.ts", task_ids: ["1", "2"] }]);
  });

  test("태스크 1개만 쓰는 파일은 클러스터가 아니다", () => {
    const c = overlappingClusters(parseTasks(planOf(
      fileTask(1, ["- Create: `src/a.ts`"]),
      fileTask(2, ["- Create: `src/b.ts`"]),
    )));
    expect(c).toEqual([]);
  });

  test("Test 파일은 클러스터를 만들지 않는다", () => {
    const c = overlappingClusters(parseTasks(planOf(
      fileTask(1, ["- Create: `a.ts`", "- Test: `shared.test.ts`"]),
      fileTask(2, ["- Create: `b.ts`", "- Test: `shared.test.ts`"]),
    )));
    expect(c).toEqual([]);
  });

  test("Create 와 Modify 를 섞어도 같은 파일이면 한 클러스터", () => {
    const c = overlappingClusters(parseTasks(planOf(
      fileTask(1, ["- Create: `src/a.ts`"]),
      fileTask(2, ["- Modify: `src/a.ts`"]),
    )));
    expect(c).toEqual([{ file: "src/a.ts", task_ids: ["1", "2"] }]);
  });

  test("한 태스크가 두 파일을 쓰면 두 클러스터에 각각 나온다 (DC1 — 연결 성분이 아니다)", () => {
    const c = overlappingClusters(parseTasks(planOf(
      fileTask(1, ["- Modify: `src/a.ts`", "- Modify: `src/b.ts`"]),
      fileTask(2, ["- Modify: `src/a.ts`"]),
      fileTask(3, ["- Modify: `src/b.ts`"]),
    )));
    expect(c).toEqual([
      { file: "src/a.ts", task_ids: ["1", "2"] },
      { file: "src/b.ts", task_ids: ["1", "3"] },
    ]);
  });

  test("task_ids 가 플랜 등장 순서다 — 태스크 번호 순이 아니다", () => {
    const c = overlappingClusters(parseTasks(planOf(
      fileTask(3, ["- Modify: `src/a.ts`"]),
      fileTask(1, ["- Modify: `src/a.ts`"]),
    )));
    expect(c).toEqual([{ file: "src/a.ts", task_ids: ["3", "1"] }]);
  });

  test("file 이 오름차순으로 정렬된다", () => {
    const c = overlappingClusters(parseTasks(planOf(
      fileTask(1, ["- Modify: `z.ts`"]),
      fileTask(2, ["- Modify: `z.ts`"]),
      fileTask(3, ["- Modify: `a.ts`"]),
      fileTask(4, ["- Modify: `a.ts`"]),
    )));
    expect(c.map((x) => x.file)).toEqual(["a.ts", "z.ts"]);
  });

  test("태스크가 0개면 빈 배열, 예외 없음", () => {
    expect(overlappingClusters([])).toEqual([]);
  });

  test("CLUSTER_WARN_SIZE 가 12 다", () => {
    expect(CLUSTER_WARN_SIZE).toBe(12);
  });
});

describe("oversizedClusterWarnings", () => {
  const clusterOfSize = (n: number, file = "src/big.ts") => ({
    file,
    task_ids: Array.from({ length: n }, (_, i) => String(i + 1)),
  });

  test("태스크 13개가 한 파일을 쓰면 warn 1건", () => {
    const w = oversizedClusterWarnings([clusterOfSize(13)]);
    expect(w).toHaveLength(1);
  });

  test("정확히 12개면 경고가 없다 — 경계값", () => {
    expect(oversizedClusterWarnings([clusterOfSize(12)])).toEqual([]);
  });

  test("severity 는 warn 이다 — error 가 아니다 (DC5: 검사기가 일을 거부하지 않는다)", () => {
    const [w] = oversizedClusterWarnings([clusterOfSize(13)]);
    expect(w.severity).toBe("warn");
  });

  test("file 필드가 plan.md 다 — Violation 유니온에 값을 새로 추가하지 않는다", () => {
    const [w] = oversizedClusterWarnings([clusterOfSize(13, "src/big.ts")]);
    expect(w.file).toBe("plan.md");
  });

  test("메시지에 파일 경로와 태스크 수가 들어가고, 다음 행동이 드러난다", () => {
    const [w] = oversizedClusterWarnings([clusterOfSize(13, "src/big.ts")]);
    expect(w.message).toContain("src/big.ts");
    expect(w.message).toContain("13");
    // 진단(사실)만으로 끝나지 않는다 — checkPreflightGate 의 REDO 패턴과 같은 이유:
    // 다음 행동이 없으면 사람이 엉뚱한 곳을 고치려 든다.
    expect(w.message).toMatch(/쪼개|나누/);
  });

  test("부모 플랜의 최대 클러스터(9)에서는 경고가 없다", () => {
    const w = oversizedClusterWarnings([clusterOfSize(9, "controller/preflight.ts")]);
    expect(w).toEqual([]);
  });

  test("여러 클러스터 중 경고선을 넘는 것만 낸다", () => {
    const w = oversizedClusterWarnings([clusterOfSize(9), clusterOfSize(13)]);
    expect(w).toHaveLength(1);
  });

  test("클러스터가 0개면 빈 배열, 예외 없음", () => {
    expect(oversizedClusterWarnings([])).toEqual([]);
  });
});

describe("경고와 verdict 의 독립성 (DC5)", () => {
  test("클러스터 경고가 있어도 verdict 는 결함 수로만 정해진다", () => {
    const bigCluster = {
      file: "src/big.ts",
      task_ids: Array.from({ length: 13 }, (_, i) => String(i + 1)),
    };
    const warnings = oversizedClusterWarnings([bigCluster]);
    expect(warnings).toHaveLength(1);
    // preflightVerdict 는 warnings 를 인자로도 받지 않는다 — 결함(defects)과
    // coverage 만으로 정해진다. 경고가 존재해도 이 계산에 끼어들 통로가 없다.
    const coverage = { declared: 0, examined_stage1: 0, examined_stage2: 0, not_examined: [] };
    expect(preflightVerdict([], coverage)).toBe("CLEAN");
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
    expect(relationCoverage(g, [{ kind: "cluster", label: "pair:1x2" }], ["pair:2x3"]).not_examined).toEqual(["pair:2x3"]);
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
  stage2: { units_examined: [{ kind: "cluster", label: "pair:1x2" }], units_failed: [], defects: [] },
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

  // ── task_ids 원소 타입 · patch 검증 (2026-09-03 최종 리뷰 I3) ───────────
  //
  // patch 는 이 경계를 넘어 `--apply` 에서 **plan.md 를 실제로 고친다.**
  // 여기서 통과시키면 파일을 쓰는 코드가 검증되지 않은 AI 산출을 그대로 믿는다.

  const withDefect = (over: Record<string, unknown>) =>
    validRaw({ stage1: { relations_declared: 1, defects: [{ ...validDefect, ...over }] } });
  const patch = { op: "replace", task_id: "2", anchor: "- Consumes: `x()` from Task 1", text: "새 줄" };

  test("task_ids 원소가 숫자면 ok:false — 통과시키면 진짜 결함이 clean 으로 기록된다", () => {
    // 거짓 음성 경로: `[1, 2]` 는 길이 검사를 통과하고, 그 뒤 concernsUnit 의
    // `d.task_ids.includes("1")` 이 false 가 되어 결함 있는 관계가 `clean` 이 된다.
    // 안 본 것을 통과로 쓰는 것과 같은 종류의 실패다 (설계 §7.4).
    expect(checkPreflightRaw(withDefect({ task_ids: [1, 2] }), SHA).ok).toBe(false);
  });

  test("유효한 patch 는 통과한다 — patch 자체를 막는 검사가 아니다", () => {
    expect(checkPreflightRaw(withDefect({ patch }), SHA).ok).toBe(true);
  });

  test("patch.anchor 가 없으면 ok:false — --apply 도중 TypeError 로 죽는다", () => {
    const { anchor, ...noAnchor } = patch;
    expect(checkPreflightRaw(withDefect({ patch: noAnchor }), SHA).ok).toBe(false);
  });

  test("patch.anchor 가 빈 문자열이면 ok:false — 모든 빈 줄에 매치된다", () => {
    expect(checkPreflightRaw(withDefect({ patch: { ...patch, anchor: "   " } }), SHA).ok).toBe(false);
  });

  test("patch.op 이 다른 문자열이면 ok:false — 조용히 insert_after 로 동작한다", () => {
    expect(checkPreflightRaw(withDefect({ patch: { ...patch, op: "delete" } }), SHA).ok).toBe(false);
  });

  test("patch.text 가 문자열이 아니면 ok:false — 강제 변환된 값이 plan.md 에 들어간다 (D14)", () => {
    expect(checkPreflightRaw(withDefect({ patch: { ...patch, text: 42 } }), SHA).ok).toBe(false);
  });

  test("patch.text 가 빈 문자열은 유효하다 — 빈 줄로 교체하는 것은 정당하다", () => {
    expect(checkPreflightRaw(withDefect({ patch: { ...patch, text: "" } }), SHA).ok).toBe(true);
  });

  test("patch.task_id 가 없으면 ok:false — 앵커 검색 범위를 정할 수 없다 (D24)", () => {
    const { task_id, ...noTaskId } = patch;
    expect(checkPreflightRaw(withDefect({ patch: noTaskId }), SHA).ok).toBe(false);
  });

  test("patch 가 객체가 아니면 ok:false", () => {
    expect(checkPreflightRaw(withDefect({ patch: "고쳐라" }), SHA).ok).toBe(false);
  });

  test("위반 메시지의 rule 이 항목에 맞다 — task_ids 는 D27, patch 는 D28 (M2)", () => {
    const tupleV = checkPreflightRaw(withDefect({ task_ids: ["1"] }), SHA).violations;
    expect(tupleV.some((v) => v.rule === "D27")).toBe(true);
    const patchV = checkPreflightRaw(withDefect({ patch: { ...patch, op: "delete" } }), SHA).violations;
    expect(patchV.some((v) => v.rule === "D28" && v.message.includes("patch.op"))).toBe(true);
    expect(patchV.some((v) => v.rule === "D27")).toBe(false);
  });

  // ── file (DC3: 중복 클러스터 소속 때문에 task_ids 만으로는 결함의 출처
  // 클러스터를 복원할 수 없다. 결함이 자기 파일을 들고 다닌다) ─────────────

  test("file 이 있는 결함은 통과한다", () => {
    expect(checkPreflightRaw(withDefect({ file: "src/a.ts" }), SHA).ok).toBe(true);
  });

  test("file 이 없는 결함도 통과한다 — 옵셔널이므로 하위 호환이다 (DC3)", () => {
    expect(checkPreflightRaw(withDefect({}), SHA).ok).toBe(true);
  });

  test("file 이 문자열이 아니면 ok:false", () => {
    expect(checkPreflightRaw(withDefect({ file: 42 }), SHA).ok).toBe(false);
  });

  test("file 이 빈 문자열이면 ok:false — 없음과 구분되지 않으면 Task 3 필터가 반대 방향으로 갈린다 (pair:2x3-4)", () => {
    expect(checkPreflightRaw(withDefect({ file: "" }), SHA).ok).toBe(false);
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
    clusters: [],
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

  // 원래 이 회귀는 **짝** 단위 위에서 돌았다. Task 6 이 짝을 클러스터로 갈아치우면서
  // 같은 회귀를 `relation` 단위로 옮겼다 — 부분집합 규칙을 쓰는 쪽이 그쪽이라
  // 질문("하나의 결함이 단위 전체를 지목하는가")이 글자 그대로 보존된다.
  // 클러스터는 의도적으로 다른 규칙(교집합)을 쓰므로 이 회귀의 자리가 아니다 (DC2).
  test("판정은 하나의 결함이 단위 전체를 지목하는지로 정해진다 — 두 독립 결함의 합집합이 아니다", () => {
    const gTwoRel = graphOf(planOf(
      task(1, ["- Produces: `a()`"]),
      task(2, ["- Consumes: `a()` from Task 1"]),
      task(3, ["- Produces: `b()`"]),
      task(4, ["- Consumes: `b()` from Task 3"]),
    ));
    const covering = {
      id: "cov", kind: "dangling_ref" as const, task_ids: ["1", "2"] as [string, string],
      relation: "a()", plan_text: "", conflict: "", stage: 1 as const,
    };
    const defectX = {
      id: "dx", kind: "dangling_ref" as const, task_ids: ["3", "X"] as [string, string],
      relation: "x()", plan_text: "", conflict: "", stage: 1 as const,
    };
    const defectY = {
      id: "dy", kind: "dangling_ref" as const, task_ids: ["4", "Y"] as [string, string],
      relation: "y()", plan_text: "", conflict: "", stage: 1 as const,
    };
    const r = assembleResult({ ...base,
      graph: gTwoRel,
      raw: raw({ stage1: { relations_declared: 2, defects: [covering, defectX, defectY] } }),
    });
    const rels = r.examined.filter((u) => u.kind === "relation");
    // 1,2 는 하나의 결함(covering)이 양쪽을 다 지목한다 — defect.
    expect(rels.find((u) => u.task_ids.join(",") === "1,2")?.result).toBe("defect");
    // 3,4 는 서로 무관한 결함 둘(dx, dy)이 한쪽씩만 지목한다 — 합집합으로 보면 오판, clean 이어야 한다.
    expect(rels.find((u) => u.task_ids.join(",") === "3,4")?.result).toBe("clean");
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

  // Task 4 (Ⓓ 회귀): 값을 채우는 것은 Task 6 이다 — 여기서는 자리와 기본값만 본다.
  test("warnings 필드가 있고 기본값은 [] 다 — undefined 도 필드 누락도 아니다", () => {
    const r = assembleResult({ ...base, raw: raw() });
    expect(r.warnings).toEqual([]);
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

describe("워크플로우 스크립트 (Task 12)", () => {
  const src = readFileSync("workflows/plan-preflight.js", "utf8");

  test("모든 agent() 호출에 model 이 명시돼 있다 (하드룰 #3)", () => {
    // **주석을 먼저 벗긴다.** 이 스크립트는 주석이 본문보다 길고 주석 안에
    // `agent()` 가 등장한다 — 벗기지 않으면 calls 가 과대 집계돼 테스트가
    // 구현과 무관하게 깨진다 (2026-09-03 봇이 실측: calls 6 vs models 5).
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const calls = (code.match(/\bagent\(/g) ?? []).length;
    const models = (code.match(/\bmodel\s*:/g) ?? []).length;
    expect(calls).toBeGreaterThan(0);
    expect(models).toBeGreaterThanOrEqual(calls);
  });

  test("meta 블록이 있다", () => {
    expect(src).toContain("export const meta");
  });

  // 아래 둘은 **프롬프트 회귀 방어**다. 이 스크립트에는 기계 검사가 하나도 없어서
  // (파일을 읽을 수 없으니 단위 테스트가 실행할 수도 없다) 프롬프트가 조용히
  // 망가지면 산출이 checkPreflightRaw 에서 통째로 거부된다 — 그때는 이미 에이전트
  // 수십 개가 돈 뒤다. 문서-문자열 검사는 이 파일이 이미 받아들이는 형태다
  // (위의 하드룰 #3 모델 개수 검사).

  test("kind 를 리터럴로 지시한다 — 스키마 enum 과 같은 문자열이어야 한다", () => {
    // 프롬프트가 kind 를 안 못박으면 에이전트가 "signature-mismatch" 같은 변형을
    // 내고 checkDefectShape 의 KINDS 검사에서 전부 탈락한다.
    expect(src).toContain('"signature_mismatch"');
    expect(src).toContain('"undeclared_conflict"');
  });

  test("task_ids 를 결함 생성 프롬프트 3곳 모두가 못박는다", () => {
    // sig · pair · critic — 세 프롬프트 전부. task_ids 를 에이전트 재량에 맡기면
    // 1개만 오거나 숫자로 와서 관계 단위 판정(concernsUnit)이 무너진다.
    const pinned = (src.match(/task_ids 는/g) ?? []).length;
    expect(pinned).toBeGreaterThanOrEqual(3);
  });
});

describe("워크플로우가 클러스터마다 에이전트 1개를 띄운다 (Task 7)", () => {
  // 이 describe 는 부모 Task 12 블록의 헬퍼(src)를 재사용하지 않고 새로
  // 읽는다 — 두 블록이 서로 다른 describe 스코프라 자기 것을 따로 갖는 편이
  // 안전하다(모듈 스코프 이름 충돌을 피한다, task-7-brief 의 사실 메모).
  const src = readFileSync("workflows/plan-preflight.js", "utf8");
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  // 클러스터 팬아웃 섹션(2번)만 도려낸다. 이 파일은 실행할 수 없으니(브리핑의
  // "기계 검사가 0" 경고) 문자열 검사가 전부이고, 정확히 클러스터 프롬프트를
  // 겨냥하려면 섹션 경계로 잘라야 한다 — 안 그러면 다른 프롬프트(sig, critic)
  // 안의 우연한 일치가 단언을 무의미하게 통과시킬 수 있다.
  const sectionStart = src.indexOf("파일 클러스터마다");
  const sectionEnd = src.indexOf("// ── 3)");
  const clusterSection = src.slice(sectionStart, sectionEnd);
  // 주석을 벗긴 버전으로 단언한다. `clusterSection` 은 (다른 프롬프트와
  // 섞이지 않게) 섹션 경계로만 자른 것이라 아직 주석을 포함한다 — 이 섹션의
  // 헤더 주석이 프롬프트와 같은 문구("순차로 확장")를 설명 삼아 반복하므로,
  // 주석을 벗기지 않으면 프롬프트에서 그 문구를 지워도 헤더 주석만으로
  // 테스트가 계속 통과한다(2026-09-04 리뷰 1라운드 지적 — 이 파일은 소스
  // 문자열 검사가 유일한 검증이라 그 구멍이 곧 무방비다).
  const clusterPrompt = clusterSection.replace(/^\s*\/\/.*$/gm, "");

  test("클러스터 섹션 마커가 소스에 있다 (전제 조건)", () => {
    expect(sectionStart).toBeGreaterThan(-1);
    expect(sectionEnd).toBeGreaterThan(sectionStart);
  });

  test("워크플로우 소스에 overlappingPairs 도 args.pairs 도 없다", () => {
    expect(src).not.toContain("overlappingPairs");
    expect(src).not.toContain("args.pairs");
  });

  test("args.clusters 를 읽는다", () => {
    expect(src).toContain("args.clusters");
  });

  test("agent() 호출 수와 model: 지정 수가 정확히 같다 (하드룰 #3)", () => {
    const calls = (code.match(/\bagent\(/g) ?? []).length;
    const models = (code.match(/\bmodel\s*:/g) ?? []).length;
    expect(calls).toBeGreaterThan(0);
    expect(models).toBe(calls);
  });

  test("클러스터 프롬프트가 kind 를 undeclared_conflict 로 못박는다 (하드룰 #4)", () => {
    expect(clusterPrompt).toContain('"undeclared_conflict"');
  });

  test("클러스터 프롬프트가 file 을 그 클러스터의 실제 파일로 채우라고 못박는다 (DC3)", () => {
    // `${c.file}` 는 소스 텍스트 그대로 검사한다 — 이 파일은 실행할 수 없으므로
    // 템플릿이 평가된 값이 아니라 리터럴 문자열을 찾는다.
    expect(clusterPrompt).toMatch(/file\s*은\s*["'`]\$\{c\.file\}["'`]/);
    expect(clusterPrompt).toMatch(/비워두거나 생략하지 마라/);
  });

  test("클러스터 프롬프트가 충돌하는 태스크만 task_ids 에 담으라고 지시한다 (DC4)", () => {
    expect(clusterPrompt).toMatch(/충돌하는 태스크만/);
  });

  test("클러스터 프롬프트가 태스크들이 순차로 확장한다는 맥락을 준다 (DC4 근거)", () => {
    expect(clusterPrompt).toContain("순차로 확장");
  });

  test("units_examined 에 넣는 값이 { kind, label } 객체다 — 세 단계 모두 (DC6)", () => {
    // sig · cluster · critic 세 곳의 examined.push 호출 전부가 객체 리터럴을
    // 넣어야 한다. 문자열 하나를 그대로 넣는 옛 형태가 하나라도 남으면
    // checkPreflightRaw(DC6)가 그 산출 전체를 거부한다.
    // `{...}` 로 경계를 잡는다 — `[^)]*` 로 괄호까지 경계를 잡으면 라벨 안에
    // `label: \`sig:${fn(c)}\`` 처럼 괄호 있는 호출이 하나만 생겨도 조용히
    // 잘못된 경계에서 멈춘다(2026-09-04 리뷰 1라운드 지적). 이 스크립트의
    // push 는 전부 중첩 `{}` 없는 단순 객체 리터럴이므로 비탐욕 매치로 충분하다.
    const pushes = code.match(/examined\.push\(\{[\s\S]*?\}\)/g) ?? [];
    expect(pushes.length).toBe(3);
    for (const p of pushes) {
      expect(p).toMatch(/\{\s*kind\s*:/);
      expect(p).toMatch(/label\s*:/);
    }
    // kind 세 종류가 각각 정확히 한 번씩 등장해야 한다 — signature/cluster/critic.
    // `kind:` 뒤에 오는 값만 본다 — `p.includes("'signature'")` 는 값이 아니라
    // 어디에 있든 그 리터럴만 있으면 통과해, `{ kind: 'cluster', label: 'signature' }`
    // 같은 오조합도 속일 수 있다(2026-09-04 리뷰 1라운드 지적).
    expect(pushes.filter((p) => /kind:\s*'signature'/.test(p)).length).toBe(1);
    expect(pushes.filter((p) => /kind:\s*'cluster'/.test(p)).length).toBe(1);
    expect(pushes.filter((p) => /kind:\s*'critic'/.test(p)).length).toBe(1);
  });

  test("meta.phases 가 실제 phase() 호출과 일치한다", () => {
    const metaBlock = src.slice(
      src.indexOf("phases:"),
      src.indexOf("\n}", src.indexOf("phases:")),
    );
    const declaredTitles = [...metaBlock.matchAll(/title:\s*'([^']+)'/g)].map((m) => m[1]);
    const calledPhases = [...code.matchAll(/\bphase\('([^']+)'\)/g)].map((m) => m[1]);
    expect(declaredTitles).toEqual(calledPhases);
  });

  test("critic 프롬프트가 examined 를 그대로 join 하지 않는다 — 객체 배열이라 [object Object] 가 나간다", () => {
    // examined 원소가 { kind, label } 객체가 된 뒤(DC6) `examined.join(...)` 을
    // 그대로 쓰면 critic 에게 "검사 단위: [object Object], [object Object]" 가
    // 나간다 — 완결성 검사(D17)의 근거 자체가 깨지는데 문자열 검사로는
    // 눈에 띄지 않는다. `.map((u) => u.label)` 을 거치는지 최소한으로 고정한다.
    expect(code).not.toMatch(/examined\.join\(/);
    expect(code).toMatch(/examined\.map\(\s*\(?\w+\)?\s*=>\s*\w+\.label\)\.join\(/);
  });
});

describe("워크플로우 산출 형식 왕복", () => {
  const SHA = "a".repeat(64);
  const asWorkflowWrites = {
    schema: 1,
    plan_sha256: SHA,
    stage1: { relations_declared: 2, defects: [] },
    stage2: { units_examined: [{ kind: "cluster", label: "pair:1x2" }], units_failed: [], defects: [] },
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
      clusters: [], previousApplied: [], now: "2026-09-03T00:00:00Z",
    });
    expect(r.relations.not_examined).toEqual(["pair:1x2"]);
    expect(r.verdict).toBe("REJECTED");
  });
});

describe("훅과 스킬 배선 (Task 13)", () => {
  test("훅이 PostToolUse 다 — 쓰기를 막지 않는다 (설계 D23)", () => {
    const s = JSON.parse(readFileSync(".claude/settings.json", "utf8"));
    expect(s.hooks?.PostToolUse).toBeDefined();
    expect(s.hooks?.PreToolUse).toBeUndefined();
    expect(JSON.stringify(s.hooks.PostToolUse)).toContain("--gate");
  });

  /**
   * 2026-09-03 6회전 최종 리뷰가 확정한 결함의 회귀 가드.
   *
   * 플랜은 훅이 `$CLAUDE_TOOL_INPUT` 을 읽으라고 지시했는데 그 변수는 훅 계약에
   * 없다. PostToolUse 는 도구 페이로드를 **stdin 의 JSON** 으로 준다. 그러면
   * `echo "" | grep -q ...` 가 절대 매치되지 않고 grep 의 exit 1 은 `if` 가 삼킨다 —
   * **출력 0, 오류 0, 영구히.** 훅이 있는데 아무 일도 안 하는 상태였다.
   *
   * 어떤 테스트도 훅의 발화 자체에는 도달할 수 없다. 그래서 그 대신 **결함의
   * 지문**을 단언한다 — 없는 변수를 다시 쓰면 여기서 깨진다.
   */
  test("훅이 없는 환경변수를 읽지 않는다 — stdin 을 읽는다", () => {
    const s = JSON.parse(readFileSync(".claude/settings.json", "utf8"));
    const cmd: string = s.hooks.PostToolUse[0].hooks[0].command;
    expect(cmd).not.toContain("CLAUDE_TOOL_INPUT");
    // grep 이 파일 인자 없이 불려야 stdin 을 읽는다.
    expect(cmd).toMatch(/grep -q '[^']+'\s*;/);
    // 경로는 cwd 에 의존하지 않는다 (훅의 cwd 는 보장되지 않는다).
    expect(cmd).toContain("$CLAUDE_PROJECT_DIR/bin/preflight");
  });

  /**
   * AMENDMENTS B7 — 설계 D28 의 회귀 가드.
   *
   * D28 은 "워크플로우가 preflight-raw.json 을 직접 쓴다"였는데 **플랫폼이 그것을
   * 허용하지 않는다** (2026-09-04 실측: 전역이 globalThis 뿐, require 없음,
   * import() 구문 오류). 스크립트 안에서 쓰는 유일한 방법인 agent() 는 LLM 이 큰
   * JSON 을 다시 타이핑하는 것이라 D28 의 목적에 반한다.
   *
   * 그래서 저장 책임이 세션으로 옮겨졌다. 이 테스트는 그 계약이 **글로 남아 있는지**
   * 만 볼 수 있다 — 워크플로우는 실행할 수 없고 세션의 행동은 테스트가 도달할 수
   * 없다. 실제 강제는 `checkPreflightRaw` 의 스키마 + 해시 검증이다 (아래 테스트).
   */
  test("스킬이 raw 저장 책임을 세션에 두고 기계적 추출을 지시한다 (B7)", () => {
    const md = readFileSync(".claude/skills/preflight/SKILL.md", "utf8");
    expect(md).toContain("세션이");
    expect(md).toMatch(/손으로 옮기지 마라/);
    expect(md).toMatch(/파일에서 파일로/);
  });

  test("워크플로우가 rawPath 를 자기가 쓴다고 주장하지 않는다 (B7)", () => {
    const js = readFileSync("workflows/plan-preflight.js", "utf8");
    // 쓰기 시도가 없어야 한다 — 있으면 플랫폼이 막으므로 조용히 실패한다.
    expect(js).not.toMatch(/writeFileSync|Bun\.write|require\(/);
    // 그리고 왜 못 쓰는지가 적혀 있어야 한다 — 다음 사람이 다시 시도하지 않게.
    expect(js).toMatch(/읽지도 쓰지도 못한다/);
  });

  test("스킬이 에이전트 총수를 단정하지 말라고 지시한다 — 2026-09-04 예고가 5배 틀렸다", () => {
    const md = readFileSync(".claude/skills/preflight/SKILL.md", "utf8");
    expect(md).toMatch(/에이전트 총수를 미리 단정하지 마라/);
    expect(md).toContain("39");
  });

  /**
   * 2026-09-04 실측 결함의 회귀 가드 — **가장 비쌌던 거짓 안심.**
   *
   * 사용량 한도로 Verify 단계 에이전트 15개가 실패했다. 옛 코드는
   * `.catch(() => null)` 로 그 결함들을 **버리면서 failed 에 기록도 하지 않았다.**
   * 결과: 발견 44건 · 보고 1건 · units_failed 는 `[]`. 완결성 검사관이 낸 5건이
   * 통째로 사라졌고, 보고서는 "전부 정상 검사됨"이라고 말했다.
   *
   * 프롬프트의 "불확실하면 refuted=true" 는 **모델의 판단**에 대한 정책이다.
   * 에이전트가 아예 돌지 않은 것은 판단이 없는 것이므로 같이 취급하면 안 된다.
   */
  test("Verify·Fix 실패가 조용히 버려지지 않는다 (2026-09-04 회귀)", () => {
    const js = readFileSync("workflows/plan-preflight.js", "utf8");
    // 결함을 null 로 만들어 버리는 catch 가 없어야 한다.
    expect(js).not.toMatch(/refuted \? d : null\)\)\.catch\(\(\) => null\)/);
    // 두 단계 모두 실패를 기록해야 한다.
    expect(js).toMatch(/failed\.push\(`verify:\$\{d\.id\}`\)/);
    expect(js).toMatch(/failed\.push\(`fix:\$\{d\.id\}`\)/);
  });

  test("검사 단위가 실패하면 판정이 CLEAN 이 될 수 없다", () => {
    const cov = { declared: 3, examined_stage1: 3, examined_stage2: 1, not_examined: ["verify:x-1"] };
    expect(preflightVerdict([], cov)).toBe("REJECTED");
  });

  test("스킬이 BLOCKED(exit 4)를 REJECTED(exit 1)와 구분한다 — 하드룰 #4", () => {
    const md = readFileSync(".claude/skills/preflight/SKILL.md", "utf8");
    expect(md).toContain("exit 4");
    expect(md).toContain("BLOCKED");
    // "결함이 있다" 가 아니라 "검사가 실패했다" 로 안내해야 한다.
    expect(md).toMatch(/계획서(의 결함이 아니라|를 고치라고 제안하지 마라)/);
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

// `result` 를 **모듈 스코프**에 둔다 — 아래 두 번째 describe 가 이것을 쓰므로
// describe 콜백 안에 두면 TS2304 + 런타임 ReferenceError 다.
// ⚠️ `const SHA` 를 다시 선언하지 않는다 — 이미 위(Task 8 Step 1)에서 모듈
// 스코프에 `const SHA = "a".repeat(64)` 가 선언돼 있다. 그대로 재사용한다.
const result = (over: Record<string, unknown> = {}) => JSON.stringify({
  schema: 1, branch: "feature/x", plan_sha256: SHA, scope: "interface-graph+file-overlap",
  verdict: "CLEAN", relations: { declared: 1, examined_stage1: 1, examined_stage2: 1, not_examined: [] },
  examined: [], defects: [], applied: [], ...over,
});

describe("checkPreflightGate (설계 D26)", () => {

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
    // "1" 만 보면 "1건"·"1이 아닙니다" 같은 다른 문구에도 우연히 걸린다.
    // 결함 개수를 사람에게 알려주는 실체 문구를 단언한다.
    expect(r.violations.some((v) => v.message.includes("결함 1건"))).toBe(true);
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

describe("parsePreviousResult — 깨진 preflight.json 을 방어적으로 읽는다 (하드룰 #4)", () => {
  test("파일이 없으면 none — 오류가 아니다", () => {
    expect(parsePreviousResult(null)).toEqual({ status: "none" });
  });

  test("정상 결과는 ok 이고 본문이 그대로 실린다", () => {
    const r = parsePreviousResult(result());
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.result.verdict).toBe("CLEAN");
  });

  test("JSON 이 깨져도 던지지 않는다 — broken 이다", () => {
    // 이전 구현은 CLI 최상위에서 이 파싱을 감싸지 않아, 파일이 한 글자만 깨져도
    // 네 모드 전부가 스택 트레이스로 죽었다 (--plan 은 이 값을 쓰지도 않는다).
    let r: ReturnType<typeof parsePreviousResult> | null = null;
    expect(() => { r = parsePreviousResult("{ broken"); }).not.toThrow();
    expect(r!.status).toBe("broken");
  });

  test("none 과 broken 은 다른 상태다 — 깨진 파일을 '검사 안 함'으로 강등하지 않는다", () => {
    // 강등하면 gateDecision(previous: null) 이 run 을 내고, 판정 불가(BLOCKED)가
    // 평범한 재검사로 위조된다.
    expect(parsePreviousResult("{ broken").status).not.toBe("none");
  });

  test("형태가 틀리면 broken — schema · applied · defects (--apply 가 신뢰하는 최소한)", () => {
    expect(parsePreviousResult(result({ schema: 99 })).status).toBe("broken");
    expect(parsePreviousResult(result({ applied: "없음" })).status).toBe("broken");
    expect(parsePreviousResult(result({ defects: null })).status).toBe("broken");
    expect(parsePreviousResult("[1,2,3]").status).toBe("broken");
    expect(parsePreviousResult("null").status).toBe("broken");
  });

  test("broken 에는 사람이 읽을 사유가 붙는다", () => {
    const r = parsePreviousResult("{ broken");
    if (r.status !== "broken") throw new Error("broken 이어야 한다");
    expect(r.reason).toBeTruthy();
  });
});

describe("planSha256 — 게이트 양끝이 같은 계산을 쓴다 (M11)", () => {
  test("같은 입력에 같은 출력, 64자 hex", () => {
    expect(planSha256("plan")).toBe(planSha256("plan"));
    expect(planSha256("plan")).toMatch(/^[0-9a-f]{64}$/);
  });

  test("한 글자만 달라도 값이 달라진다 — 게이트가 감지하는 것이 이것이다", () => {
    expect(planSha256("plan")).not.toBe(planSha256("plaN"));
  });

  test("UTF-8 로 인코딩한다 — 한글이 들어간 플랜에서도 양끝이 일치한다", () => {
    // 두 호출자가 다른 인코딩을 쓰면 게이트가 항상-불일치로 조용히 무너진다.
    expect(planSha256("계획")).toBe(
      createHash("sha256").update("계획", "utf8").digest("hex"),
    );
  });
});

// runBuilder 의 게이트 실행 테스트는 **controller/builder.test.ts** 에 있다.
// 여기 있던 "runBuilder — 게이트 미통과 시 세션을 띄우지 않는다" 두 개는
// runBuilder 를 import 조차 하지 않고 checkPreflightGate 를 직접 불렀다 —
// 위 `checkPreflightGate (설계 D26)` describe 와 똑같은 것을 두 번 단언했을 뿐,
// builder.ts 의 게이트 블록을 통째로 지워도 통과했다. 게이트가 `dryRun` 조기
// 반환보다 앞에 있으므로 `runBuilder({ dryRun: true })` 로 실제 실행을 관찰할
// 수 있고, 그 테스트가 builder.test.ts 에 있다 (2026-09-03 최종 리뷰 I8).

// `concernsUnit` 은 위 `describe("assembleResult", ...)` 를 통해서도 간접적으로
// 이미 커버된다 (관계·짝 판정 회귀 테스트) — 그 테스트는 지우지 않는다. 여기서는
// Task 3 이 새로 만든 서명 `concernsUnit(defects, unit: JudgedUnit)` 을 직접
// 호출해, kind 별 규칙(DC2)과 두 회귀(Ⓑ, Ⓒ)를 못 박는다.
describe("concernsUnit (DC2 — 단위 종류별 판정 규칙)", () => {
  const defect = (
    task_ids: [string, string, ...string[]],
    file?: string,
  ) => ({
    id: `d-${task_ids.join("-")}${file ? `-${file}` : ""}`,
    kind: "dangling_ref" as const,
    task_ids,
    plan_text: "",
    conflict: "",
    stage: 1 as const,
    ...(file !== undefined ? { file } : {}),
  });

  describe("kind: cluster", () => {
    test("9개 중 2개를 지명한 결함이 클러스터를 defect 로 만든다", () => {
      const unit: JudgedUnit = {
        kind: "cluster",
        task_ids: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
        file: "controller/preflight.ts",
      };
      const defects = [defect(["3", "7"])];
      expect(concernsUnit(defects, unit)).toBe("defect");
    });

    test("클러스터 밖 태스크만 지명한 결함은 오염시키지 않는다", () => {
      const unit: JudgedUnit = {
        kind: "cluster",
        task_ids: ["1", "2", "3"],
        file: "controller/preflight.ts",
      };
      const defects = [defect(["10", "11"])];
      expect(concernsUnit(defects, unit)).toBe("clean");
    });

    test("Ⓑ 회귀 — task_ids 는 같고 file 만 다른 두 클러스터, 한쪽 결함이 다른 쪽을 오염시키지 않는다", () => {
      const clusterA: JudgedUnit = { kind: "cluster", task_ids: ["1", "2"], file: "a.ts" };
      const clusterB: JudgedUnit = { kind: "cluster", task_ids: ["1", "2"], file: "b.ts" };
      const defects = [defect(["1", "2"], "a.ts")];
      expect(concernsUnit(defects, clusterA)).toBe("defect");
      expect(concernsUnit(defects, clusterB)).toBe("clean");
    });

    test("결함에 file 이 없으면 거르지 않는다 — 과다 표시 쪽으로 안전하게", () => {
      const unit: JudgedUnit = { kind: "cluster", task_ids: ["1", "2"], file: "a.ts" };
      const defects = [defect(["1", "9"])]; // file 필드 없음
      expect(concernsUnit(defects, unit)).toBe("defect");
    });
  });

  describe("kind: relation", () => {
    test("Ⓒ 회귀 — 원소 1개짜리 단위에서, 그 태스크를 지명한 결함이 있으면 defect 다", () => {
      const unit: JudgedUnit = { kind: "relation", task_ids: ["5"] };
      const defects = [defect(["5", "9"])];
      expect(concernsUnit(defects, unit)).toBe("defect");
    });

    test("Ⓒ 회귀 — 태스크 3개를 지명한 결함 {1,3,5} 가 단위 {1,3} 을 defect 로 만든다", () => {
      const unit: JudgedUnit = { kind: "relation", task_ids: ["1", "3"] };
      const defects = [defect(["1", "3", "5"])];
      expect(concernsUnit(defects, unit)).toBe("defect");
    });

    test("file 을 무시한다 — 관계에는 파일 개념이 없다", () => {
      const unit: JudgedUnit = { kind: "relation", task_ids: ["1", "2"] };
      const defects = [defect(["1", "2"], "unrelated-file.ts")];
      expect(concernsUnit(defects, unit)).toBe("defect");
    });
  });

  test("결함이 없으면 어느 종류든 clean", () => {
    const relationUnit: JudgedUnit = { kind: "relation", task_ids: ["1", "2"] };
    const clusterUnit: JudgedUnit = { kind: "cluster", task_ids: ["1", "2"], file: "a.ts" };
    expect(concernsUnit([], relationUnit)).toBe("clean");
    expect(concernsUnit([], clusterUnit)).toBe("clean");
  });

  test("크기가 아니라 종류로 갈린다 — 원소 2개짜리 relation 과 cluster 가 같은 입력에서 다른 답을 낸다", () => {
    // 결함이 "1" 만 지명한다 — cluster 는 교집합 규칙이라 이것으로 충분히 defect,
    // relation 은 부분집합 규칙이라 "2" 도 있어야 하므로 clean.
    const defects = [defect(["1", "9"])];
    const relationUnit: JudgedUnit = { kind: "relation", task_ids: ["1", "2"] };
    const clusterUnit: JudgedUnit = { kind: "cluster", task_ids: ["1", "2"], file: "a.ts" };
    expect(concernsUnit(defects, relationUnit)).toBe("clean");
    expect(concernsUnit(defects, clusterUnit)).toBe("defect");
  });
});

// ─── Task 5 — raw 스키마의 검사 단위를 객체로 (설계 DC6) ──────────────────
//
// `units_examined` 이 `string[]` 이던 시절엔 signature/cluster/critic 세
// 종류를 문자열 접두사로 구분해야 했는데, 그건 하드룰 #4(자유 텍스트 파싱
// 금지)를 정면으로 어긴다. 그래서 원소를 `{ kind, label }` 객체로 바꾼다.
//
// 2026-09-04 실측: 실행 중 검사 단위가 6개였는데 배열 원소는 7개였다
// (critic 1개가 더 있었다) — `examined_stage2` 를 배열 길이로 세면
// 커버리지가 부풀려진다. `units_failed` 는 그대로 `string[]` 로 남는다
// (기존 실패 경로 보존).
describe("checkPreflightRaw — units_examined 객체 형태 (Task 5 · DC6)", () => {
  test("units_examined 원소가 { kind, label } 객체면 통과한다", () => {
    const r = checkPreflightRaw(validRaw({
      stage2: { units_examined: [{ kind: "cluster", label: "src/a.ts" }], units_failed: [], defects: [] },
    }), SHA);
    expect(r.ok).toBe(true);
    expect(r.data?.stage2.units_examined).toEqual([{ kind: "cluster", label: "src/a.ts" }]);
  });

  test("kind 가 signature/cluster/critic 세 값 밖이면 거부한다", () => {
    const r = checkPreflightRaw(validRaw({
      stage2: { units_examined: [{ kind: "bogus", label: "x" }], units_failed: [], defects: [] },
    }), SHA);
    expect(r.ok).toBe(false);
  });

  test("원소가 문자열이면 거부한다 — 옛 형식을 조용히 받지 않는다", () => {
    const r = checkPreflightRaw(validRaw({
      stage2: { units_examined: ["pair:1x2"], units_failed: [], defects: [] },
    }), SHA);
    expect(r.ok).toBe(false);
  });

  test("label 이 없으면 거부한다", () => {
    const r = checkPreflightRaw(validRaw({
      stage2: { units_examined: [{ kind: "signature" }], units_failed: [], defects: [] },
    }), SHA);
    expect(r.ok).toBe(false);
  });

  test("units_failed 는 여전히 문자열 배열이다 — 기존 실패 경로 보존", () => {
    const r = checkPreflightRaw(validRaw({
      stage2: { units_examined: [], units_failed: ["pair:1x2"], defects: [] },
    }), SHA);
    expect(r.ok).toBe(true);
    expect(r.data?.stage2.units_failed).toEqual(["pair:1x2"]);
  });
});

describe("relationCoverage — examined_stage2 는 cluster 만 센다 (Task 5 · DC6 · Ⓔ 회귀)", () => {
  const g = graphOf(planOf(task(1, ["- Produces: `a()`"])));

  test("2026-09-04 실측 픽스처 — 배열 7개(critic 포함)인데 클러스터는 3개뿐이다", () => {
    // signature 3 + cluster 3 + critic 1 = 배열 7개, 검사 단위(=critic 제외) 6개.
    // examined_stage2 는 둘 다 아니라 클러스터 수(3)여야 한다 — 배열 길이(7)로
    // 세거나 critic 만 뺀 값(6)으로 세면 이 assertion 이 잡는다.
    const units: ExaminedRawUnit[] = [
      { kind: "signature", label: "sig:a()" },
      { kind: "signature", label: "sig:b()" },
      { kind: "signature", label: "sig:c()" },
      { kind: "cluster", label: "src/a.ts" },
      { kind: "cluster", label: "src/b.ts" },
      { kind: "cluster", label: "src/c.ts" },
      { kind: "critic", label: "completeness" },
    ];
    const cov = relationCoverage(g, units, []);
    expect(cov.examined_stage2).toBe(3);
    expect(cov.examined_stage2).not.toBe(6);
    expect(cov.examined_stage2).not.toBe(7);
  });

  test("signature 와 critic 이 섞여 있어도 그 수가 부풀지 않는다 — cluster 가 하나뿐이면 1", () => {
    const units: ExaminedRawUnit[] = [
      { kind: "signature", label: "sig:a()" },
      { kind: "critic", label: "completeness" },
      { kind: "cluster", label: "src/a.ts" },
    ];
    expect(relationCoverage(g, units, []).examined_stage2).toBe(1);
  });

  test("클러스터가 0개면 examined_stage2 는 0", () => {
    const units: ExaminedRawUnit[] = [
      { kind: "signature", label: "sig:a()" },
      { kind: "critic", label: "completeness" },
    ];
    expect(relationCoverage(g, units, []).examined_stage2).toBe(0);
  });

  test("units_failed 의 라벨이 not_examined 에 그대로 들어간다 — 기존 실패 경로 보존", () => {
    expect(relationCoverage(g, [], ["pair:1x2"]).not_examined).toEqual(["pair:1x2"]);
  });
});

// ─── Task 6 — 결과 조립과 CLI 배선 (설계 DC1 · DC2 · DC5 · Ⓐ · Ⓓ) ────────
//
// 이 브랜치의 마지막 호출자를 짝에서 클러스터로 옮긴다. 여기까지 오기 전에는
// `assembleResult` 가 `pairs` 를 받아 `kind: "pair"` 단위를 냈고 `warnings` 는
// 하드코딩된 `[]` 였다 — Task 1·3·4·5 가 만든 조각이 전부 배선되지 않은 채
// 놀고 있었다는 뜻이다.

describe("assembleResult — 2단계 단위가 클러스터다 (Task 6)", () => {
  const g6 = graphOf(planOf(
    task(1, ["- Produces: `a()`"]),
    task(2, ["- Consumes: `a()` from Task 1"]),
  ));
  const raw6 = (over: Partial<PreflightRaw> = {}): PreflightRaw => ({
    schema: 1,
    plan_sha256: "a".repeat(64),
    stage1: { relations_declared: 1, defects: [] },
    stage2: { units_examined: [], units_failed: [], defects: [] },
    ...over,
  });
  const base6 = {
    branch: "feature/x",
    planSha256: "a".repeat(64),
    graph: g6,
    clusters: [] as FileCluster[],
    previousApplied: [],
    now: "2026-09-04T00:00:00Z",
  };
  const defect6 = (task_ids: [string, string, ...string[]], file?: string) => ({
    id: `d-${task_ids.join("-")}${file ? `-${file}` : ""}`,
    kind: "dangling_ref" as const,
    task_ids,
    plan_text: "",
    conflict: "",
    stage: 2 as const,
    ...(file !== undefined ? { file } : {}),
  });

  test("2단계 항목의 kind 가 'cluster' 다", () => {
    const r = assembleResult({
      ...base6,
      clusters: [{ file: "controller/preflight.ts", task_ids: ["1", "2"] }],
      raw: raw6(),
    });
    const stage2 = r.examined.filter((u) => u.kind !== "relation");
    expect(stage2).toHaveLength(1);
    expect(stage2[0].kind).toBe("cluster");
  });

  test("label 이 파일 경로다 — 사람이 무엇을 봤는지 읽을 수 있어야 한다 (부모 D9)", () => {
    const r = assembleResult({
      ...base6,
      clusters: [{ file: "controller/contract.ts", task_ids: ["1", "2", "3"] }],
      raw: raw6(),
    });
    const unit = r.examined.find((u) => u.kind === "cluster")!;
    expect(unit.label).toBe("controller/contract.ts");
    expect(unit.task_ids).toEqual(["1", "2", "3"]);
  });

  test("클러스터가 0개면 examined 에 2단계 항목이 없고 판정이 1단계만으로 난다", () => {
    const r = assembleResult({ ...base6, clusters: [], raw: raw6() });
    expect(r.examined.every((u) => u.kind === "relation")).toBe(true);
    expect(r.examined).toHaveLength(g6.relations.length);
    expect(r.verdict).toBe("CLEAN");
  });

  test("결함 0건이면 verdict 가 CLEAN — 클러스터화가 판정 규칙을 바꾸지 않는다", () => {
    const r = assembleResult({
      ...base6,
      clusters: [{ file: "src/a.ts", task_ids: ["1", "2"] }],
      raw: raw6(),
    });
    expect(r.defects).toEqual([]);
    expect(r.verdict).toBe("CLEAN");
    expect(r.examined.find((u) => u.kind === "cluster")?.result).toBe("clean");
  });

  test("클러스터 판정에 file 이 함께 넘어간다 — 다른 파일의 결함이 오염시키지 않는다 (Ⓑ)", () => {
    // `kind: "cluster"` 만 넘기고 `file` 을 빼면 `d.file === unit.file` 비교에서
    // unit.file 이 undefined 라 **file 을 가진 결함이 전부 걸러진다** — 거짓 음성
    // 쪽이고 이 기능에서 가장 위험한 방향이다. 같은 task_ids 에 file 만 다른
    // 클러스터 둘을 두는 이 픽스처가 그 누락을 잡는다.
    const r = assembleResult({
      ...base6,
      clusters: [
        { file: "a.ts", task_ids: ["1", "2"] },
        { file: "b.ts", task_ids: ["1", "2"] },
      ],
      raw: raw6({
        stage2: { units_examined: [], units_failed: [], defects: [defect6(["1", "2"], "a.ts")] },
      }),
    });
    const byFile = new Map(
      r.examined.filter((u) => u.kind === "cluster").map((u) => [u.label, u.result]),
    );
    expect(byFile.get("a.ts")).toBe("defect");
    expect(byFile.get("b.ts")).toBe("clean");
  });

  test("클러스터 규칙은 교집합이다 — 일부 태스크만 지목한 결함도 defect 다 (DC2)", () => {
    const r = assembleResult({
      ...base6,
      clusters: [{ file: "src/a.ts", task_ids: ["1", "2", "3", "4"] }],
      raw: raw6({
        stage2: { units_examined: [], units_failed: [], defects: [defect6(["3", "9"])] },
      }),
    });
    expect(r.examined.find((u) => u.kind === "cluster")?.result).toBe("defect");
  });

  test("warnings 를 oversizedClusterWarnings 결과로 채운다 (Ⓓ)", () => {
    const big: FileCluster = {
      file: "src/big.ts",
      task_ids: Array.from({ length: CLUSTER_WARN_SIZE + 1 }, (_, i) => String(i + 1)),
    };
    const r = assembleResult({ ...base6, clusters: [big], raw: raw6() });
    expect(r.warnings).toEqual(oversizedClusterWarnings([big]));
    expect(r.warnings).toHaveLength(1);
    // DC5 — 경고는 판정을 바꾸지 않는다.
    expect(r.verdict).toBe("CLEAN");
  });

  test("경고선 이하의 클러스터만 있으면 warnings 는 빈 배열", () => {
    const r = assembleResult({
      ...base6,
      clusters: [{ file: "src/a.ts", task_ids: ["1", "2"] }],
      raw: raw6(),
    });
    expect(r.warnings).toEqual([]);
  });

  test("ExaminedUnit.kind 유니온에 'pair' 가 없다", () => {
    // @ts-expect-error — "pair" 는 Task 6 이 유니온에서 지웠다. 되살아나면 이
    // 지시자가 "쓰이지 않은 @ts-expect-error" 로 typecheck 를 깨뜨린다.
    const revived: ExaminedUnit["kind"] = "pair";
    // `as string` 으로 넓혀서 비교한다 — 좁은 유니온 그대로 비교하면 `toBe` 의
    // 인자 쪽에서 다시 TS2769 가 나고, 그건 이 프로브가 잡으려는 회귀가 아니다.
    expect(revived as string).toBe("pair");
  });
});

describe("parsePreviousResult — warnings 를 정규화한다 (Task 6 · pair:4x6-2)", () => {
  const old = (over: Record<string, unknown> = {}) => JSON.stringify({
    schema: 1, applied: [], defects: [], ...over,
  });

  test("warnings 가 없는 구 파일도 ok 이고 [] 로 채워진다 — schema 는 그대로 1 이라 구분할 수 없다", () => {
    const r = parsePreviousResult(old());
    expect(r.status).toBe("ok");
    expect(r.status === "ok" && r.result.warnings).toEqual([]);
  });

  test("배열이 아닌 warnings 도 [] 로 정규화한다 — broken 으로 몰지 않는다", () => {
    const r = parsePreviousResult(old({ warnings: "경고 3건" }));
    expect(r.status).toBe("ok");
    expect(r.status === "ok" && r.result.warnings).toEqual([]);
  });

  test("있는 warnings 는 건드리지 않는다", () => {
    const w = oversizedClusterWarnings([
      { file: "src/big.ts", task_ids: Array.from({ length: CLUSTER_WARN_SIZE + 1 }, (_, i) => String(i + 1)) },
    ]);
    const r = parsePreviousResult(old({ warnings: w }));
    expect(r.status === "ok" && r.result.warnings).toEqual(w);
  });
});

describe("소스에 overlappingPairs 참조가 남아 있지 않다 (Ⓐa)", () => {
  // 테스트 파일 자신은 스캔하지 않는다 — 이 단언문이 그 문자열을 담고 있어
  // 스스로를 스캔하면 영원히 실패한다. 검사 대상은 **소스** 세 파일이다.
  const SOURCES = [
    "controller/preflight.ts",
    "controller/preflight-cli.ts",
    "workflows/plan-preflight.js",
  ];

  for (const f of SOURCES) {
    test(`${f} 에 죽은 참조가 없다`, () => {
      expect(readFileSync(f, "utf8")).not.toContain("overlappingPairs");
    });
  }
});

// `--plan` 출력은 **spawn 해야만** 관찰된다. `preflight-cli.ts` 는 최상위에서
// process.exit 을 부르는 스크립트라 아무도 import 하지 않고, 그래서 `bun test`
// 가 로드조차 하지 않는다 — 부모 Task 11 의 검증 공백이 정확히 그것이었다.
describe("bin/preflight — 클러스터 배선 (Task 6)", () => {
  const roots: string[] = [];
  const BIN = join(import.meta.dir, "..", "bin", "preflight");
  const BRANCH = "feature/x";

  afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

  const mkRepo = (planText: string) => {
    const root = mkdtempSync(join(tmpdir(), "engineer-bot-t6-"));
    roots.push(root);
    const dir = join(root, "docs", "plans", BRANCH.replace(/\//g, "-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plan.md"), planText, "utf8");
    return { root, dir };
  };

  const run = (root: string, ...args: string[]) => {
    const r = Bun.spawnSync([BIN, BRANCH, ...args], {
      env: { ...process.env, TARGET_REPO: root },
    });
    return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
  };

  const rawFor = (planText: string) => JSON.stringify({
    schema: 1,
    plan_sha256: planSha256(planText),
    stage1: { relations_declared: 0, defects: [] },
    stage2: { units_examined: [], units_failed: [], defects: [] },
  });

  const twoTaskPlan = planOf(
    fileTask(1, ["- Modify: `src/a.ts`"]),
    fileTask(2, ["- Modify: `src/a.ts`"]),
  );
  /** 경고선(12)을 넘기는 클러스터 하나 — 태스크 13개가 같은 파일을 쓴다 */
  const oversizedPlan = planOf(
    ...Array.from({ length: CLUSTER_WARN_SIZE + 1 }, (_, i) =>
      fileTask(i + 1, ["- Modify: `src/big.ts`"])),
  );

  test("--plan 출력에 clusters 가 있고 pairs 가 없다 (Ⓐc)", () => {
    const { root } = mkRepo(twoTaskPlan);
    const r = run(root, "--plan");
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.clusters).toEqual([{ file: "src/a.ts", task_ids: ["1", "2"] }]);
    expect(out.pairs).toBeUndefined();
  });

  test("--plan 출력에도 warnings 가 있다 — 팬아웃 전에 낼 수 있다", () => {
    const { root } = mkRepo(oversizedPlan);
    const out = JSON.parse(run(root, "--plan").stdout);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0].severity).toBe("warn");
    expect(out.warnings[0].message).toContain("src/big.ts");
  });

  test("--plan 의 warnings 는 경고가 없어도 배열로 존재한다", () => {
    const { root } = mkRepo(twoTaskPlan);
    expect(JSON.parse(run(root, "--plan").stdout).warnings).toEqual([]);
  });

  test("--record 가 쓴 preflight.json 에 warnings 배열이 있다", () => {
    const { root, dir } = mkRepo(twoTaskPlan);
    writeFileSync(join(dir, "preflight-raw.json"), rawFor(twoTaskPlan), "utf8");
    const r = run(root, "--record");
    expect(r.code).toBe(0);
    const written = JSON.parse(readFileSync(join(dir, "preflight.json"), "utf8"));
    expect(written.warnings).toEqual([]);
    expect(written.examined.filter((u: ExaminedUnit) => u.kind === "cluster")).toHaveLength(1);
  });

  test("경고가 사람이 읽는 콘솔에 닿는다 — 판정 줄의 경고 절과 message 줄 (pair:4x6-3)", () => {
    const { root, dir } = mkRepo(oversizedPlan);
    writeFileSync(join(dir, "preflight-raw.json"), rawFor(oversizedPlan), "utf8");
    const r = run(root, "--record");
    // DC5 — severity: "warn" 은 종료 코드를 바꾸지 않는다.
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("CLEAN");
    expect(r.stdout).toContain("· 경고 1건");
    expect(r.stderr).toContain("src/big.ts");
    expect(JSON.parse(readFileSync(join(dir, "preflight.json"), "utf8")).warnings).toHaveLength(1);
  });

  test("경고가 0건이면 판정 줄에 경고 절을 붙이지 않는다", () => {
    const { root, dir } = mkRepo(twoTaskPlan);
    writeFileSync(join(dir, "preflight-raw.json"), rawFor(twoTaskPlan), "utf8");
    const r = run(root, "--record");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("CLEAN");
    expect(r.stdout).not.toContain("경고");
  });

  test("--apply 가 warnings 없는 구 preflight.json 에도 warnings 를 남긴다 (pair:4x6-2)", () => {
    const onePlan = fileTask(1, ["- Modify: `src/a.ts`"]);
    const { root, dir } = mkRepo(onePlan);
    // 이 기능 **이전에** 쓰인 파일이다 — schema 는 그대로 1 인데 warnings 가 없다.
    // 읽는 쪽이 스키마 번호로는 두 형식을 구분할 수 없다는 것이 이 픽스처의 요점이다.
    const old = {
      schema: 1,
      branch: BRANCH,
      plan_sha256: planSha256(onePlan),
      scope: "interface-graph+file-overlap",
      verdict: "REJECTED",
      relations: { declared: 0, examined_stage1: 0, examined_stage2: 0, not_examined: [] },
      examined: [],
      defects: [{
        id: "d1", kind: "dangling_ref", task_ids: ["1", "2"], plan_text: "", conflict: "", stage: 1,
        patch: {
          op: "insert_after", task_id: "1",
          anchor: "- Modify: `src/a.ts`", text: "- Modify: `src/b.ts`",
        },
      }],
      applied: [],
    };
    expect(old).not.toHaveProperty("warnings");
    writeFileSync(join(dir, "preflight.json"), JSON.stringify(old), "utf8");

    const r = run(root, "--apply", "d1");
    expect(r.code).toBe(0);
    const written = JSON.parse(readFileSync(join(dir, "preflight.json"), "utf8"));
    expect(written.warnings).toEqual([]);
    expect(written.applied).toHaveLength(1);
  });
});
