/**
 * builder-bot 컨트롤러 (명세 §5).
 *
 * **이 파일은 SDD 루프를 재구현하지 않는다.** superpowers 6.2.0의
 * subagent-driven-development가 이미 ledger·resume·수정 라운드·모델 선택·
 * 리뷰어를 갖고 있다. 재구현은 사실상 fork이며 P4 위반이다.
 *
 * 컨트롤러의 책임은 SDD **바깥**의 5가지다:
 *   1. 계약 검증 — 빌드 시작 전 게이트 (§4.3)
 *   2. headless 세션 기동 — 오버레이 주입 + 권한 파일 (§8)
 *   3. 바깥 벽 — 세션 타임아웃 (AMENDMENTS A2)
 *   4. 외부 보고 수확 — build-result.json 파싱·검증 (A6)
 *   5. 실패 시 정직한 결론 — 보고가 없거나 깨지면 BLOCKED (성공이 아니다)
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  checkBuildResult,
  checkHandoff,
  formatViolations,
  parseTasks,
  type BuildResult,
  type ParsedTask,
} from "./contract";
import { contractPaths } from "./paths";

const HARNESS_ROOT = new URL("..", import.meta.url).pathname;

export interface BuilderOptions {
  repoRoot: string;
  branch: string;
  /** 세션 타임아웃. 무한 루프의 최종 방어선 (기본 4시간) */
  timeoutMs?: number;
  /** SDD 컨트롤러 세션의 모델. 서브에이전트 모델은 SDD가 정한다 */
  model?: string;
  /** 실제로 claude를 띄우지 않고 계약 검증까지만 (CI·개발용) */
  dryRun?: boolean;
}

export interface BuilderOutcome {
  outcome: "SUCCESS" | "REJECTED" | "BLOCKED";
  /** 계약 검증 단계에서 거부된 경우 */
  contractViolations?: string;
  result?: BuildResult;
  tasks?: ParsedTask[];
  /** 컨트롤러가 판단한 사유 (BLOCKED일 때) */
  reason?: string;
  exitCode?: number;
  durationMs: number;
}

/** builder 세션에 넘길 지시. 오버레이가 규칙을, 이 프롬프트가 작업을 준다. */
function buildPrompt(planPath: string, discoveriesPath: string, resultPath: string): string {
  return [
    "승인된 플랜을 실행해 PR까지 완주하라.",
    "",
    `플랜 파일: ${planPath}`,
    "",
    "superpowers:subagent-driven-development 스킬을 사용하라. 이 플랜 파일을 그 스킬의",
    "PLAN_FILE 인자로 넘긴다 (scripts/sdd-workspace, scripts/task-brief, scripts/review-package).",
    "",
    "지켜야 할 것:",
    `- 서브에이전트 보고의 discoveries·concerns를 ${discoveriesPath} 에 누적하라.`,
    "  SDD 워크스페이스는 최종 리뷰 후 삭제되므로 거기 두면 사라진다.",
    "- 사람에게 질문하지 마라. SDD가 'ask your human partner'를 지시하는 두 지점",
    "  (Setup의 플랜 사전 스캔, fix loop의 플랜 충돌)은 REJECTED 반송이다.",
    "- 모든 서브에이전트 디스패치에 model을 명시하라.",
    "- PR을 만들되 머지하지 마라. discard 경로를 쓰지 마라.",
    "",
    `마지막 행동은 ${resultPath} 에 결과 JSON을 쓰는 것이다. 그 파일이 유일한 외부 보고다.`,
    "어떤 결말이든(성공·반송·차단) 반드시 쓴다.",
  ].join("\n");
}

/** 컨트롤러가 직접 결론을 써야 하는 경우 (세션이 보고를 남기지 못했을 때) */
async function writeFallbackResult(
  path: string,
  branch: string,
  reason: string,
): Promise<void> {
  const fallback: BuildResult = {
    schema: 1,
    branch,
    outcome: "BLOCKED",
    finished_at: new Date().toISOString(),
    blocked: { task_id: "?", reason, attempts: [] },
  };
  await writeFile(path, JSON.stringify(fallback, null, 2), "utf8");
}

export async function runBuilder(opts: BuilderOptions): Promise<BuilderOutcome> {
  const started = Date.now();
  const p = contractPaths(opts.repoRoot, opts.branch);
  const timeoutMs = opts.timeoutMs ?? 4 * 60 * 60 * 1000;
  const done = (o: Omit<BuilderOutcome, "durationMs">): BuilderOutcome => ({
    ...o,
    durationMs: Date.now() - started,
  });

  // ── 1. 계약 검증 (명세 §4.3) — 실패 시 빌드를 시작하지 않는다 ──────
  let designDoc = "";
  let planText = "";
  try {
    designDoc = await readFile(p.designDoc, "utf8");
  } catch {
    /* 아래 checkHandoff가 빈 문자열을 error로 처리한다 */
  }
  try {
    planText = await readFile(p.plan, "utf8");
  } catch {
    /* 동일 */
  }

  const contract = checkHandoff(designDoc, planText);
  const tasks = planText ? parseTasks(planText) : [];
  if (!contract.ok) {
    return done({
      outcome: "REJECTED",
      contractViolations: formatViolations(contract.violations),
      tasks,
      reason: "핸드오프 계약 검증 실패 — 빌드를 시작하지 않았습니다",
    });
  }

  if (opts.dryRun) {
    return done({ outcome: "SUCCESS", tasks, reason: "dry-run — 계약 검증만 수행" });
  }

  // ── 2. headless 세션 기동 ────────────────────────────────────
  await mkdir(p.planDir, { recursive: true });
  await mkdir(p.screenshotDir, { recursive: true });

  const overlay = await readFile(join(HARNESS_ROOT, "overlay", "CLAUDE.builder.md"), "utf8");
  const settings = join(HARNESS_ROOT, "config", "builder.settings.json");
  const prompt = buildPrompt(p.plan, p.discoveries, p.buildResult);

  const args = [
    "--print",
    "--output-format",
    "json",
    "--permission-mode",
    "acceptEdits",
    "--settings",
    settings,
    "--append-system-prompt",
    overlay,
    "--add-dir",
    p.repoRoot,
  ];
  if (opts.model) args.push("--model", opts.model);
  args.push(prompt);

  const proc = Bun.spawn(["claude", ...args], {
    cwd: p.repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });

  // ── 3. 바깥 벽 — 타임아웃 (AMENDMENTS A2) ────────────────────
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  const exitCode = await proc.exited;
  clearTimeout(timer);

  // ── 4. 외부 보고 수확 (A6) ───────────────────────────────────
  let raw: string | null = null;
  try {
    raw = await readFile(p.buildResult, "utf8");
  } catch {
    raw = null;
  }

  if (timedOut) {
    const reason = `세션 타임아웃 (${Math.round(timeoutMs / 60000)}분) — 무한 루프 방어선이 작동했습니다`;
    if (!raw) await writeFallbackResult(p.buildResult, opts.branch, reason);
    return done({ outcome: "BLOCKED", reason, exitCode, tasks });
  }

  if (raw === null) {
    const reason = `세션이 ${p.buildResult} 를 남기지 않았습니다 (exit=${exitCode}) — 외부 보고 계약 위반`;
    await writeFallbackResult(p.buildResult, opts.branch, reason);
    return done({ outcome: "BLOCKED", reason, exitCode, tasks });
  }

  const parsed = checkBuildResult(raw);
  if (!parsed.ok || !parsed.result) {
    // **성공으로 처리하지 않는다.** 미완성 태스크가 조용히 PR에 들어가는 것이 최악 실패다.
    const reason = `build-result.json 검증 실패 — BLOCKED로 처리합니다:\n${formatViolations(parsed.violations)}`;
    return done({ outcome: "BLOCKED", reason, exitCode, tasks });
  }

  // 보고된 브랜치가 우리가 승인한 브랜치인지 — 세션이 다른 브랜치를 빌드했으면 신뢰할 수 없다
  if (parsed.result.branch !== opts.branch) {
    return done({
      outcome: "BLOCKED",
      reason: `보고된 브랜치(${parsed.result.branch})가 승인된 브랜치(${opts.branch})와 다릅니다`,
      exitCode,
      tasks,
    });
  }

  return done({ outcome: parsed.result.outcome, result: parsed.result, tasks, exitCode });
}

if (import.meta.main) {
  const branch = process.argv[2];
  if (!branch) {
    console.error("usage: bun controller/builder.ts <branch> [--dry-run]");
    process.exit(2);
  }
  const outcome = await runBuilder({
    repoRoot: process.env.TARGET_REPO ?? process.cwd(),
    branch,
    dryRun: process.argv.includes("--dry-run"),
    timeoutMs: process.env.BUILDER_TIMEOUT_MS ? Number(process.env.BUILDER_TIMEOUT_MS) : undefined,
    model: process.env.BUILDER_MODEL,
  });

  const { formatContractRejection, formatPacket } = await import("./report");
  if (outcome.contractViolations) {
    console.log(formatContractRejection(branch, outcome.contractViolations));
  } else if (outcome.result) {
    console.log(
      formatPacket({
        result: outcome.result,
        previewUrl: process.env.PREVIEW_URL ?? null,
        tasks: outcome.tasks,
      }),
    );
  } else if (outcome.outcome === "SUCCESS") {
    // dry-run — 계약 검증만 통과한 상태. 빌드 결과가 아니므로 패킷을 만들지 않는다.
    const dist = (outcome.tasks ?? []).reduce<Record<string, number>>((acc, t) => {
      const key = `${t.verification ?? "?"}/${t.validation ?? "?"}`;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`✓ 계약 검증 통과 — ${branch}`);
    console.log(`  태스크 ${outcome.tasks?.length ?? 0}개 · ${JSON.stringify(dist)}`);
    console.log(`  ${outcome.reason ?? ""}`.trimEnd());
  } else {
    console.log(`⛔ BLOCKED — ${branch}\n${outcome.reason ?? "(사유 미보고)"}`);
  }
  console.error(`\n[builder] outcome=${outcome.outcome} ${Math.round(outcome.durationMs / 1000)}s`);
  process.exit(outcome.outcome === "SUCCESS" ? 0 : 1);
}
