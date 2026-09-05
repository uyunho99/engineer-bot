import { buildDeliveryPlan } from "./dag.ts";
import { renderDryRun } from "./coordinator.ts";
import { requireRunningRuntime, resolveNamedWorkerHandles } from "./orca.ts";
import { classify } from "./router.ts";
import { runDelivery } from "./run.ts";

function valueAfter(flag: string): string | undefined {
  const index = Bun.argv.indexOf(flag);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
}

async function plan(): Promise<void> {
  const request = valueAfter("--request");
  if (!request) throw new Error("--request로 개발 요청을 입력하세요.");
  const delivery = buildDeliveryPlan(classify(request));
  const executeMode = Bun.argv.includes("--execute");
  console.log(renderDryRun(delivery));
  if (!executeMode) return;
  await requireRunningRuntime();
  const discovered = await resolveNamedWorkerHandles();
  const lead = valueAfter("--lead") ?? discovered.lead;
  const codex = valueAfter("--codex") ?? discovered.codex;
  const reviewer = valueAfter("--reviewer") ?? discovered.reviewer;
  console.log("Orca 태스크 생성·injected dispatch·review/fix/QA lifecycle을 시작합니다.");
  await runDelivery(delivery, { lead, codex, reviewer });
  console.log("최종 검증 PASS: 자동 delivery loop가 완료됐습니다.");
}

async function smoke(): Promise<void> {
  const delivery = buildDeliveryPlan(classify("순수 함수 하나를 추가하고 단위 테스트를 작성해"));
  const keys = new Set(delivery.tasks.map((task) => task.key));
  for (const required of ["I1", "R1", "F1", "RR1", "Q1", "V1"]) {
    if (!keys.has(required)) throw new Error(`Smoke test 실패: ${required} 태스크가 없습니다.`);
  }
  if (!delivery.tasks.find((task) => task.key === "R1")?.reviewOnly) throw new Error("Smoke test 실패: R1은 review-only여야 합니다.");
  console.log("Smoke test 통과: 구현·리뷰·수정·재리뷰·QA·최종검증 DAG와 lifecycle 계약이 준비됐습니다.");
}

const command = Bun.argv[2];
if (command === "plan") await plan();
else if (command === "smoke") await smoke();
else throw new Error("사용법: bun run src/cli.ts <plan|smoke> [--dry-run|--execute] [--request <요청>]");
