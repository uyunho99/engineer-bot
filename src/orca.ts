import { ConfigurationError, type OrcaCommand, type TaskSpec, type WorkerHandles } from "./contracts.ts";
import { workerPrompt } from "./dag.ts";

export function taskCreateCommand(spec: TaskSpec, taskIds: Map<string, string>): OrcaCommand {
  const deps = spec.dependencies.map((key) => taskIds.get(key)).filter((id): id is string => Boolean(id));
  const args = ["orchestration", "task-create", "--spec", workerPrompt(spec), "--json"];
  if (deps.length > 0) args.splice(-1, 0, "--deps", JSON.stringify(deps));
  return { args, purpose: `${spec.key} 태스크 생성` };
}

export async function requireRunningRuntime(): Promise<void> {
  const process = Bun.spawn(["orca", "status", "--json"], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(process.stdout).text();
  if ((await process.exited) !== 0) throw new ConfigurationError(`Orca 상태 확인 실패: ${stdout}`);
  const state = JSON.parse(stdout) as { result?: { runtime?: { reachable?: boolean } } };
  if (!state.result?.runtime?.reachable) throw new ConfigurationError("Orca runtime이 실행 중이지 않습니다. Orca 앱을 실행한 뒤 다시 시도하세요.");
}

export async function execute(command: OrcaCommand): Promise<string> {
  const process = Bun.spawn(["orca", ...command.args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text()]);
  if ((await process.exited) !== 0) throw new ConfigurationError(`${command.purpose} 실패: ${stderr || stdout}`);
  return stdout;
}

export function parseTaskId(json: string): string {
  const value = JSON.parse(json) as { result?: { id?: string; taskId?: string; task?: { id?: string } }; id?: string; taskId?: string };
  const id = value.result?.id ?? value.result?.taskId ?? value.result?.task?.id ?? value.id ?? value.taskId;
  if (!id) throw new ConfigurationError("Orca task-create 응답에서 task ID를 찾지 못했습니다.");
  return id;
}

export function dispatchCommand(taskId: string, terminal: string): OrcaCommand {
  return { args: ["orchestration", "dispatch", "--task", taskId, "--to", terminal, "--inject", "--json"], purpose: `${taskId} injected dispatch` };
}

export function waitCommand(): OrcaCommand {
  return { args: ["orchestration", "check", "--wait", "--types", "worker_done,escalation,decision_gate", "--timeout-ms", "60000", "--json"], purpose: "워커 lifecycle 대기" };
}

export async function resolveNamedWorkerHandles(): Promise<WorkerHandles> {
  const child = Bun.spawn(["orca", "terminal", "list", "--json"], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  if ((await child.exited) !== 0) throw new ConfigurationError(`Orca terminal 목록 확인 실패: ${stderr || stdout}`);
  const value = JSON.parse(stdout) as { result?: { terminals?: Array<{ handle: string; title: string; worktreePath: string }> } };
  const terminals = value.result?.terminals?.filter((terminal) => terminal.worktreePath === process.cwd()) ?? [];
  const handle = (title: string): string => {
    const found = terminals.find((terminal) => terminal.title === title)?.handle;
    if (!found) throw new ConfigurationError(`현재 workspace에 '${title}' 터미널이 없습니다. Orca 화면에서 역할 터미널을 먼저 준비하세요.`);
    return found;
  };
  return { lead: handle("Claude Lead"), codex: handle("Codex Implementer"), reviewer: handle("Claude Review and QA") };
}
