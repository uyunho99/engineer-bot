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
