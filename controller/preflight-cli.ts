/**
 * bin/preflight 의 구현. **여기에만 파일 I/O 가 있다.**
 * 판단은 전부 preflight.ts 의 순수 함수가 한다 (설계 D1).
 *
 * 종료 코드 (bin/preflight 헤더와 같은 표를 유지하라):
 *   0  정상. `--gate` 는 **어떤 판정이든 0** 이다 — 훅이 저장을 막으면 안 된다 (설계 D23)
 *   1  기계가 판정했고 결과가 REJECTED 다 (플랜을 고쳐야 한다)
 *   2  사용법·전제 조건 위반 (모드가 없다, --record 를 먼저 돌려야 한다 …)
 *   3  앵커 후보가 여러 개다 — 사람이 위치를 골라야 한다 (설계 D22)
 *   4  BLOCKED. **판정 자체를 하지 못했다** (하드룰 #4)
 *
 * 1 과 4 를 섞지 마라. "결함이 있다" 와 "결함이 있는지 알 수 없다" 는 사람이
 * 할 일이 다르고(문서 수정 대 하네스 수정), 호출자는 종료 코드로만 그 둘을 구분한다.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { checkPlan, parseTasks } from "./contract";
import { contractPaths } from "./paths";
import {
  applyPatch, assembleResult, buildRelationGraph, checkPreflightRaw,
  gateDecision, overlappingPairs, parsePreviousResult, planSha256, stage1Defects,
  type PreflightResult,
} from "./preflight";
// findFixSites 를 import 하지 마라. 이 파일에서 쓰이지 않고,
// tsconfig 의 noUnusedLocals: true 때문에 Step 4 의 typecheck 가 실패한다.
// (2026-09-03 봇이 BLOCKED 보고에서 지적한 결함)

const readOr = (p: string, d = "") => (existsSync(p) ? readFileSync(p, "utf8") : d);

const [branch, mode, ...rest] = process.argv.slice(2);
const p = contractPaths(process.env.TARGET_REPO ?? process.cwd(), branch);

const planText = readOr(p.plan);
// 해시 계산은 preflight.ts 의 planSha256 하나뿐이다 — builder.ts 의 게이트가
// 이 값과 바이트 단위로 비교하므로 두 곳에 각자 두면 드리프트가 게이트를 깬다.
const planSha = planText ? planSha256(planText) : "";
// **여기서 던지면 네 모드 전부가 죽는다.** 이 줄은 모드 분기보다 앞이므로
// 깨진 preflight.json 하나로 `--plan`(이 값을 쓰지도 않는다)까지 스택 트레이스로
// 끝났다. 해석은 방어적으로 하고, 깨진 경우의 처방은 모드마다 따로 준다.
const prev = parsePreviousResult(existsSync(p.preflight) ? readFileSync(p.preflight, "utf8") : null);
const previous: PreflightResult | null = prev.status === "ok" ? prev.result : null;

if (mode === "--gate") {
  // 게이트는 **어떤 경우에도 exit 0** 이다 (설계 D23). 깨진 산출물을 "검사 안 함"
  // 으로 강등하지도 않는다 — gateDecision(previous: null) 은 run 을 내므로,
  // 그러면 판정 불가가 평범한 재검사로 위조된다.
  if (prev.status === "broken") {
    console.log(`blocked: preflight.json 을 읽을 수 없습니다 — ${prev.reason}`);
    console.log("→ preflight.json 을 지우고 /preflight 를 다시 실행하세요.");
    process.exit(0);
  }
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
  // 직전 결과는 applied[] 누적의 출처다 (설계 D29). 깨졌으면 누적을 이어붙일
  // 근거가 없다 — 빈 배열로 시작하면 사람이 승인한 수정의 감사 추적이 사라진다.
  if (prev.status === "broken") {
    console.error(`BLOCKED: 기존 preflight.json 을 읽을 수 없습니다 — ${prev.reason}`);
    console.error("  preflight.json 을 지우고 /preflight 를 다시 실행하세요 (applied 이력은 함께 사라집니다)");
    process.exit(4);
  }
  const raw = readOr(p.preflightRaw);
  if (!raw) {
    console.error("BLOCKED: preflight-raw.json 이 없습니다 — 워크플로우가 결과를 남기지 않았습니다");
    process.exit(4);
  }
  const checked = checkPreflightRaw(raw, planSha);
  if (!checked.ok || !checked.data) {
    console.error("BLOCKED: preflight-raw.json 검증 실패");
    for (const v of checked.violations) console.error(`  ${v.severity}: ${v.message}`);
    process.exit(4);
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
  // 판정 줄은 **판정했을 때만** 찍는다. 단위가 실패했으면 아래 BLOCKED 분기로 가는데,
  // 그 앞에 `REJECTED — 결함 0건` 이 찍히면 사람이 그 줄만 보고 오해한다.
  if (!result.relations.not_examined.length) {
    console.log(
      `${result.verdict} — 결함 ${result.defects.length}건 · 관계 ${result.relations.declared}개 검사`,
    );
  }
  // 검사 단위가 하나라도 실패했으면 **판정한 것이 아니다** — BLOCKED 다.
  //
  // preflightVerdict 는 not_examined 가 있으면 REJECTED 를 내는데, Verdict 타입에
  // BLOCKED 이 없어서 그렇다 (CLEAN | REJECTED). 그대로 exit 1 을 내면 스킬이
  // 사람에게 "계획서를 고치세요"라고 안내한다 — **계획서는 멀쩡하고 검사기가
  // 죽은 것인데도.** 종료 코드 층에서 바로잡는다 (하드룰 #4).
  //
  // 2026-09-04 실측: 사용량 한도로 검증 에이전트 15개가 실패했다. 그때 워크플로우가
  // 실패를 기록조차 하지 않아 not_examined 가 비었고, 발견 44건 중 1건만 보고되면서
  // 나머지 14건이 조용히 사라졌다 (완결성 검사관 5건 전부 포함). 워크플로우 쪽은
  // 고쳤고, 이 분기는 그 기록이 판정까지 도달하게 만드는 나머지 절반이다.
  if (result.relations.not_examined.length) {
    console.error(
      `BLOCKED: 검사 단위 ${result.relations.not_examined.length}개가 실패했습니다 — ` +
        `판정하지 못했습니다`,
    );
    console.error(`  실패한 단위: ${result.relations.not_examined.join(", ")}`);
    console.error(`  계획서를 고치지 마십시오. 2단계부터 다시 실행하십시오.`);
    console.error(`  (부분 결과는 ${p.preflight} 에 남아 있습니다 — 결함 ${result.defects.length}건)`);
    process.exit(4);
  }
  // 1 = 판정했고 REJECTED. 위의 4(BLOCKED)와 다른 값이어야 한다.
  process.exit(result.verdict === "CLEAN" ? 0 : 1);
}

if (mode === "--apply") {
  // 깨진 결과 파일을 "없음"으로 취급하지 않는다. `previous.applied` 와
  // `previous.defects` 를 그대로 신뢰해 plan.md 를 고치는 모드다.
  if (prev.status === "broken") {
    console.error(`BLOCKED: preflight.json 을 읽을 수 없습니다 — ${prev.reason}`);
    console.error("  plan.md 를 고치지 않았습니다. preflight.json 을 지우고 /preflight 를 다시 실행하세요");
    process.exit(4);
  }
  if (!previous) {
    console.error("preflight.json 이 없습니다 — 먼저 --record 를 실행하세요");
    process.exit(2);
  }
  let text = planText;
  const applied = [...previous.applied];
  for (const id of rest) {
    const d = previous.defects.find((x) => x.id === id);
    if (!d?.patch) {
      console.error(`결함 ${id} 에 적용할 패치가 없습니다`);
      process.exit(2);
    }
    // 매 반복마다 "지금까지 누적된" text 기준으로 before 해시를 다시 계산한다.
    // 루프 밖에서 한 번만 잡으면 2번째 id부터 직전 패치가 이미 반영된 상태를
    // 반영하지 못해, applied[] 의 sha256_after(N) === sha256_before(N+1) 체인이
    // 깨진다 — 이 로그는 사람이 승인한 수정의 감사 추적이라 체인이 생명이다
    // (설계 D15·D29, 2026-09-03 리뷰 지적).
    const before = planSha256(text);
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
      sha256_before: before, sha256_after: planSha256(text),
    });
  }
  writeFileSync(p.plan, text, "utf8");
  writeFileSync(p.preflight, JSON.stringify({ ...previous, applied }, null, 2), "utf8");
  console.log(`적용 ${rest.length}건 — plan.md 가 바뀌었으므로 재검사가 필요합니다`);
  process.exit(0);
}

console.error(`알 수 없는 모드: ${mode}`);
process.exit(2);
