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
 *
 * ## 방향이 뒤집힌 경우 — `--export` (AMENDMENTS A14)
 *
 * 2026-09-03 라우팅 교체로 기획 진입점이 `superpowers:brainstorming` 이 됐다.
 * 그 스킬은 산출을 **계약 경로에 직접 쓴다** — gstack 을 거치지 않는다. 그런데
 * `plan-eng-review` 는 여전히 `~/.gstack/projects/$SLUG/*-$BRANCH-design-*.md` 를
 * **하드코딩 glob** 으로 찾는다 (B1). 그러면 자기 입력을 못 찾는다.
 *
 * 그래서 `--export` 가 반대 방향을 잇는다. 이름을 계약 쪽으로 바꾸는 대신
 * gstack 이 기대하는 이름으로 **복사본을 하나 더** 만든다 — 원본 스킬을 고치지
 * 않는다는 P4 를 지키는 유일한 방법이다.
 *
 *   docs/plans/<slug>/design-doc.md
 *           │  materialize --export
 *           ▼
 *   docs/gstack/{user}-{branch}-design-{ts}.md   ← eng-review 가 glob 으로 찾는다
 */

import { readdir, readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { contractPaths } from "./paths";

/**
 * gstack 명명으로 되돌리는 파일명 (A14 `--export`).
 *
 * 실측한 gstack 산출물과 **글자 단위로 같은 형태**여야 한다 — eng-review 가
 * `*-<branch>-design-*.md` 로 glob 하므로 브랜치가 파일명에 들어가고
 * `/` 는 `-` 로 바뀐다 (슬러그와 같은 규칙). 타임스탬프는 `YYYYMMDDHHMMSS` 다:
 *
 *   yunho-feature-plan-preflight-design-20260903151051.md
 *
 * 타임스탬프를 붙이는 이유는 eng-review 가 `ls -t` 로 최신을 고르기 때문이다.
 * 고정 이름으로 덮어쓰면 설계 변경 이력이 사라지고, 같은 초에 두 번 내보내면
 * 같은 파일이 되므로 호출자가 그것을 감수한다 (덮어쓰기).
 */
export function exportFileName(user: string, slug: string, at: Date): string {
  const p2 = (n: number) => String(n).padStart(2, "0");
  const ts =
    `${at.getFullYear()}${p2(at.getMonth() + 1)}${p2(at.getDate())}` +
    `${p2(at.getHours())}${p2(at.getMinutes())}${p2(at.getSeconds())}`;
  return `${user}-${slug}-design-${ts}.md`;
}

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

/**
 * `materialize` 가 붙인 헤더를 벗긴다.
 *
 * 왜 필요한가 — `materialize` 는 되돌려 복사할 때 `<!-- materialized from ... -->`
 * 를 앞에 붙인다. `--export` 가 그것을 그대로 gstack 에 내보내면 **왕복마다 헤더가
 * 쌓인다.** 편집이 없어도 재현된다: export(T1) → materialize 는 design-doc 이
 * T1 보다 오래됐으므로 덮어쓰고 헤더를 하나 더 붙인다.
 *
 * A14 가 경고한 양방향 위험의 나머지 절반이다 — 내용 유실은 `copyIfNewer` 의
 * mtime 비교가 막지만, **헤더 누적은 막지 않는다.**
 */
export function stripMaterializedHeader(body: string): string {
  return body.replace(/^<!-- materialized from[\s\S]*?-->\n+/, "");
}

export interface ExportResult {
  from: string;
  to: string;
}

/**
 * 계약 경로의 design-doc.md 를 gstack 명명으로 내보낸다 (A14).
 *
 * 원본을 옮기지 않고 **복사**한다. 계약 경로가 builder 의 입력이므로 그것이
 * 사라지면 빌드가 멈춘다 — 내보내기는 eng-review 를 위한 부수적 사본이다.
 *
 * 설계문서가 없으면 `null` 을 낸다. 이것은 오류가 아니다 — 기획을 시작하지
 * 않은 브랜치에서 내보낼 것이 없는 것은 정상이다.
 */
export async function exportDesignDoc(
  repoRoot: string,
  branch: string,
  opts: { user?: string; now?: Date } = {},
): Promise<ExportResult | null> {
  const p = contractPaths(repoRoot, branch);
  let body: string;
  try {
    body = await readFile(p.designDoc, "utf8");
  } catch {
    return null;
  }
  const user = opts.user ?? process.env.USER ?? "unknown";
  const name = exportFileName(user, p.slug, opts.now ?? new Date());
  const clean = stripMaterializedHeader(body);
  const to = join(p.gstackDir, name);
  await mkdir(p.gstackDir, { recursive: true });
  await writeFile(to, clean, "utf8");
  return { from: p.designDoc, to };
}

if (import.meta.main) {
  const repoRoot = process.env.TARGET_REPO ?? process.cwd();
  const branch = process.argv[2];
  if (!branch) {
    console.error("usage: bun controller/materialize.ts <branch> [--export]");
    process.exit(2);
  }
  if (process.argv.includes("--export")) {
    // 반대 방향 (A14) — 계약 → gstack. eng-review 가 자기 입력을 찾게 한다.
    const e = await exportDesignDoc(repoRoot, branch);
    if (!e) {
      console.error(
        `! design-doc.md 가 없습니다 — 내보낼 것이 없습니다 (${contractPaths(repoRoot, branch).designDoc})`,
      );
      process.exit(1);
    }
    console.log(`✓ ${e.to} ← ${e.from}`);
    process.exit(0);
  }

  const r = await materialize(repoRoot, branch);
  if (r.designDoc) console.log(`✓ design-doc.md ← ${r.designDoc.from}`);
  if (r.testPlan) console.log(`✓ eng-review-test-plan.md ← ${r.testPlan.from}`);
  for (const w of r.warnings) console.warn(`! ${w}`);
  process.exit(r.warnings.some((w) => w.includes("만들 수 없습니다")) ? 1 : 0);
}
