import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import {
  buildClaudeArgs,
  checkDocIntegrity,
  isolateSddWorkspace,
  isStaleReport,
  mergeSettings,
  resolveSuperpowersDir,
  runBuilder,
  sddWorkspaceAction,
  sddWorkspaceOwner,
} from "./builder";
import { checkDesignDoc, checkPlan } from "./contract";
import { contractPaths } from "./paths";

/**
 * argv 구성 회귀 테스트.
 *
 * 2026-09-03 첫 실제 실행에서 `bin/builder` 가 2초 만에 BLOCKED 됐다. 원인은
 * `--add-dir` 가 가변 인자(`--add-dir <directories...>`)여서 뒤따르는 프롬프트를
 * 디렉터리로 삼킨 것이었다. claude 는 `Input must be provided either through stdin
 * or as a prompt argument when using --print` 로 즉시 종료했다.
 *
 * 실측 증명:
 *   claude --print --add-dir <dir> "1+1은?"      → Error (프롬프트 유실)
 *   claude --print --add-dir <dir> -- "1+1은?"   → {"result":"2입니다."}
 *
 * 단위 테스트 107개가 이것을 잡지 못한 이유는 **테스트가 claude 를 띄우지 않았기
 * 때문**이다. argv 구성을 순수 함수로 뽑아 그 층을 테스트 가능하게 만든다.
 */

const base = {
  settingsPath: "/harness/config/builder.settings.json",
  overlay: "# 오버레이 본문",
  repoRoot: "/repo",
  prompt: "승인된 플랜을 실행하라",
};

describe("buildClaudeArgs — 프롬프트 유실 방어", () => {
  test("프롬프트 바로 앞에 `--` 가 있다", () => {
    const args = buildClaudeArgs(base);
    const i = args.indexOf(base.prompt);
    expect(i).toBeGreaterThan(0);
    expect(args[i - 1]).toBe("--");
  });

  test("프롬프트가 마지막 인자다", () => {
    const args = buildClaudeArgs(base);
    expect(args[args.length - 1]).toBe(base.prompt);
  });

  test("`--add-dir` 값 바로 뒤에 프롬프트가 오지 않는다", () => {
    const args = buildClaudeArgs(base);
    const d = args.indexOf("--add-dir");
    expect(d).toBeGreaterThan(-1);
    // --add-dir <dir> 다음은 반드시 플래그이거나 `--` 여야 한다.
    const after = args[d + 2];
    expect(after === "--" || after.startsWith("--")).toBe(true);
  });

  test("`--` 가 정확히 한 번만 나온다", () => {
    const args = buildClaudeArgs(base);
    expect(args.filter((a) => a === "--")).toHaveLength(1);
  });

  test("대시로 시작하는 프롬프트도 플래그로 해석되지 않는다", () => {
    // `--` 이후는 전부 위치 인자다. 이것이 `--` 를 쓰는 두 번째 이유다.
    const args = buildClaudeArgs({ ...base, prompt: "--help 를 설명하라" });
    expect(args[args.length - 1]).toBe("--help 를 설명하라");
    expect(args[args.length - 2]).toBe("--");
  });
});

describe("buildClaudeArgs — 필수 플래그", () => {
  test("--print · --output-format json 이 있다 (A6 외부 계약의 전제)", () => {
    const args = buildClaudeArgs(base);
    expect(args).toContain("--print");
    const i = args.indexOf("--output-format");
    expect(args[i + 1]).toBe("json");
  });

  test("--settings 가 권한 파일을 가리킨다 (명세 §8)", () => {
    const args = buildClaudeArgs(base);
    expect(args[args.indexOf("--settings") + 1]).toBe(base.settingsPath);
  });

  test("--append-system-prompt 로 오버레이 전문이 주입된다 (명세 P4)", () => {
    const args = buildClaudeArgs(base);
    expect(args[args.indexOf("--append-system-prompt") + 1]).toBe(base.overlay);
  });

  test("--permission-mode 가 acceptEdits 다", () => {
    const args = buildClaudeArgs(base);
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
  });
});

describe("buildClaudeArgs — 모델", () => {
  test("model 을 주면 --model 이 들어간다", () => {
    const args = buildClaudeArgs({ ...base, model: "opus" });
    expect(args[args.indexOf("--model") + 1]).toBe("opus");
  });

  test("model 을 안 주면 --model 이 없다 — 세션 기본값을 쓴다", () => {
    expect(buildClaudeArgs(base)).not.toContain("--model");
  });

  test("--model 을 줘도 프롬프트는 여전히 마지막이고 `--` 가 앞에 있다", () => {
    const args = buildClaudeArgs({ ...base, model: "opus" });
    expect(args[args.length - 1]).toBe(base.prompt);
    expect(args[args.length - 2]).toBe("--");
  });
});

describe("resolveSuperpowersDir", () => {
  test("installed_plugins.json 에서 installPath 를 뽑는다", () => {
    const fixture = {
      plugins: {
        "superpowers@superpowers-marketplace": [
          { installPath: "/cache/superpowers/6.2.0", version: "6.2.0" },
        ],
      },
    };
    expect(resolveSuperpowersDir(fixture)).toBe("/cache/superpowers/6.2.0");
  });

  test("항목이 없으면 null — 던지지 않는다", () => {
    expect(resolveSuperpowersDir({ plugins: {} })).toBeNull();
    expect(resolveSuperpowersDir({})).toBeNull();
    expect(resolveSuperpowersDir(null)).toBeNull();
  });
});

describe("mergeSettings — 호스트별 경로 주입", () => {
  const base = { permissions: { allow: ["Bash(bun:*)"], deny: ["Bash(rm -rf:*)"] } };

  test("SDD 스크립트 3개의 allow 규칙이 추가된다", () => {
    const m = mergeSettings(base, "/cache/sp") as any;
    const allow: string[] = m.permissions.allow;
    for (const n of ["sdd-workspace", "task-brief", "review-package"]) {
      expect(allow.some((r) => r.includes(`/scripts/${n}:*`))).toBe(true);
    }
  });

  test("기존 allow·deny 를 지우지 않는다", () => {
    const m = mergeSettings(base, "/cache/sp") as any;
    expect(m.permissions.allow).toContain("Bash(bun:*)");
    expect(m.permissions.deny).toEqual(["Bash(rm -rf:*)"]);
  });

  test("원본을 변형하지 않는다 (순수)", () => {
    const before = JSON.stringify(base);
    mergeSettings(base, "/cache/sp");
    expect(JSON.stringify(base)).toBe(before);
  });

  test("경로가 null 이면 그대로 돌려준다", () => {
    expect(mergeSettings(base, null)).toEqual(base);
  });

  test("두 번 병합해도 규칙이 중복되지 않는다 (멱등)", () => {
    const once = mergeSettings(base, "/cache/sp");
    const twice = mergeSettings(once, "/cache/sp") as any;
    const rules = twice.permissions.allow.filter((r: string) => r.includes("task-brief"));
    expect(rules).toHaveLength(1);
  });

  test("permissions 가 아예 없는 설정에도 붙는다", () => {
    const m = mergeSettings({}, "/cache/sp") as any;
    expect(m.permissions.allow.length).toBe(3);
  });
});

describe("buildClaudeArgs — superpowersDir", () => {
  test("주면 --add-dir 가 두 번 들어간다 (레포 + 플러그인)", () => {
    const args = buildClaudeArgs({ ...base, superpowersDir: "/cache/sp" });
    expect(args.filter((a) => a === "--add-dir")).toHaveLength(2);
    expect(args).toContain("/cache/sp");
  });

  test("안 주면 --add-dir 는 한 번뿐이다", () => {
    expect(buildClaudeArgs(base).filter((a) => a === "--add-dir")).toHaveLength(1);
  });

  test("superpowersDir 를 줘도 프롬프트는 마지막이고 `--` 가 앞에 있다", () => {
    const args = buildClaudeArgs({ ...base, superpowersDir: "/cache/sp", model: "opus" });
    expect(args[args.length - 1]).toBe(base.prompt);
    expect(args[args.length - 2]).toBe("--");
  });
});

describe("isStaleReport — 낡은 보고를 이번 결론으로 쓰지 않는다", () => {
  test("spawn 이전에 쓰인 파일은 낡았다", () => {
    expect(isStaleReport(1_000, 2_000)).toBe(true);
  });

  test("spawn 이후에 쓰인 파일은 신선하다", () => {
    expect(isStaleReport(3_000, 2_000)).toBe(false);
  });

  test("정확히 같은 시각이면 신선한 쪽으로 본다 — 경계에서 세션을 벌하지 않는다", () => {
    expect(isStaleReport(2_000, 2_000)).toBe(false);
  });

  test("2026-09-03 6회전 실측 재현: 17:36 파일 · 17:45 spawn → 낡음", () => {
    const written = new Date("2026-09-03T17:36:25+09:00").getTime();
    const spawned = new Date("2026-09-03T17:45:00+09:00").getTime();
    expect(isStaleReport(written, spawned)).toBe(true);
  });
});

// ─── 사전 검사 게이트 — **runBuilder 를 실제로 부른다** (설계 D26) ─────────
//
// 이 브랜치의 최종 리뷰가 지적한 결함: 기존 게이트 테스트 두 개는
// `checkPreflightGate` 를 직접 부르고 그 반환값을 단언했다. `runBuilder` 를
// import 조차 하지 않았으므로 **builder.ts 의 게이트 블록을 통째로 지워도
// 243개가 전부 통과했다.** 그 테스트의 변명("spawn 을 관찰할 수 없다")은
// 이미 낡았다 — 게이트는 `dryRun` 조기 반환보다 **앞**에 있으므로
// `runBuilder({ dryRun: true })` 는 진짜 게이트를 통과시키면서 Bun.spawn 에
// 닿지 않는다. 그래서 여기서는 프로세스를 띄우지 않고도 게이트를 실행한다.

const FIXTURE_BRANCH = "feature/gate-fixture";

const FIXTURE_DESIGN = [
  "# 게이트 픽스처",
  "",
  "## 문제 정의",
  "게이트가 실제로 실행되는지 관찰할 픽스처가 없었다.",
  "",
  "## 전제",
  "- 이 문서는 테스트 픽스처다 — 제품 기능이 아니다",
  "",
  "## 스코프 / 비스코프",
  "- 스코프: runBuilder 게이트 분기",
  "- 비스코프: 세션 기동, 보고 수확",
  "",
  "## 제약",
  "- 임시 디렉터리 밖을 건드리지 않는다",
  "",
  "## 수용 기준",
  "- 게이트 미통과 시 세션이 기동되지 않는다",
  "",
  "## 아키텍처 결정",
  "- dryRun 을 게이트 뒤에 둬서 게이트만 실행 가능하게 한다",
].join("\n");

// **이 브랜치가 추가한 계약 요건을 전부 만족해야 한다** — Tags · Files(Create) ·
// Interfaces(Consumes/Produces) · 테스트로 증명할 것 · Global Constraints ·
// 번호 연속. 아래 첫 테스트가 그것을 checkPlan 으로 증명한다 (픽스처가 틀리면
// 게이트 테스트가 엉뚱한 이유로 실패한다).
const FIXTURE_PLAN = [
  "# 게이트 픽스처 Implementation Plan",
  "",
  "**Goal:** runBuilder 의 사전 검사 게이트를 실행으로 관찰한다",
  "",
  "## Global Constraints",
  "",
  "- 이 플랜은 테스트 픽스처다 — 빌드되지 않는다",
  "",
  "---",
  "",
  "### Task 1: 저장",
  "",
  "**Tags:** verification=deterministic validation=invisible",
  "",
  "**Files:**",
  "- Create: `src/store.ts`",
  "",
  "**Interfaces:**",
  "- Produces: `save(v: string): void`",
  "",
  "**테스트로 증명할 것:**",
  "- [ ] 저장한 값을 다시 읽으면 같다",
  "",
  "### Task 2: 표시",
  "",
  "**Tags:** verification=deterministic validation=invisible",
  "",
  "**Files:**",
  "- Create: `src/view.ts`",
  "",
  "**Interfaces:**",
  "- Consumes: `save(v: string): void` from Task 1",
  "- Produces: `render(): string`",
  "",
  "**테스트로 증명할 것:**",
  "- [ ] 저장된 값이 없으면 빈 문자열",
].join("\n");

/** preflight.json 의 CLEAN 결과 한 벌 */
const cleanResult = (sha: string) => JSON.stringify({
  schema: 1,
  branch: FIXTURE_BRANCH,
  plan_sha256: sha,
  scope: "interface-graph+file-overlap",
  verdict: "CLEAN",
  relations: { declared: 1, examined_stage1: 1, examined_stage2: 1, not_examined: [] },
  examined: [],
  defects: [],
  applied: [],
});

describe("runBuilder — 사전 검사 게이트를 실행으로 관찰한다 (D26)", () => {
  const root = mkdtempSync(join(tmpdir(), "engineer-bot-gate-"));
  // 경로는 contractPaths 로만 만든다 — 하드코딩하면 계약 경로의 단일 진실이 깨진다.
  const p = contractPaths(root, FIXTURE_BRANCH);
  mkdirSync(p.planDir, { recursive: true });
  writeFileSync(p.designDoc, FIXTURE_DESIGN, "utf8");
  writeFileSync(p.plan, FIXTURE_PLAN, "utf8");

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const setPreflight = (body: string | null) => {
    if (body === null) rmSync(p.preflight, { force: true });
    else writeFileSync(p.preflight, body, "utf8");
  };
  // dryRun:true — 게이트는 통과시키되 세션은 띄우지 않는다.
  const run = () => runBuilder({ repoRoot: root, branch: FIXTURE_BRANCH, dryRun: true });
  const planSha = createHash("sha256").update(FIXTURE_PLAN, "utf8").digest("hex");

  test("픽스처가 계약 검증을 통과한다 — 아래가 엉뚱한 이유로 실패하지 않게", () => {
    expect(checkDesignDoc(FIXTURE_DESIGN).filter((v) => v.severity === "error")).toEqual([]);
    expect(checkPlan(FIXTURE_PLAN).filter((v) => v.severity === "error")).toEqual([]);
  });

  test("preflight.json 이 없으면 REJECTED — 게이트 블록을 지우면 이 테스트가 깨진다", async () => {
    setPreflight(null);
    const o = await run();
    expect(o.outcome).toBe("REJECTED");
    expect(`${o.reason ?? ""}\n${o.contractViolations ?? ""}`).toContain("사전 검사");
  });

  /**
   * 2026-09-04 — 사람이 명시적으로 우회를 지시했다. 위조가 아니라 우회로 만든 이유:
   * `preflight.json` 에 CLEAN 을 써넣으면 감사 흔적에 거짓말이 남는다. 나중에 이
   * 브랜치를 보는 사람이 "검사를 통과했다"고 읽는다.
   */
  test("--skip-preflight 는 게이트를 통과시킨다 — 명시적 예외", async () => {
    setPreflight(null);
    const o = await runBuilder({
      repoRoot: root, branch: FIXTURE_BRANCH, dryRun: true, skipPreflight: true,
    });
    expect(o.outcome).toBe("SUCCESS");
  });

  test("우회하지 않으면 여전히 막는다 — 기본값이 안전한 쪽이다", async () => {
    setPreflight(null);
    expect((await run()).outcome).toBe("REJECTED");
  });

  test("우회해도 preflight.json 을 만들지 않는다 — 위조가 아니다", async () => {
    setPreflight(null);
    await runBuilder({ repoRoot: root, branch: FIXTURE_BRANCH, dryRun: true, skipPreflight: true });
    expect(existsSync(p.preflight)).toBe(false);
  });

  test("CLEAN + 해시 일치면 SUCCESS — 전부 거부하는 게이트가 아니다", async () => {
    setPreflight(cleanResult(planSha));
    const o = await run();
    expect(o.outcome).toBe("SUCCESS");
    expect(o.contractViolations).toBeUndefined();
  });

  test("CLEAN 이지만 해시가 다르면 REJECTED — 해시를 plan.md 에서 다시 계산한다", async () => {
    setPreflight(cleanResult("b".repeat(64)));
    const o = await run();
    expect(o.outcome).toBe("REJECTED");
  });

  test("preflight.json 이 깨진 JSON 이면 BLOCKED — REJECTED 가 아니다 (하드룰 #4)", async () => {
    setPreflight("{ broken");
    const o = await run();
    expect(o.outcome).toBe("BLOCKED");
  });
});

describe("builder.settings.json — 게이트 산출물도 세션이 쓸 수 없다 (I4)", () => {
  const deny: string[] = JSON.parse(
    readFileSync("config/builder.settings.json", "utf8"),
  ).permissions.deny;

  test("계약 파일 네 개가 Edit·Write 양쪽에서 deny 다", () => {
    // preflight.json 이 빠져 있으면 세션이 스스로 CLEAN 을 써넣고 **다음 회전**의
    // 게이트를 통과한다. plan.md 가 deny 라서 해시가 안정적이고, 그래서 위조가
    // 오히려 쉽다. (심층 방어일 뿐이다 — `Bash(bun:*)` 로 우회 가능. $comment 참조)
    for (const f of ["plan.md", "design-doc.md", "preflight.json", "preflight-raw.json"]) {
      for (const tool of ["Edit", "Write"]) {
        expect(deny).toContain(`${tool}(docs/plans/**/${f})`);
      }
    }
  });
});

/**
 * 계약 문서 무결성 (하드룰 #2 의 실제 강제).
 *
 * 경로 기반 deny 로는 닫히지 않는다는 것이 6회전 실측이다 — 서브에이전트가
 * `.claude/**` Write 거부를 `bun -e` 로 우회했다. 세션 밖에서 해시를 비교하는
 * 이 층만이 세션이 무엇을 실행했는지와 무관하게 변조를 드러낸다.
 */
describe("checkDocIntegrity — 봇은 플랜을 현장에서 고치지 않는다", () => {
  const before = { plan: "# Plan\n\n### Task 1: 무엇\n", designDoc: "# Design\n" };

  test("아무것도 안 바뀌면 위반이 없다", () => {
    expect(checkDocIntegrity(before, { ...before })).toEqual([]);
  });

  test("plan.md 가 한 글자만 바뀌어도 잡는다", () => {
    const v = checkDocIntegrity(before, { ...before, plan: before.plan + " " });
    expect(v).toHaveLength(1);
    expect(v[0]!.file).toBe("plan.md");
    expect(v[0]!.rule).toBe("하드룰 #2");
    expect(v[0]!.severity).toBe("error");
  });

  test("design-doc.md 변조도 잡는다", () => {
    const v = checkDocIntegrity(before, { ...before, designDoc: "# Design 고침\n" });
    expect(v.map((x: { file: string }) => x.file)).toEqual(["design-doc.md"]);
  });

  test("둘 다 바뀌면 두 건을 낸다 — 하나로 뭉치지 않는다", () => {
    const v = checkDocIntegrity(before, { plan: "x", designDoc: "y" });
    expect(v.map((x: { file: string }) => x.file).sort()).toEqual(["design-doc.md", "plan.md"]);
  });

  test("파일 삭제도 변조다 — 읽기 실패의 빈 문자열이 불일치를 낸다", () => {
    // runBuilder 는 읽기 실패를 "" 로 강등한다. 그것이 통과해서는 안 된다.
    const v = checkDocIntegrity(before, { plan: "", designDoc: before.designDoc });
    expect(v.map((x: { file: string }) => x.file)).toEqual(["plan.md"]);
  });

  test("메시지가 사람에게 다음 행동을 준다", () => {
    const v = checkDocIntegrity(before, { ...before, plan: "고침" });
    expect(v[0]!.message).toContain("신뢰할 수 없습니다");
    expect(v[0]!.message).toContain("git diff");
  });
});

/**
 * SDD 작업 폴더 격리 (AMENDMENTS B6).
 *
 * B2 가 모든 플랜을 `docs/plans/<slug>/plan.md` 로 고정한 대가다 — 업스트림이
 * 폴더 이름을 basename 으로 만들므로 모든 기능이 한 폴더를 공유한다. 플랜이
 * 하나뿐일 때는 터지지 않으므로, 두 번째 기능 착수 전에 닫아야 한다.
 */
describe("sddWorkspaceOwner — ledger 첫 줄에서 소유자를 읽는다", () => {
  test("실측한 ledger 형식을 읽는다 (em dash)", () => {
    const head = "# SDD ledger — plan: /repo/docs/plans/feature-a/plan.md\n\n## Setup\n";
    expect(sddWorkspaceOwner(head)).toBe("/repo/docs/plans/feature-a/plan.md");
  });

  test("하이픈 변형도 읽는다 — 업스트림 서식 변화에 한 겹 여유를 둔다", () => {
    expect(sddWorkspaceOwner("# SDD ledger - plan: /r/p/plan.md")).toBe("/r/p/plan.md");
  });

  test("형식이 다르면 null — 추측하지 않는다", () => {
    expect(sddWorkspaceOwner("# 다른 문서\n내용")).toBeNull();
    expect(sddWorkspaceOwner("")).toBeNull();
  });
});

describe("sddWorkspaceAction — 남기거나 격리한다", () => {
  const mine = "/repo/docs/plans/feature-a/plan.md";
  const other = "/repo/docs/plans/feature-b/plan.md";

  test("폴더가 없으면 할 일이 없다", () => {
    expect(sddWorkspaceAction(null, mine, false)).toBe("none");
    expect(sddWorkspaceAction(other, mine, false)).toBe("none");
  });

  test("내 플랜의 폴더는 그대로 둔다 — 중단된 빌드의 재개를 깨지 않는다", () => {
    expect(sddWorkspaceAction(mine, mine, true)).toBe("keep");
  });

  test("다른 플랜의 폴더는 격리한다 — task-1-brief.md 가 겹친다", () => {
    expect(sddWorkspaceAction(other, mine, true)).toBe("archive");
  });

  /**
   * 이 갈래가 B6 의 핵심이다. 업스트림 스킬은 ledger 만 보고 "다른 플랜이면 새로
   * 시작하라"고 지시하는데, ledger 를 **읽을 수 없는** 경우는 그 지시가 닿지 않는다.
   * 누구 것인지 모르는 폴더를 재사용하는 것이 지우는 것보다 위험하다.
   */
  test("소유자를 못 읽으면 격리한다 — 모르는 폴더를 재사용하지 않는다", () => {
    expect(sddWorkspaceAction(null, mine, true)).toBe("archive");
  });
});

/**
 * 격리의 **실제 파일시스템 동작**. 위의 두 순수 함수는 판정만 본다.
 *
 * `runBuilder({ dryRun: true })` 로는 이 지점에 닿을 수 없다 — dryRun 조기 반환이
 * 3-A 보다 앞이다. 그것을 뒤로 옮기면 dry run 이 디렉터리를 옮기게 되므로 옮기지
 * 않았다. 대신 동작을 함수로 뽑아 실제 폴더로 관찰한다. 호출 지점 3줄은 다음
 * 봇 빌드가 **두 번째 플랜**이므로 그때 실제로 격리가 일어나는 것으로 확인된다.
 */
describe("isolateSddWorkspace — 실제 폴더를 옮긴다 (B6)", () => {
  const roots: string[] = [];
  const mkRoot = (ledger: string | null, withBrief = true) => {
    const root = mkdtempSync(join(tmpdir(), "engineer-bot-b6-"));
    roots.push(root);
    const sdd = join(root, ".superpowers", "sdd", "plan");
    mkdirSync(sdd, { recursive: true });
    if (ledger !== null) writeFileSync(join(sdd, "progress.md"), ledger, "utf8");
    if (withBrief) writeFileSync(join(sdd, "task-1-brief.md"), "이전 기능의 Task 1", "utf8");
    return root;
  };
  afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

  const at = new Date("2026-09-04T02:00:00Z");

  test("다른 플랜이면 옮긴다 — task-1-brief.md 가 따라간다", async () => {
    const root = mkRoot("# SDD ledger — plan: /repo/docs/plans/feature-b/plan.md\n");
    const dest = await isolateSddWorkspace(root, "/repo/docs/plans/feature-a/plan.md", "feature-a", at);
    expect(dest).not.toBeNull();
    // 원래 자리는 비었다 — 스킬이 새로 시작한다.
    expect(existsSync(join(root, ".superpowers", "sdd", "plan"))).toBe(false);
    // 기록은 살아 있다 (concern #8 — 지우지 않는다).
    expect(readFileSync(join(dest!, "task-1-brief.md"), "utf8")).toContain("이전 기능");
    expect(dest).toContain("feature-a-2026-09-04");
  });

  test("내 플랜이면 그대로 둔다 — 중단된 빌드의 재개를 깨지 않는다", async () => {
    const mine = "/repo/docs/plans/feature-a/plan.md";
    const root = mkRoot(`# SDD ledger — plan: ${mine}\n`);
    expect(await isolateSddWorkspace(root, mine, "feature-a", at)).toBeNull();
    expect(existsSync(join(root, ".superpowers", "sdd", "plan", "task-1-brief.md"))).toBe(true);
  });

  test("ledger 없이 브리프만 남은 중단 흔적도 격리한다", async () => {
    const root = mkRoot(null);
    const dest = await isolateSddWorkspace(root, "/repo/docs/plans/feature-a/plan.md", "feature-a", at);
    expect(dest).not.toBeNull();
    expect(readFileSync(join(dest!, "task-1-brief.md"), "utf8")).toContain("이전 기능");
  });

  test("폴더가 아예 없으면 아무것도 하지 않는다", async () => {
    const root = mkdtempSync(join(tmpdir(), "engineer-bot-b6-"));
    roots.push(root);
    expect(await isolateSddWorkspace(root, "/repo/p/plan.md", "s", at)).toBeNull();
    expect(existsSync(join(root, ".superpowers"))).toBe(false);
  });

  test("두 번 격리해도 이름이 겹치지 않는다 — 첫 격리를 덮어쓰지 않는다", async () => {
    const foreign = "# SDD ledger — plan: /repo/docs/plans/feature-b/plan.md\n";
    const root = mkRoot(foreign);
    const d1 = await isolateSddWorkspace(root, "/repo/docs/plans/feature-a/plan.md", "feature-a", at);
    mkdirSync(join(root, ".superpowers", "sdd", "plan"), { recursive: true });
    writeFileSync(join(root, ".superpowers", "sdd", "plan", "progress.md"), foreign, "utf8");
    const d2 = await isolateSddWorkspace(
      root, "/repo/docs/plans/feature-a/plan.md", "feature-a",
      new Date("2026-09-04T03:00:00Z"),
    );
    expect(d2).not.toBe(d1);
    expect(existsSync(d1!)).toBe(true);
  });
});
