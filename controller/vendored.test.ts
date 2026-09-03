import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatResults,
  gitBlobSha,
  verifyManifest,
  type Manifest,
} from "./vendored";

const ROOT = new URL("..", import.meta.url).pathname;

const enc = (s: string) => new TextEncoder().encode(s);

function manifestOf(files: Record<string, string>): Manifest {
  return {
    schema: 1,
    skills: [
      {
        name: "demo",
        source: "github:example/repo",
        upstream_path: "skills/demo",
        commit: "0".repeat(40),
        dest: ".claude/skills/demo",
        vendored_at: "2026-09-03",
        files,
      },
    ],
  };
}

describe("gitBlobSha", () => {
  // `git hash-object` 와 같은 값이어야 사람이 손으로 검증할 수 있다.
  test("빈 파일은 git 의 알려진 빈 blob 해시다", () => {
    expect(gitBlobSha(enc(""))).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });

  test("'hello' 는 git 이 내는 값과 같다", () => {
    // git hash-object 로 확인된 값 (개행 없음)
    expect(gitBlobSha(enc("hello"))).toBe("b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0");
  });

  test("한 바이트만 달라도 해시가 달라진다", () => {
    expect(gitBlobSha(enc("hello"))).not.toBe(gitBlobSha(enc("hellp")));
  });
});

describe("verifyManifest", () => {
  test("해시가 맞으면 ok", () => {
    const body = enc("console.log(1)\n");
    const m = manifestOf({ "a.js": gitBlobSha(body) });
    const [r] = verifyManifest(m, () => body);
    expect(r.ok).toBe(true);
    expect(r.files[0].status).toBe("ok");
  });

  test("내용이 바뀌면 drift — 조용히 통과시키지 않는다", () => {
    const m = manifestOf({ "a.js": gitBlobSha(enc("원본")) });
    const [r] = verifyManifest(m, () => enc("누군가 고침"));
    expect(r.ok).toBe(false);
    expect(r.drifted).toHaveLength(1);
    expect(r.missing).toHaveLength(0);
  });

  test("파일이 없으면 missing — drift 와 구분한다", () => {
    const m = manifestOf({ "a.js": gitBlobSha(enc("x")) });
    const [r] = verifyManifest(m, () => null);
    expect(r.ok).toBe(false);
    expect(r.missing).toHaveLength(1);
    expect(r.drifted).toHaveLength(0);
    expect(r.files[0].actual).toBeNull();
  });

  test("한 파일만 어긋나도 스킬 전체가 실패다", () => {
    const good = enc("ok");
    const m = manifestOf({ "a.js": gitBlobSha(good), "b.js": gitBlobSha(enc("원본")) });
    const [r] = verifyManifest(m, (p) => (p.endsWith("a.js") ? good : enc("변조")));
    expect(r.ok).toBe(false);
    expect(r.files.filter((f) => f.status === "ok")).toHaveLength(1);
    expect(r.drifted).toHaveLength(1);
  });

  test("dest 를 붙인 경로로 읽는다", () => {
    const body = enc("x");
    const seen: string[] = [];
    const m = manifestOf({ "scripts/run.py": gitBlobSha(body) });
    verifyManifest(m, (p) => {
      seen.push(p);
      return body;
    });
    expect(seen).toEqual([".claude/skills/demo/scripts/run.py"]);
  });

  test("스킬이 없으면 빈 결과 — 던지지 않는다", () => {
    expect(verifyManifest({ schema: 1, skills: [] }, () => null)).toEqual([]);
  });
});

describe("formatResults", () => {
  test("drift 는 되돌리는 방법을 알려준다", () => {
    const m = manifestOf({ "a.js": gitBlobSha(enc("원본")) });
    const out = formatResults(verifyManifest(m, () => enc("변조")));
    expect(out).toContain("a.js");
    expect(out).toContain("fork");
    expect(out).toContain("config/vendored-skills.json");
  });

  test("vendoring된 스킬이 없으면 그렇게 말한다", () => {
    expect(formatResults([])).toContain("없음");
  });
});

describe("실제 매니페스트 (레포 상태)", () => {
  const manifest: Manifest = JSON.parse(
    readFileSync(join(ROOT, "config", "vendored-skills.json"), "utf8"),
  );

  test("등재된 스킬이 전부 원본과 바이트 단위로 같다", () => {
    const results = verifyManifest(manifest, (rel) => {
      try {
        return new Uint8Array(readFileSync(join(ROOT, rel)));
      } catch {
        return null;
      }
    });
    for (const r of results) {
      expect({ name: r.name, drifted: r.drifted.map((f) => f.path), missing: r.missing.map((f) => f.path) })
        .toEqual({ name: r.name, drifted: [], missing: [] });
    }
  });

  test("commit 이 40자 sha 다 — 브랜치명이나 'main' 을 핀으로 쓰지 않는다", () => {
    for (const s of manifest.skills) {
      expect(s.commit).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  test("dest 가 .claude/skills/ 아래다 — 스킬 로더가 찾는 경로", () => {
    for (const s of manifest.skills) {
      expect(s.dest.startsWith(".claude/skills/")).toBe(true);
    }
  });
});
