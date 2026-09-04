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

// ConsumeRef 를 import 하지 마라 — 이 파일은 `ifaces.consumes` 의 원소 타입을
// 추론에 맡기고 이름으로 붙들지 않는다. noUnusedLocals: true 에 걸린다 (TS6196).
import { createHash } from "node:crypto";
import type { ParsedTask, TaskInterfaces } from "./contract";
import { parseInterfaces, parseFiles, stripFences } from "./contract";
import type { PreflightDefect, FixPatch } from "./contract";
import type { CheckResult, Violation } from "./contract";

/**
 * plan.md 의 지문. **게이트 전체가 이 값의 비교 하나로 이루어진다** (설계 D26).
 *
 * `preflight-cli.ts`(검사 결과를 쓸 때)와 `builder.ts`(게이트에서 읽을 때)가
 * 같은 계산을 해야 한다. 두 곳에 각자 `createHash` 를 두면 한쪽만 바뀌어도
 * (인코딩·정규화·알고리즘) 게이트가 조용히 항상-불일치로 무너진다 —
 * 그래서 계산은 여기 한 곳에만 있다.
 *
 * `node:crypto` 는 이 파일의 "I/O 없음" 원칙을 깨지 않는다. 파일도 시계도
 * 네트워크도 건드리지 않는 순수 계산이고, 같은 입력에 같은 출력을 준다.
 */
export function planSha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

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
    // 소비 쪽이 **맨 심볼 이름만** 적었으면 서명을 주장하지 않은 것이다 —
    // `Consumes: \`Foo\`` 와 `Produces: \`interface Foo { ... }\`` 는 불일치가 아니다.
    // 이 줄이 없으면 타입을 이름으로 소비하는 정상 선언이 전부 후보가 된다
    // (2026-09-03 봇 실측: 이 플랜 한 건에서 오탐 후보 19건).
    if (r.symbol.trim() === want) return;
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

/** 클러스터 하나 — 파일 하나를 2개 이상 태스크가 쓴다. */
export interface FileCluster {
  file: string;
  task_ids: string[];
}

/**
 * 클러스터 크기 상한 경고선. Task 4 가 이 값을 넘는 클러스터에 경고를 낸다
 * (여기서는 값만 선언한다 — 경고 로직은 아직 없다).
 */
export const CLUSTER_WARN_SIZE = 12;

/**
 * `overlappingPairs` 를 짝(O(n²))에서 **파일 클러스터**(O(n))로 바꾼 것 —
 * 부모 플랜 실측: 짝 39개 → 클러스터 2개 (`controller/preflight.ts` 9태스크,
 * `controller/contract.ts` 3태스크; 짝 검산 36 + 3 = 39).
 *
 * **DC1 — 단위는 파일이지, 연결 성분(connected component)이 아니다.** 태스크가
 * 파일 A·B 를 둘 다 쓰면 A 클러스터와 B 클러스터에 각각 나온다. A-B 를 하나로
 * 합치지 않는다 — 합치면 파일을 통해서만 이어진 무관한 태스크들이 전이적으로
 * 한 검사 단위에 뭉쳐, `overlappingPairs` 가 잡던 "이 두 태스크가 이 파일을 두고
 * 충돌하는가"라는 국소적 질문이 흐려진다.
 *
 * `overlappingPairs` 와 같은 write-set 규칙을 쓴다: Create + Modify 만 보고
 * Test 는 제외한다 (같은 테스트 파일에 케이스를 추가하는 것은 정상이다).
 */
export function overlappingClusters(tasks: ParsedTask[]): FileCluster[] {
  const byFile = new Map<string, string[]>();
  for (const t of tasks) {
    const f = parseFiles(t.body);
    for (const file of new Set([...f.create, ...f.modify])) {
      const ids = byFile.get(file);
      if (ids) ids.push(t.id);
      else byFile.set(file, [t.id]);
    }
  }

  const out: FileCluster[] = [];
  for (const [file, task_ids] of byFile) {
    if (task_ids.length >= 2) out.push({ file, task_ids });
  }
  out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return out;
}

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

// ─── 워크플로우 산출 검증 (설계 D11 · D28 · 하드룰 #4) ────────────────────

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

/**
 * 결함 하나의 형태를 검증한다.
 *
 * **`patch` 까지 검증한다.** 이 값은 AI 가 만들어 파일 경계를 두 번 건너온 뒤
 * (`preflight-raw.json` → `--record` → `preflight.json` → `--apply`)
 * `applyPatch` 를 통해 **plan.md 를 실제로 고친다.** 여기서 안 막으면:
 *   anchor 누락 → `--apply` 도중 `patch.anchor.trim()` 이 TypeError
 *   op 오타     → 조용히 insert_after 로 동작 (replace 를 기대했는데 줄이 늘어난다)
 *   text 비문자열 → 강제 변환된 값이 plan.md 에 들어가 D14(바이트 그대로)가 깨진다
 *
 * `rule` 은 항목마다 다르다 (사람이 근거 조항을 찾을 수 있어야 한다):
 * D27 은 **task_ids 튜플** 결정이고, 나머지 형태 검증은 D28(워크플로우 산출 계약)이다.
 */
function checkDefectShape(d: unknown, where: string, v: Violation[]): void {
  const o = d as Record<string, unknown>;
  const bad = (m: string, rule = "D28") =>
    v.push({ severity: "error", file: "preflight-raw.json", rule, message: `${where}: ${m}` });
  // `v.push()` 는 number 를 반환하므로 `return bad(...)` 는 `: void` 선언과
  // 충돌한다 (TS2322). 조기 반환은 두 줄로 쓴다.
  if (!o || typeof o !== "object") {
    bad("결함 항목이 객체가 아닙니다");
    return;
  }
  if (typeof o.id !== "string" || !o.id) bad("id 가 없습니다");
  if (typeof o.kind !== "string" || !KINDS.has(o.kind)) bad(`kind 가 유효하지 않습니다: ${String(o.kind)}`);
  if (!Array.isArray(o.task_ids) || o.task_ids.length < 2) {
    bad("task_ids 가 2개 미만입니다 — 사전 검사 결함은 관계입니다", "D27");
  } else if (o.task_ids.some((t) => typeof t !== "string")) {
    // 원소 타입까지 봐야 한다. `[1, 2]` 는 길이 검사를 통과하지만 그 뒤
    // `concernsUnit` 의 `d.task_ids.includes("1")` 이 false 가 되어 **진짜 결함이
    // 있는 관계가 `clean` 으로 기록된다** — 거짓 음성이고, 이 기능에서 가장
    // 위험한 방향이다 (안 본 것을 통과로 쓰는 것과 같은 실패).
    bad("task_ids 의 원소가 문자열이 아닙니다 — 태스크 번호는 문자열로 적습니다", "D27");
  }
  if (typeof o.plan_text !== "string") bad("plan_text 가 없습니다");
  if (typeof o.conflict !== "string") bad("conflict 가 없습니다");
  if (o.stage !== 1 && o.stage !== 2) bad("stage 가 1 또는 2 가 아닙니다");

  // patch 는 선택 필드다 — 없는 것은 정상이고, **있으면** plan.md 를 고칠 권한을
  // 갖는다. 그래서 있을 때만, 그러나 빠짐없이 본다 (설계 D24).
  if (o.patch === undefined) return;
  const p = o.patch as Record<string, unknown>;
  if (!p || typeof p !== "object" || Array.isArray(p)) {
    bad("patch 가 객체가 아닙니다");
    return;
  }
  if (p.op !== "insert_after" && p.op !== "replace") {
    bad(`patch.op 이 insert_after 도 replace 도 아닙니다: ${String(p.op)}`);
  }
  if (typeof p.task_id !== "string" || !p.task_id) bad("patch.task_id 가 없습니다");
  // anchor 는 `findFixSites` 가 `.trim()` 을 부르는 값이다. 빈 문자열도 거부한다 —
  // 빈 앵커는 태스크 본문의 모든 빈 줄에 매치돼 ambiguous 아니면 오적용이 된다.
  if (typeof p.anchor !== "string" || !p.anchor.trim()) bad("patch.anchor 가 없거나 비어 있습니다");
  // text 는 빈 문자열이 정당하다 (빈 줄로 교체). 타입만 본다.
  if (typeof p.text !== "string") bad("patch.text 가 문자열이 아닙니다");
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

// ─── 결과 조립 (설계 D9 · D15 · D29) ────────────────────────────────────

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
  /**
   * 시각을 주입받는다 — 순수 함수를 유지하려고 (테스트 가능).
   * Task 9의 `assembleResult` 는 아직 이 값을 읽지 않는다 — 소비는 Task 11부터다.
   */
  now: string;
}

/**
 * 이 단위(관계 또는 짝)를 **하나의** 결함이 지목하는가.
 *
 * 전체 결함의 task_ids 를 합집합으로 뭉쳐서 멤버십을 보면 안 된다 — 서로 무관한 결함
 * 둘이 이 단위의 양쪽 끝을 하나씩 나눠 지목해도 "결함 있음"으로 오판하게 된다.
 * 그래서 **개별** 결함 하나가 unitTaskIds 전부를 담고 있는지를 본다.
 *
 * `relation` 필드로 비교하지 않는다 — `signatureCandidates` 는 `relation` 에 심볼의
 * 순수 이름만 넣고(`danglingRefs`/`orderViolations` 는 전체 서명을 넣는다), 정확히
 * 일치 비교하면 진짜 서명 불일치 결함을 "clean" 으로 놓치는 거짓 음성이 생긴다.
 * task_ids 양끝 포함 여부는 1단계 세 생성기 모두 `pair(consumer, declaredFrom)` 으로
 * 두 끝을 항상 채우므로 이 위험이 없다 — 오판의 방향을 안전한 쪽(과다 표시)으로 둔다.
 */
function concernsUnit(defects: PreflightDefect[], unitTaskIds: string[]): "clean" | "defect" {
  return defects.some((d) => unitTaskIds.every((id) => d.task_ids.includes(id)))
    ? "defect"
    : "clean";
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

  const examined: ExaminedUnit[] = [
    ...graph.relations.map((r) => ({
      kind: "relation" as const,
      label: `${r.symbol} (Task ${r.declaredFrom ?? "?"} → Task ${r.consumer})`,
      task_ids: r.declaredFrom ? [r.declaredFrom, r.consumer] : [r.consumer],
      result: concernsUnit(defects, r.declaredFrom ? [r.consumer, r.declaredFrom] : [r.consumer]),
    })),
    ...pairs.map((p) => ({
      kind: "pair" as const,
      label: p.sharedFiles.join(", "),
      task_ids: [p.a, p.b],
      result: concernsUnit(defects, [p.a, p.b]),
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

/**
 * 대상 태스크가 플랜 전체에서 차지하는 줄 범위 [시작, 끝).
 *
 * 헤딩 탐지는 **펜스를 벗긴 줄**(`stripFences`)에서 한다 — `parseTasks`(contract.ts)와
 * 같은 패턴이다. `stripFences`는 펜스 내용을 빈 문자열로 바꿀 뿐 줄을 지우지 않으므로
 * 줄 번호는 원본과 그대로 맞는다. 펜스 안에 열 0에서 시작하는 `### Task N: ...` 같은
 * 문자열이 있어도(계획서 작성 예시가 실제로 그런 걸 담는다 — overlay/writing-plans-tagging.md
 * 참고) 가짜 헤딩으로 오탐해 범위를 끊지 않는다.
 */
function taskLineRange(planText: string, taskId: string): [number, number] | null {
  // task_id 는 AI 가 생성한 JSON(FixPatch)에서 오고 타입은 무제한 string 이다.
  // 이스케이프 없이 정규식에 그대로 넣으면 `(`, `[` 같은 문자에서 new RegExp 가 던진다.
  // 태스크 ID는 항상 숫자다(contract.ts TASK_HEADING) — 숫자가 아니면 애초에 매치될
  // 헤딩이 없으므로 정규식을 만들지 않고 바로 not_found 경로로 보낸다.
  if (!/^\d+$/.test(taskId)) return null;
  const lines = stripFences(planText).split("\n");
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
 *
 * 범위(`taskLineRange`)는 펜스 기준으로 계산하지만, **앵커 매칭 자체는 원본
 * 줄에서 한다** — 의도적이다. 앵커는 사람이 승인한 리터럴 한 줄이고, 계획서의
 * 태스크 본문은 정당하게 펜스 블록 안에 코드를 담는다(패치 대상이 펜스 안에
 * 있을 수 있다). 펜스 여부로 앵커 매칭까지 걸러내면 그런 정당한 타깃을
 * `not_found`로 오판한다. 펜스 인식은 범위 계산에만 필요하다.
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

// ─── 게이트 ① 판정 (설계 D10 · D23) ────────────────────────────────────

/**
 * 직전 `preflight.json` 을 읽어낸 결과. **세 갈래가 전부 다르다** (하드룰 #4).
 *
 * `none` 과 `broken` 을 섞으면 안 된다. `gateDecision` 은 `previous: null` 을
 * "아직 검사 안 함 → run" 으로 옳게 처리하므로, 깨진 파일을 null 로 넘기면
 * **깨진 게이트 산출물이 조용히 평범한 재검사로 바뀐다.** 그건 판정할 수 없는
 * 상태(BLOCKED)를 판정한 상태로 위조하는 것이다.
 */
export type PreviousResult =
  | { status: "none" }
  | { status: "ok"; result: PreflightResult }
  | { status: "broken"; reason: string };

/**
 * `preflight.json` 본문을 방어적으로 해석한다 (하드룰 #4).
 *
 * **던지지 않는다.** 이전 구현은 CLI 최상위에서 `JSON.parse` 를 감싸지 않고
 * 불렀고, 그 자리가 모드 분기보다 앞이라 파일이 한 글자만 깨져도 네 모드
 * 전부가 스택 트레이스로 죽었다 — `--record` 는 자기 `BLOCKED:` 메시지에
 * 닿지도 못하고, `--gate` 는 설계 D23 이 요구하는 exit 0 을 어겼다.
 *
 * 형태 검증은 `--apply` 가 신뢰하는 최소한만 본다: `applied` 와 `defects` 는
 * 배열이어야 한다 (`[...previous.applied]` 와 `previous.defects.find(...)` 가
 * 그것을 전제로 한다). `PreflightResult` 타입은 그대로다 — 이건 런타임 방어다.
 */
export function parsePreviousResult(raw: string | null): PreviousResult {
  if (raw === null) return { status: "none" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { status: "broken", reason: `JSON 파싱 실패: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "broken", reason: "최상위가 객체가 아닙니다" };
  }
  const o = parsed as Partial<PreflightResult>;
  if (o.schema !== 1) return { status: "broken", reason: `schema 가 1이 아닙니다: ${String(o.schema)}` };
  if (!Array.isArray(o.applied)) return { status: "broken", reason: "applied 가 배열이 아닙니다" };
  if (!Array.isArray(o.defects)) return { status: "broken", reason: "defects 가 배열이 아닙니다" };
  return { status: "ok", result: parsed as PreflightResult };
}

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

  // BLOCKED 사유에도 **다음 행동**이 붙어야 한다. REJECTED 형제들은 전부
  // "다시 검사하세요"/"/preflight 를 실행하세요" 로 끝나는데 BLOCKED 만
  // 진단으로 끝나면, 사람은 문서를 고치려 들었다가(그건 REJECTED 의 처방이다)
  // 아무 변화가 없는 것을 보게 된다.
  const REDO = "preflight.json 을 지우고 /preflight 를 다시 실행하세요";

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false, outcome: "BLOCKED",
      violations: v(
        `preflight.json JSON 파싱 실패: ${e instanceof Error ? e.message : String(e)} — ${REDO}`,
      ),
    };
  }

  const o = parsed as Partial<PreflightResult>;
  if (o?.schema !== 1) {
    return {
      ok: false, outcome: "BLOCKED",
      violations: v(`preflight.json schema 가 1이 아닙니다: ${String(o?.schema)} — ${REDO}`),
    };
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
