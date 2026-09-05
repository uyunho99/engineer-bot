import { buildDeliveryPlan } from "./dag.ts";
import { initialCommands, renderDryRun } from "./coordinator.ts";
import { execute, requireRunningRuntime } from "./orca.ts";
import { classify } from "./router.ts";

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
  for (const command of initialCommands(delivery)) console.log(await execute(command));
  console.log("초기 Orca 태스크를 생성했습니다. Lead는 check --wait로 lifecycle을 감독해야 합니다.");
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
