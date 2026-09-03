/**
 * 계약 경계의 정규화 단계 (AMENDMENTS B2).
 *
 * gstack은 설계문서를 자유 명명으로 쓴다:
 *   {user}-{branch}-design-{datetime}.md
 * 그리고 `plan-eng-review`는 그것을 **glob + ls -t** 로 찾는다. 파일명을
 * `design-doc.md`로 바꾸면 eng-review가 자기 입력을 못 찾는다.
 *
 * 그래서 이름을 바꾸지 않고, 계약 경계에서 **복사해 정규화**한다:
 *
 *   docs/gstack/{user}-{branch}-design-{ts}.md   ← gstack의 세계 (자유 명명)
 *           │  materialize
 *           ▼
 *   docs/plans/<slug>/design-doc.md              ← 계약 (고정 명명, builder 입력)
 */

import { readdir, readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { contractPaths } from "./paths";

export interface Candidate {
  name: string;
  mtimeMs: number;
}

/**
 * gstack 산출물 중 이 브랜치의 최신 설계문서를 고른다.
 *
 * eng-review의 탐색 로직과 같은 우선순위를 쓴다:
 *   1) `*-<branch>-design-*.md` 중 최신
 *   2) 없으면 `*-design-*.md` 중 최신 (브랜치 무관 폴백)
 */
export function pickLatestDesignDoc(files: Candidate[], slug: string): Candidate | null {
  const byNewest = (a: Candidate, b: Candidate) => b.mtimeMs - a.mtimeMs;
  const branchScoped = files
    .filter((f) => f.name.includes(`-${slug}-design-`) && f.name.endsWith(".md"))
    .sort(byNewest);
  if (branchScoped.length > 0) return branchScoped[0];
  const anyDesign = files
    .filter((f) => /-design-.*\.md$/.test(f.name))
    .sort(byNewest);
  return anyDesign[0] ?? null;
}

/** eng-review가 쓴 테스트 플랜도 계약 경로로 데려온다 — invisible 검증의 근거다 */
export function pickLatestTestPlan(files: Candidate[], slug: string): Candidate | null {
  const scoped = files
    .filter((f) => f.name.includes(`-${slug}-eng-review-test-plan-`) && f.name.endsWith(".md"))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return scoped[0] ?? null;
}

export interface MaterializeResult {
  designDoc: { from: string; to: string } | null
  testPlan: { from: string; to: string } | null;
  warnings: string[];
}

async function listCandidates(dir: string): Promise<Candidate[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: Candidate[] = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    try {
      const s = await stat(join(dir, name));
      out.push({ name, mtimeMs: s.mtimeMs });
    } catch {
      // 경쟁 상태로 사라진 파일은 무시한다
    }
  }
  return out;
}

/**
 * 멱등하다. 계약 파일이 이미 있고 원본이 더 최신이 아니면 덮어쓰지 않는다 —
 * planner가 계약 파일에 손으로 추가한 내용을 gstack 재실행이 날리지 않게.
 */
export async function materialize(repoRoot: string, branch: string): Promise<MaterializeResult> {
  const p = contractPaths(repoRoot, branch);
  const warnings: string[] = [];
  const files = await listCandidates(p.gstackDir);

  if (files.length === 0) {
    warnings.push(
      `gstack 산출물이 없습니다: ${p.gstackDir} — bin/setup-paths.sh 를 실행했는지 확인하세요 (AMENDMENTS B1)`,
    );
  }

  await mkdir(p.planDir, { recursive: true });

  const copyIfNewer = async (
    src: Candidate | null,
    dest: string,
    label: string,
  ): Promise<{ from: string; to: string } | null> => {
    if (!src) return null;
    const from = join(p.gstackDir, src.name);
    try {
      const existing = await stat(dest);
      if (existing.mtimeMs >= src.mtimeMs) {
        warnings.push(`${label}: 계약 파일이 원본보다 최신이라 덮어쓰지 않았습니다 (${dest})`);
        return null;
      }
    } catch {
      // 계약 파일이 아직 없다 — 정상 경로
    }
    const body = await readFile(from, "utf8");
    const header = [
      `<!-- materialized from ${src.name} by controller/materialize.ts`,
      `     gstack 원본을 수정하지 마세요 — plan-eng-review가 glob으로 찾습니다 (AMENDMENTS B2) -->`,
      "",
    ].join("\n");
    await writeFile(dest, header + body, "utf8");
    return { from, to: dest };
  };

  const designDoc = await copyIfNewer(pickLatestDesignDoc(files, p.slug), p.designDoc, "design-doc");
  const testPlan = await copyIfNewer(
    pickLatestTestPlan(files, p.slug),
    join(p.planDir, "eng-review-test-plan.md"),
    "test-plan",
  );

  if (!designDoc) {
    try {
      await stat(p.designDoc);
    } catch {
      warnings.push(
        `design-doc.md를 만들 수 없습니다 — ${p.gstackDir} 에 '*-${p.slug}-design-*.md' 가 없습니다`,
      );
    }
  }

  return { designDoc, testPlan, warnings };
}

if (import.meta.main) {
  const repoRoot = process.env.TARGET_REPO ?? process.cwd();
  const branch = process.argv[2];
  if (!branch) {
    console.error("usage: bun controller/materialize.ts <branch>");
    process.exit(2);
  }
  const r = await materialize(repoRoot, branch);
  if (r.designDoc) console.log(`✓ design-doc.md ← ${r.designDoc.from}`);
  if (r.testPlan) console.log(`✓ eng-review-test-plan.md ← ${r.testPlan.from}`);
  for (const w of r.warnings) console.warn(`! ${w}`);
  process.exit(r.warnings.some((w) => w.includes("만들 수 없습니다")) ? 1 : 0);
}
