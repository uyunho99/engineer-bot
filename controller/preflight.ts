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
