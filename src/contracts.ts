export type Role = "lead" | "implementer" | "reviewer" | "fixer" | "qa" | "final_verifier";
export type Route = "small-change" | "bug" | "feature" | "high-risk";
export type ReviewVerdict = "PASS" | "FIX_REQUIRED" | "BLOCKED" | "ESCALATE";

export interface Intake {
  request: string;
  route: Route;
  requiresHumanGate: boolean;
  requiredDisciplines: string[];
}

export interface TaskSpec {
  key: string;
  role: Role;
  objective: string;
  writeAuthority: string;
  dependencies: string[];
  acceptance: string[];
  commands: string[];
  reviewOnly: boolean;
}

export interface DeliveryPlan {
  intake: Intake;
  tasks: TaskSpec[];
}

export interface OrcaCommand {
  args: string[];
  purpose: string;
}

export class ConfigurationError extends Error {}
