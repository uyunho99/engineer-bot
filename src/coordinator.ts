import type { DeliveryPlan, ReviewVerdict, TaskSpec } from "./contracts.ts";

const INITIAL_KEYS = new Set(["P0", "I1", "R1", "Q1", "V1"]);

export function initialTasks(plan: DeliveryPlan): TaskSpec[] {
  return plan.tasks.filter((item) => INITIAL_KEYS.has(item.key));
}

export function renderDryRun(plan: DeliveryPlan): string {
  const header = [`경로: ${plan.intake.route}`, `사람 게이트: ${plan.intake.requiresHumanGate ? "필수" : "조건부"}`, "적용 규율:", ...plan.intake.requiredDisciplines.map((item) => `- ${item}`)];
  const tasks = plan.tasks.map((item) => `- ${item.key} [${item.role}] ← ${item.dependencies.join(", ") || "시작"}: ${item.objective}`);
  return [...header, "DAG:", ...tasks, "", "조건부 전환: R1 PASS → Q1, R1 FIX_REQUIRED → F1 → RR1 → Q1"].join("\n");
}

export function transitionFor(verdict: ReviewVerdict): string {
  switch (verdict) {
    case "PASS": return "Q1 QA 태스크를 배정한다.";
    case "FIX_REQUIRED": return "F1 Codex fixer와 RR1 Claude 재리뷰를 생성하고, RR1 PASS 뒤 Q1을 배정한다.";
    case "BLOCKED": return "워커 질문이면 ask/reply, coordinator 결정이면 사람 게이트로 branch를 보류한다.";
    case "ESCALATE": return "branch를 중단하고 선택지·권장안·근거가 담긴 사람 게이트를 생성한다.";
  }
}
