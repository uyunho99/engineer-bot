/**
 * 경로 계약의 단일 진실 (명세 §4.1 · AMENDMENTS B1/B2).
 *
 * 경로를 다른 곳에 하드코딩하지 마라. 두 봇이 같은 파일을 봐야 하는 것이
 * 핸드오프 계약의 전제이고(P7), 그 전제가 깨지는 가장 흔한 방식이
 * 경로 문자열의 중복이다.
 *
 * 주의: 이 경로들은 **제품 레포**(봇이 빌드하는 대상) 기준이다.
 * engineer-bot(하네스 레포)이 아니다.
 */

import { basename, join } from "node:path";

/**
 * 브랜치명 → 슬러그. gstack·superpowers 양쪽 모두 `/`를 `-`로 바꾼다.
 *
 * 브랜치명은 Slack 발화에서 오므로 신뢰하지 않는다. `/`→`-` 치환만으로는
 * 경로 탈출이 막히지만(`a/../b` → `a-..-b`), git 자신이 refname에서 `..`를
 * 금지하므로(`git check-ref-format`) 우리도 거부한다 — git이 만들 수 없는
 * 브랜치명을 받아들이면 그 세션은 어차피 어디서도 체크아웃되지 않는다.
 */
export function branchSlug(branch: string): string {
  const raw = branch.trim();
  if (raw.includes("..")) {
    throw new Error(`브랜치명에 '..'는 허용되지 않습니다 (git refname 규칙): ${JSON.stringify(branch)}`);
  }
  const slug = raw.replace(/\//g, "-");
  if (!slug || slug === ".") {
    throw new Error(`브랜치명에서 슬러그를 만들 수 없습니다: ${JSON.stringify(branch)}`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(slug)) {
    throw new Error(`브랜치 슬러그에 허용되지 않는 문자가 있습니다: ${JSON.stringify(slug)}`);
  }
  return slug;
}

export interface ContractPaths {
  /** 제품 레포 루트 */
  repoRoot: string;
  branch: string;
  slug: string;
  /** 계약 디렉터리 — 두 봇의 공유 경계 */
  planDir: string;
  designDoc: string;
  plan: string;
  discoveries: string;
  buildResult: string;
  screenshotDir: string;
  /** gstack 산출 디렉터리 (심링크 대상, 자유 명명) */
  gstackDir: string;
  /** 사전 검사 결과 (정규화됨). 새 파일이다 — build-result.json 에 합치지 않는다 (설계 D7).
   *  게이트 ① 앞에서 builder 가 읽는다 (설계 D26) */
  preflight: string;
  /** 워크플로우가 직접 쓰는 원본. 세션이 값을 옮기지 않는다 (설계 D28) */
  preflightRaw: string;
}

export function contractPaths(repoRoot: string, branch: string): ContractPaths {
  const slug = branchSlug(branch);
  const planDir = join(repoRoot, "docs", "plans", slug);
  return {
    repoRoot,
    branch,
    slug,
    planDir,
    designDoc: join(planDir, "design-doc.md"),
    plan: join(planDir, "plan.md"),
    discoveries: join(planDir, "discoveries.md"),
    buildResult: join(planDir, "build-result.json"),
    screenshotDir: join(planDir, "shots"),
    gstackDir: join(repoRoot, "docs", "gstack"),
    preflight: join(planDir, "preflight.json"),
    preflightRaw: join(planDir, "preflight-raw.json"),
  };
}

/**
 * gstack이 이 레포를 부르는 슬러그. `bin/gstack-slug`와
 * `plan-eng-review`의 폴백(`basename $(git rev-parse --show-toplevel)`)이
 * 둘 다 수렴하는 값이다 (AMENDMENTS B5).
 */
export function gstackProjectSlug(repoRoot: string): string {
  return basename(repoRoot);
}

/** 심링크 원본 — gstack이 하드코딩으로 참조하는 경로 (AMENDMENTS B1) */
export function gstackProjectsLink(home: string, repoRoot: string): string {
  return join(home, ".gstack", "projects", gstackProjectSlug(repoRoot));
}

if (import.meta.main) {
  const repoRoot = process.env.TARGET_REPO ?? process.cwd();
  const branch =
    process.argv[2] ??
    (await Bun.$`git -C ${repoRoot} rev-parse --abbrev-ref HEAD`.text().catch(() => "")).trim();
  if (!branch) {
    console.error("브랜치를 알 수 없습니다. 인자로 넘기세요: bun controller/paths.ts <branch>");
    process.exit(2);
  }
  console.log(JSON.stringify(contractPaths(repoRoot, branch), null, 2));
}
