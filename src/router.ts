import type { Intake, Route } from "./contracts.ts";

const HIGH_RISK = /production|deploy|migration|schema|database|auth|authentication|security|payment|billing|external|삭제|배포|마이그레이션|스키마|인증|보안|결제/i;
const BUG = /bug|fix|error|regression|broken|버그|오류|고쳐/i;
const FEATURE = /feature|add|implement|refactor|api|기능|추가|구현|리팩터/i;

function routeFor(request: string): Route {
  if (HIGH_RISK.test(request)) return "high-risk";
  if (BUG.test(request)) return "bug";
  if (FEATURE.test(request)) return "feature";
  return "small-change";
}

export function classify(request: string): Intake {
  const route = routeFor(request);
  const disciplines = ["Superpowers: verification-before-completion"];
  if (route === "bug") disciplines.unshift("gstack: triage", "Superpowers: systematic-debugging", "Superpowers: TDD");
  if (route === "feature" || route === "high-risk") {
    disciplines.unshift("gstack: discovery/planning", "Superpowers: writing-plans", "Superpowers: TDD");
  }
  return {
    request,
    route,
    requiresHumanGate: route === "high-risk",
    requiredDisciplines: disciplines,
  };
}
