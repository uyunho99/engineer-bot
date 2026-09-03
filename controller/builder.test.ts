import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import {
  buildClaudeArgs,
  checkDocIntegrity,
  isStaleReport,
  mergeSettings,
  resolveSuperpowersDir,
  runBuilder,
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
