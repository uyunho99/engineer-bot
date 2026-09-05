import type { DeliveryPlan, Intake, TaskSpec } from "./contracts.ts";

const checks = ["프로젝트의 typecheck 실행", "프로젝트의 테스트 실행"];

function task(spec: TaskSpec): TaskSpec {
  return spec;
}

export function buildDeliveryPlan(intake: Intake): DeliveryPlan {
  const plan: TaskSpec[] = [];
  const needsPlan = intake.route !== "small-change";
  if (needsPlan) {
    plan.push(task({
      key: "P0", role: "lead", objective: "수용 기준, 비목표, 경로 소유권, 위험을 포함한 승인 가능한 구현 brief 작성",
      writeAuthority: "docs/plans/**", dependencies: [], acceptance: ["검증 가능한 수용 기준", "경로 소유권", "테스트 매트릭스"], commands: [], reviewOnly: false,
    }));
  }
  const implementationDeps = needsPlan ? ["P0"] : [];
  plan.push(task({
    key: "I1", role: "implementer", objective: intake.request, writeAuthority: "Lead가 지정한 구현 경로만",
    dependencies: implementationDeps, acceptance: ["요청 수용 기준 충족", "관련 없는 변경 없음"], commands: checks, reviewOnly: false,
  }));
  plan.push(task({
    key: "R1", role: "reviewer", objective: "I1 diff와 증거를 독립 리뷰하고 PASS/FIX_REQUIRED/BLOCKED/ESCALATE 판정",
    writeAuthority: "none", dependencies: ["I1"], acceptance: ["발견 사항에 재현·근거·수정 조건 포함"], commands: checks, reviewOnly: true,
  }));
  plan.push(task({
    key: "F1", role: "fixer", objective: "R1의 FIX_REQUIRED 발견 사항만 최소 범위에서 수정",
    writeAuthority: "R1에서 지정한 경로만", dependencies: ["R1"], acceptance: ["각 발견 사항의 회귀 검사 통과"], commands: checks, reviewOnly: false,
  }));
  plan.push(task({
    key: "RR1", role: "reviewer", objective: "F1 수정 사항을 독립 재리뷰. R1 PASS면 생략",
    writeAuthority: "none", dependencies: ["F1"], acceptance: ["R1 발견 사항이 해소됨"], commands: checks, reviewOnly: true,
  }));
  plan.push(task({
    key: "Q1", role: "qa", objective: "수용 기준, 사용자 흐름, 회귀, 비목표를 독립 QA",
    writeAuthority: "none", dependencies: ["R1"], acceptance: ["수용 기준 매트릭스 완결"], commands: checks, reviewOnly: true,
  }));
  plan.push(task({
    key: "V1", role: "final_verifier", objective: "Orca provenance와 QA 증거를 확인하고 완료 권고",
    writeAuthority: "none", dependencies: ["Q1"], acceptance: ["미해결 리뷰 항목 없음", "필수 gate 해결"], commands: checks, reviewOnly: true,
  }));
  return { intake, tasks: plan };
}

export function workerPrompt(spec: TaskSpec): string {
  return [
    `ROLE: ${spec.role}`, `WRITE AUTHORITY: ${spec.writeAuthority}`, `OBJECTIVE: ${spec.objective}`,
    `ACCEPTANCE: ${spec.acceptance.join("; ")}`, `COMMANDS: ${spec.commands.join("; ") || "해당 없음"}`,
    "CONSTRAINTS: 서브에이전트 생성 금지. 소유하지 않은 경로 수정 금지. 범위 확대 금지.",
    "REPORT: 변경 경로, 근거, 명령/결과, 남은 위험, 정확한 상태.",
    "LIFECYCLE: injected Orca preamble의 taskId/dispatchId로만 worker_done을 보낸다. 막히면 ask 또는 escalation을 사용한다.",
  ].join("\n");
}
