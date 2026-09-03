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

import { readFile, writeFile, mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  checkBuildResult,
  checkHandoff,
  formatViolations,
  parseTasks,
  type BuildResult,
  type ParsedTask,
  type Violation,
} from "./contract";
import { contractPaths } from "./paths";
// 정적 import 다. 순환 참조가 없고(preflight.ts 는 contract.ts 만 본다) 이 레포의
// 다른 모든 모듈이 최상단에서 import 한다 — 함수 안의 동적 import 는 게이트가
// "특별한 곁가지"처럼 보이게 만들 뿐 얻는 것이 없었다.
import { checkPreflightGate, planSha256 } from "./preflight";

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

/**
 * 세션이 계약 문서를 고쳤는지 판정한다 — **하드룰 #2 의 유일한 실제 강제**.
 *
 * `config/builder.settings.json` 의 `Edit/Write(docs/plans/**\/plan.md)` deny 는
 * 심층 방어 한 겹일 뿐이다. 세션에 코드 실행이 허용되는 한 경로 기반 deny 는
 * **원리적으로** 우회된다 — 2026-09-03 6회전에서 서브에이전트가 `.claude/**` Write
 * 거부를 `bun -e` + `fs.writeFileSync` 로 우회했다. `bun -e` 를 좁혀도 `bun test` 가
 * 실행하는 테스트 파일이 아무 경로에나 쓸 수 있으므로 좁히기로는 닫히지 않는다.
 *
 * 그래서 강제를 세션 **밖**에 둔다. spawn 전 해시와 종료 후 해시를 비교하면 세션이
 * 무엇을 실행했는지와 무관하게 변조가 드러난다. 이것이 "봇은 플랜을 현장에서 고치지
 * 않는다"를 설득이 아니라 관찰로 만드는 유일한 층이다.
 *
 * 변조는 `REJECTED` 가 아니라 `BLOCKED` 다 — 플랜의 결함이 아니라 하네스 계약 위반이고,
 * 사람이 봐야 할 것은 "플랜을 고치라"가 아니라 "이 회전의 결과를 믿지 마라"다.
 */
/**
 * SDD 작업 폴더의 소유자를 ledger 첫 줄에서 읽는다 (AMENDMENTS B6).
 *
 * 업스트림 `scripts/sdd-workspace` 는 폴더 이름을 **플랜 파일의 basename** 으로
 * 만든다. 그런데 명세 §4.1(B2) 이 모든 플랜을 `docs/plans/<slug>/plan.md` 로
 * 고정하므로 **이 레포의 모든 기능이 `.superpowers/sdd/plan/` 한 곳을 공유한다.**
 *
 * ledger 첫 줄이 소유자를 적는다 (실측):
 *   `# SDD ledger — plan: /abs/path/docs/plans/feature-a/plan.md`
 *
 * 업스트림의 유일한 방어선은 스킬이 이 줄을 보고 "다른 플랜이면 새로 시작하라"고
 * 지시하는 것이다. 그것은 ledger 파일 하나만 보호한다 — `task-N-brief.md`·
 * `task-N-report.md`·리뷰 패키지는 전부 `task-N-*` 로 명명되므로 **두 번째 기능의
 * Task 1 이 첫 기능의 `task-1-brief.md` 를 읽을 수 있다.**
 */
export function sddWorkspaceOwner(ledgerHead: string): string | null {
  const m = /^#\s*SDD ledger\s*[—-]\s*plan:\s*(\S+)/m.exec(ledgerHead);
  return m ? m[1]! : null;
}

/**
 * 작업 폴더를 그대로 둘지, 격리할지 판정한다 (B6).
 *
 * 격리(`archive`)를 고른 이유 — AMENDMENTS B6 은 "경고하거나 슬러그별로 격리"를
 * 채택으로 적었다. **경고만으로는 부족하다:** headless 세션에는 경고를 읽고
 * 멈출 사람이 없고, 스킬은 ledger 만 보므로 브리프·리포트는 그대로 남는다.
 * 지우지 않고 옮기는 이유는 ledger 가 리뷰 결함·판정 근거의 유일한 기록이라서다
 * (6회전 concern #8 — 봇이 스스로 남긴 판단).
 *
 * 소유자를 읽지 못하면(`null`) 격리한다. 형식이 바뀌었거나 손상된 것이고,
 * 어느 쪽이든 **누구 것인지 모르는 폴더를 재사용하는 것이 더 위험하다.**
 */
export function sddWorkspaceAction(
  owner: string | null,
  currentPlanPath: string,
  exists: boolean,
): "none" | "keep" | "archive" {
  if (!exists) return "none";
  if (owner === null) return "archive";
  return owner === currentPlanPath ? "keep" : "archive";
}

/**
 * 다른 플랜의 SDD 작업 폴더를 격리한다 (B6). 격리했으면 옮긴 경로를 낸다.
 *
 * 지우지 않고 **옮긴다.** ledger 가 리뷰 결함·판정 근거·park 된 항목의 유일한
 * 기록이다 (6회전 concern #8). 사람이 게이트 ② 를 통과시킨 뒤 지우면 된다.
 */
export async function isolateSddWorkspace(
  repoRoot: string,
  planPath: string,
  slug: string,
  now: Date = new Date(),
): Promise<string | null> {
  const sddDir = join(repoRoot, ".superpowers", "sdd", "plan");
  let ledgerHead = "";
  let exists = true;
  try {
    ledgerHead = (await readFile(join(sddDir, "progress.md"), "utf8")).slice(0, 400);
  } catch {
    // ledger 가 없어도 폴더는 있을 수 있다 (브리프만 남은 중단 흔적).
    try {
      await stat(sddDir);
    } catch {
      exists = false;
    }
  }
  if (sddWorkspaceAction(sddWorkspaceOwner(ledgerHead), planPath, exists) !== "archive") {
    return null;
  }
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const archiveRoot = join(repoRoot, ".superpowers", "sdd", "archive");
  const dest = join(archiveRoot, `${slug}-${stamp}`);
  await mkdir(archiveRoot, { recursive: true });
  await rename(sddDir, dest);
  return dest;
}

export function checkDocIntegrity(
  before: { plan: string; designDoc: string },
  after: { plan: string; designDoc: string },
): Violation[] {
  const out: Violation[] = [];
  const pairs = [
    { file: "plan.md" as const, key: "plan" as const },
    { file: "design-doc.md" as const, key: "designDoc" as const },
  ];
  for (const { file, key } of pairs) {
    if (planSha256(before[key]) === planSha256(after[key])) continue;
    out.push({
      severity: "error",
      file,
      rule: "하드룰 #2",
      message:
        `세션이 ${file} 을 변조했습니다 — 봇은 플랜을 현장에서 고치지 않습니다. ` +
        `이 회전의 결과를 신뢰할 수 없습니다 (git diff 로 확인하고 되돌리십시오)`,
    });
  }
  return out;
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

  // ── 1-B. 사전 검사 게이트 (설계 D26) ────────────────────────────
  // 계약(형식)이 통과해도 사전 검사를 통과하지 않은 플랜은 빌드하지 않는다.
  // 해시는 preflight-cli.ts 의 `--record` 가 쓴 값과 **같은 함수**로 계산해야 한다.
  // 게이트 전체가 이 비교 하나이므로 두 곳이 각자 계산하면 드리프트가 곧 무력화다 (M11).
  const planSha = planSha256(planText);
  let preflightRawText: string | null = null;
  try {
    preflightRawText = await readFile(p.preflight, "utf8");
  } catch {
    preflightRawText = null;
  }
  const gate = checkPreflightGate(preflightRawText, planSha);
  if (!gate.ok) {
    return done({
      outcome: gate.outcome,
      contractViolations: formatViolations(gate.violations),
      tasks,
      reason: "사전 검사 게이트 미통과 — 빌드를 시작하지 않았습니다",
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

  // ── 3-A. SDD 작업 폴더 격리 (AMENDMENTS B6) ────────────────────
  // 세션 기동 **전**에 한다. 스킬이 폴더를 만든 뒤에는 손댈 수 없다.
  const archived = await isolateSddWorkspace(p.repoRoot, p.plan, p.slug);
  if (archived) {
    console.log(`[builder] 다른 플랜의 SDD 작업 폴더를 격리했습니다 → ${archived} (B6)`);
  }

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

  // ── 3-B. 계약 문서 무결성 (하드룰 #2 의 실제 강제) ──────────────
  // 보고를 수확하기 **전**에 본다. 변조된 회전의 보고는 읽지 않는다 —
  // 세션이 플랜을 자기 구현에 맞게 고친 뒤 SUCCESS 를 보고할 수 있다.
  let planAfter = "";
  let designAfter = "";
  try {
    planAfter = await readFile(p.plan, "utf8");
  } catch {
    /* 삭제도 변조다 — 빈 문자열이 해시 불일치를 낸다 */
  }
  try {
    designAfter = await readFile(p.designDoc, "utf8");
  } catch {
    /* 동일 */
  }
  const tamper = checkDocIntegrity(
    { plan: planText, designDoc: designDoc },
    { plan: planAfter, designDoc: designAfter },
  );
  if (tamper.length > 0) {
    const reason =
      "계약 문서 무결성 검사 실패 — 세션이 플랜/설계 문서를 변조했습니다" + diag();
    await writeFallbackResult(p.buildResult, opts.branch, reason);
    return done({
      outcome: "BLOCKED",
      contractViolations: formatViolations(tamper),
      reason,
      exitCode,
      tasks,
    });
  }

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

  const { formatContractBlocked, formatContractRejection, formatPacket } = await import("./report");
  // **outcome 을 먼저 본다.** `contractViolations` 는 REJECTED 와 BLOCKED 양쪽에서
  // 채워진다 (게이트 미통과 시 위반 목록이 사유다). 그것을 먼저 분기하면 BLOCKED 가
  // "↩️ REJECTED" 로 출력돼, 이 브랜치가 지키려는 구분이 사람이 읽는 유일한 자리에서
  // 무너진다 — 판정 불가를 "문서를 고쳐라"로 읽게 만든다.
  if (outcome.outcome === "BLOCKED" && outcome.contractViolations) {
    console.log(formatContractBlocked(branch, outcome.contractViolations));
  } else if (outcome.contractViolations) {
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
