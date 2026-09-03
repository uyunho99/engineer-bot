import { describe, expect, test } from "bun:test";
import { buildClaudeArgs, isStaleReport, mergeSettings, resolveSuperpowersDir } from "./builder";

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
