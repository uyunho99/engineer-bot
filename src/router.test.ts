import { expect, test } from "bun:test";
import { buildDeliveryPlan } from "./dag.ts";
import { transitionFor } from "./coordinator.ts";
import { classify } from "./router.ts";

test("보안 변경은 사람 게이트가 필요한 high-risk로 라우팅한다", () => {
  const intake = classify("인증 토큰 검증을 변경하고 production에 배포해");
  expect(intake.route).toBe("high-risk");
  expect(intake.requiresHumanGate).toBe(true);
});

test("기능 변경은 구현-리뷰-QA와 조건부 fixer 흐름을 만든다", () => {
  const plan = buildDeliveryPlan(classify("팀 초대 기능을 추가해"));
  expect(plan.tasks.map((task) => task.key)).toEqual(["P0", "I1", "R1", "F1", "RR1", "Q1", "V1"]);
  expect(plan.tasks.find((task) => task.key === "R1")?.writeAuthority).toBe("none");
  expect(transitionFor("FIX_REQUIRED")).toContain("F1");
});
