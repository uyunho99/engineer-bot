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

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
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

/**
 * `claude` 에 넘길 argv 를 만든다.
 *
 * **`--` 구분자가 없으면 프롬프트가 사라진다.** `--add-dir` 는 가변 인자
 * (`--add-dir <directories...>`)여서 뒤따르는 프롬프트를 디렉터리로 삼킨다.
 * 그러면 claude 가 `Input must be provided either through stdin or as a prompt
 * argument when using --print` 로 즉시 exit 1 한다.
 *
 * 2026-09-03 첫 실제 실행에서 이 버그로 빌드가 2초 만에 BLOCKED 됐다.
 * 단위 테스트 107개가 잡지 못한 이유는 테스트가 `claude` 를 띄우지 않았기 때문이다
 * (BUILD-PLAN Phase 0-B 가 찾으려던 바로 그 종류의 결함).
 *
 * 순수 함수로 뽑아 둔 이유가 이것이다 — argv 구성은 테스트할 수 있어야 한다.
 */
export function buildClaudeArgs(opts: {
  settingsPath: string;
  overlay: string;
  repoRoot: string;
  prompt: string;
  model?: string;
  /**
   * superpowers 플러그인 설치 경로. SDD 스킬이 `scripts/sdd-workspace`·`task-brief`·
   * `review-package` 를 **절대 경로로 실행**하므로 세션이 그 디렉터리에 닿아야 한다.
   * 없으면 SDD 가 워크스페이스 스크립트를 못 돌리고 Write 툴로 우회한다 (2026-09-03 실측).
   */
  superpowersDir?: string;
}): string[] {
  const args = [
    "--print",
    "--output-format",
    "json",
    "--permission-mode",
    "acceptEdits",
    "--settings",
    opts.settingsPath,
    "--append-system-prompt",
    opts.overlay,
    "--add-dir",
    opts.repoRoot,
  ];
  if (opts.superpowersDir) args.push("--add-dir", opts.superpowersDir);
  if (opts.model) args.push("--model", opts.model);
  // 프롬프트 앞의 `--` 는 필수다. 위 주석 참조.
  args.push("--", opts.prompt);
  return args;
}

/**
 * superpowers 플러그인 설치 경로를 런타임에 해석한다.
 *
 * 버전이 경로에 들어가므로(`.../superpowers/6.2.0`) 하드코딩할 수 없다.
 * `bootstrap.sh` 가 쓰는 것과 같은 출처를 읽는다.
 */
export function resolveSuperpowersDir(installedPlugins: unknown): string | null {
  const p = installedPlugins as {
    plugins?: Record<string, Array<{ installPath?: string }>>;
  };
  return p?.plugins?.["superpowers@superpowers-marketplace"]?.[0]?.installPath ?? null;
}

/**
 * 세션에 넘길 설정을 만든다 — 이식 가능한 기본 설정에 **호스트별 경로**를 얹는다.
 *
 * `config/builder.settings.json` 은 이식 가능해야 하므로 절대 경로를 담을 수 없다.
 * 그런데 SDD 스크립트는 절대 경로로 실행되므로 `allow` 항목이 필요하다.
 * 그래서 기동 시점에 병합한다 — 파일은 이식 가능하게 남고, 경로는 런타임에 붙는다.
 */
export function mergeSettings(
  base: unknown,
  superpowersDir: string | null,
): Record<string, unknown> {
  const b = structuredClone(base) as Record<string, any>;
  if (!superpowersDir) return b;
  b.permissions ??= {};
  b.permissions.allow ??= [];
  const scripts = "skills/subagent-driven-development/scripts";
  for (const name of ["sdd-workspace", "task-brief", "review-package"]) {
    const rule = `Bash(${superpowersDir}/${scripts}/${name}:*)`;
    if (!b.permissions.allow.includes(rule)) b.permissions.allow.push(rule);
  }
  return b;
}

/**
 * 보고 파일이 **이번 실행이 쓴 것인지** 판정한다.
 *
 * 2026-09-03 6회전에서 세션이 63분 돌고 `build-result.json` 을 남기지 못했다.
 * 그런데 `builder.ts` 는 "파일이 있는가"만 보고 이전 회전(17:36)의 `REJECTED` 를
 * **이번 회전 결과로 자신 있게 출력했다.** `BLOCKED` 이어야 했다.
 *
 * A6 은 "파싱 실패를 조용히 성공으로 처리하지 않는다"를 규정했지만, **낡은 성공을
 * 새 성공으로 처리하는** 구멍이 남아 있었다. 보고의 신선도도 계약의 일부다.
 */
export function isStaleReport(mtimeMs: number, spawnedAtMs: number): boolean {
  return mtimeMs < spawnedAtMs;
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
  const prompt = buildPrompt(p.plan, p.discoveries, p.buildResult);

  // 호스트별 경로를 기동 시점에 병합한다 (mergeSettings 주석 참조).
  const baseSettings = JSON.parse(
    await readFile(join(HARNESS_ROOT, "config", "builder.settings.json"), "utf8"),
  );
  let superpowersDir: string | null = null;
  try {
    const installed = JSON.parse(
      await readFile(join(process.env.HOME ?? "", ".claude", "plugins", "installed_plugins.json"), "utf8"),
    );
    superpowersDir = resolveSuperpowersDir(installed);
  } catch {
    superpowersDir = null;
  }
  const settings = join(p.planDir, ".builder-settings.json");
  await writeFile(settings, JSON.stringify(mergeSettings(baseSettings, superpowersDir), null, 2), "utf8");

  const args = buildClaudeArgs({
    settingsPath: settings,
    overlay,
    repoRoot: p.repoRoot,
    prompt,
    model: opts.model,
    superpowersDir: superpowersDir ?? undefined,
  });

  // 보고 신선도 판정의 기준선 — spawn 직전 시각을 잡는다 (isStaleReport 참조)
  const spawnedAtMs = Date.now();

  const proc = Bun.spawn(["claude", ...args], {
    cwd: p.repoRoot,
    // stdin 을 닫는다. 열어두면 claude 가 파이프 입력을 3초 기다린다
    // ("no stdin data received in 3s") — 2026-09-03 실측.
    stdin: "ignore",
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

  // 스트림을 종료 대기와 **동시에** 읽는다. 파이프로 열어두고 읽지 않으면
  // 세션의 오류 메시지가 버려져 실패를 진단할 수 없다 — 2026-09-03 첫 실행에서
  // 원인 파악에 수동 재현이 필요했던 이유가 이것이다.
  const stdoutP = new Response(proc.stdout).text();
  const stderrP = new Response(proc.stderr).text();

  const exitCode = await proc.exited;
  clearTimeout(timer);

  const sessionStderr = (await stderrP).trim();
  const sessionStdout = (await stdoutP).trim();
  /** 진단용 꼬리 — BLOCKED 사유에 붙인다 */
  const diag = () => {
    const parts: string[] = [];
    if (sessionStderr) parts.push(`stderr:\n${sessionStderr.slice(-2000)}`);
    else if (sessionStdout) parts.push(`stdout:\n${sessionStdout.slice(-2000)}`);
    return parts.length ? `\n\n--- 세션 출력 ---\n${parts.join("\n\n")}` : "";
  };

  // ── 4. 외부 보고 수확 (A6) ───────────────────────────────────
  let raw: string | null = null;
  let staleReport = false;
  try {
    const st = await stat(p.buildResult);
    if (isStaleReport(st.mtimeMs, spawnedAtMs)) {
      // 이전 회전의 보고다. 읽지 않는다 — 낡은 결론을 이번 결론으로 내면
      // 사람이 게이트 ②에서 그것을 이번 빌드의 결과로 읽는다.
      staleReport = true;
    } else {
      raw = await readFile(p.buildResult, "utf8");
    }
  } catch {
    raw = null;
  }

  if (staleReport) {
    const reason =
      `세션이 이번 실행에서 ${p.buildResult} 를 갱신하지 않았습니다 (exit=${exitCode}) — ` +
      `남아 있는 파일은 이전 회전의 보고이므로 읽지 않습니다. 외부 보고 계약 위반` +
      diag();
    await writeFallbackResult(p.buildResult, opts.branch, reason);
    return done({ outcome: "BLOCKED", reason, exitCode, tasks });
  }

  if (timedOut) {
    const reason = `세션 타임아웃 (${Math.round(timeoutMs / 60000)}분) — 무한 루프 방어선이 작동했습니다`;
    if (!raw) await writeFallbackResult(p.buildResult, opts.branch, reason);
    return done({ outcome: "BLOCKED", reason, exitCode, tasks });
  }

  if (raw === null) {
    const reason =
      `세션이 ${p.buildResult} 를 남기지 않았습니다 (exit=${exitCode}) — 외부 보고 계약 위반` +
      diag();
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
