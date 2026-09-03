/**
 * vendoring된 스킬의 무결성 검증 (AMENDMENTS A15).
 *
 * **왜 vendoring인가** — 마켓플레이스 플러그인은 자동 업데이트 대상이다.
 * 2026-09-02에 superpowers가 조용히 6.2.0→6.3.0으로 올라가 A3(사람 질문 지점
 * 변환)을 무효화한 것이 그 위험의 실례다. 봇 호스트에서 돌아야 하는 스킬은
 * sha 고정 사본으로 레포에 들어오고, git이 그것을 추적한다.
 *
 * **왜 바이트 단위 일치인가** — 명세 P4는 원본 스킬을 fork하지 않는다고 규정한다.
 * vendoring은 복사이지 fork가 아니어야 하므로, 사본이 업스트림과 **정확히 같음**을
 * 기계가 증명할 수 있어야 한다. 해시가 어긋나면 둘 중 하나다: 누가 사본을 고쳤거나
 * (= 몰래 fork했거나), 업스트림을 올리고 매니페스트를 갱신하지 않았거나.
 *
 * 해시는 **git blob sha1**이다 — `git hash-object <파일>` 로 사람이 직접 확인할 수
 * 있고, GitHub 트리 API가 돌려주는 값과 같아서 별도 변환이 필요 없다.
 */

import { createHash } from "node:crypto";

export interface VendoredSkill {
  name: string;
  source: string;
  upstream_path: string;
  commit: string;
  dest: string;
  vendored_at: string;
  reason?: string;
  runtime_deps?: { python?: string[]; note?: string };
  /** 상대 경로 → git blob sha1 */
  files: Record<string, string>;
}

export interface Manifest {
  schema: number;
  skills: VendoredSkill[];
}

/** git blob sha1 — `git hash-object` 와 같은 값 */
export function gitBlobSha(content: Uint8Array): string {
  const header = Buffer.from(`blob ${content.length}\0`, "utf8");
  return createHash("sha1").update(Buffer.concat([header, Buffer.from(content)])).digest("hex");
}

export type FileStatus = "ok" | "drift" | "missing";

export interface FileResult {
  path: string;
  status: FileStatus;
  expected: string;
  actual: string | null;
}

export interface SkillResult {
  name: string;
  commit: string;
  ok: boolean;
  files: FileResult[];
  get drifted(): FileResult[];
  get missing(): FileResult[];
}

/**
 * 매니페스트를 검증한다.
 *
 * `read`는 파일을 읽어 바이트를 돌려주거나, 없으면 null을 돌려준다.
 * 파일 시스템을 주입받으므로 이 함수는 순수하고 테스트할 수 있다 —
 * 이 레포가 판단 로직을 `controller/`에 두는 이유와 같다.
 */
export function verifyManifest(
  manifest: Manifest,
  read: (relPath: string) => Uint8Array | null,
): SkillResult[] {
  return manifest.skills.map((skill) => {
    const files: FileResult[] = Object.entries(skill.files).map(([rel, expected]) => {
      const content = read(`${skill.dest}/${rel}`);
      if (content === null) {
        return { path: rel, status: "missing" as const, expected, actual: null };
      }
      const actual = gitBlobSha(content);
      return {
        path: rel,
        status: (actual === expected ? "ok" : "drift") as FileStatus,
        expected,
        actual,
      };
    });
    return {
      name: skill.name,
      commit: skill.commit,
      ok: files.every((f) => f.status === "ok"),
      files,
      get drifted() {
        return files.filter((f) => f.status === "drift");
      },
      get missing() {
        return files.filter((f) => f.status === "missing");
      },
    };
  });
}

/** 사람이 읽는 보고. bootstrap.sh 가 이 출력을 그대로 보여준다. */
export function formatResults(results: SkillResult[]): string {
  if (!results.length) return "  vendoring된 스킬 없음";
  const lines: string[] = [];
  for (const r of results) {
    const short = r.commit.slice(0, 7);
    const n = r.files.length;
    if (r.ok) {
      lines.push(`  ✓ ${r.name} @ ${short} — 파일 ${n}개 원본과 일치`);
      continue;
    }
    if (r.missing.length) {
      lines.push(`  ✗ ${r.name} @ ${short} — 파일 ${r.missing.length}/${n} 없음`);
      for (const f of r.missing) lines.push(`      없음: ${f.path}`);
    }
    if (r.drifted.length) {
      lines.push(`  ✗ ${r.name} @ ${short} — 파일 ${r.drifted.length}/${n} 이 원본과 다름`);
      for (const f of r.drifted) lines.push(`      변경됨: ${f.path}`);
      lines.push(`    사본을 고쳤다면 되돌리십시오 — vendoring은 복사이지 fork가 아닙니다 (명세 P4).`);
      lines.push(`    업스트림을 올렸다면 config/vendored-skills.json 의 commit 과 files 를 갱신하십시오.`);
    }
  }
  return lines.join("\n");
}

/** 런타임 의존성 안내. 설치 여부는 여기서 판정하지 않는다 (언어가 다르므로). */
export function formatRuntimeDeps(manifest: Manifest): string {
  const lines: string[] = [];
  for (const s of manifest.skills) {
    for (const dep of s.runtime_deps?.python ?? []) {
      lines.push(`  · ${s.name} 는 python ${dep} 를 요구합니다 — pip3 install '${dep}'`);
    }
    if (s.runtime_deps?.note) lines.push(`    ${s.runtime_deps.note}`);
  }
  return lines.join("\n");
}

if (import.meta.main) {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = new URL("..", import.meta.url).pathname;
  const manifestPath = join(root, "config", "vendored-skills.json");

  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    console.error(`매니페스트를 읽을 수 없습니다: ${manifestPath}\n${e}`);
    process.exit(2);
  }

  const results = verifyManifest(manifest, (rel) => {
    try {
      return new Uint8Array(readFileSync(join(root, rel)));
    } catch {
      return null;
    }
  });

  console.log(formatResults(results));
  const deps = formatRuntimeDeps(manifest);
  if (deps) console.log(deps);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
