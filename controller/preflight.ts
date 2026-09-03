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
import type { ParsedTask, TaskInterfaces } from "./contract";
import { parseInterfaces, parseFiles } from "./contract";
import type { PreflightDefect } from "./contract";

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
