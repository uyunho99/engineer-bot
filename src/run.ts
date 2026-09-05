import type { DeliveryPlan, ReviewVerdict, WorkerHandles } from "./contracts.ts";
import { initialTasks, transitionFor } from "./coordinator.ts";
import { dispatchCommand, execute, parseTaskId, taskCreateCommand, waitCommand } from "./orca.ts";

type Completion = { taskId?: string; text: string; verdict?: ReviewVerdict };

function findString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record[key] === "string") return record[key];
  for (const child of Object.values(record)) {
    const found = findString(child, key);
    if (found) return found;
  }
  return undefined;
}

export function parseCompletion(json: string): Completion {
  const value: unknown = JSON.parse(json);
  const text = JSON.stringify(value);
  const taskId = findString(value, "taskId");
  const verdict = (["PASS", "FIX_REQUIRED", "BLOCKED", "ESCALATE"] as const).find((item) => new RegExp(`\\b${item}\\b`).test(text));
  return { taskId, text, verdict };
}

function terminalFor(role: string, handles: WorkerHandles): string {
  if (role === "lead") return handles.lead;
  if (role === "implementer" || role === "fixer") return handles.codex;
  return handles.reviewer;
}

export async function runDelivery(plan: DeliveryPlan, handles: WorkerHandles): Promise<void> {
  const taskIds = new Map<string, string>();
  for (const spec of initialTasks(plan)) {
    const raw = await execute(taskCreateCommand(spec, taskIds));
    taskIds.set(spec.key, parseTaskId(raw));
  }
  const taskById = new Map([...taskIds.entries()].map(([key, id]) => [id, key]));
  await execute(dispatchCommand(taskIds.get("P0") ?? taskIds.get("I1")!, terminalFor(plan.tasks.find((task) => task.key === "P0") ? "lead" : "implementer", handles)));

  let next = plan.tasks.find((task) => task.key === "P0") ? "P0" : "I1";
  while (next !== "V1") {
    const completion = parseCompletion(await execute(waitCommand()));
    const completedKey = completion.taskId ? taskById.get(completion.taskId) : undefined;
    if (completedKey !== next) continue;
    if (completedKey === "P0") next = "I1";
    else if (completedKey === "I1") next = "R1";
    else if (completedKey === "R1") {
      if (!completion.verdict) throw new Error("R1 완료 보고에 PASS/FIX_REQUIRED/BLOCKED/ESCALATE 판정이 없습니다.");
      if (completion.verdict === "PASS") next = "Q1";
      else if (completion.verdict === "FIX_REQUIRED") {
        for (const key of ["F1", "RR1"]) {
          const spec = plan.tasks.find((task) => task.key === key)!;
          const raw = await execute(taskCreateCommand(spec, taskIds));
          const id = parseTaskId(raw);
          taskIds.set(key, id); taskById.set(id, key);
        }
        next = "F1";
      } else throw new Error(`리뷰 ${completion.verdict}: ${transitionFor(completion.verdict)}`);
    } else if (completedKey === "F1") next = "RR1";
    else if (completedKey === "RR1") {
      if (completion.verdict !== "PASS") throw new Error(`재리뷰 실패: ${completion.verdict ?? "판정 없음"}`);
      next = "Q1";
    } else if (completedKey === "Q1") next = "V1";
    const spec = plan.tasks.find((task) => task.key === next)!;
    await execute(dispatchCommand(taskIds.get(next)!, terminalFor(spec.role, handles)));
  }
  const finalCompletion = parseCompletion(await execute(waitCommand()));
  if (taskById.get(finalCompletion.taskId ?? "") !== "V1" || finalCompletion.verdict !== "PASS") throw new Error("최종 검증이 PASS로 끝나지 않았습니다.");
}
