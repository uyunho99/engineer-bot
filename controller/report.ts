/**
 * Slack 보고 패킷 포맷터 (명세 §5.6 · §6.1 · §6.3).
 *
 * 원칙 두 개:
 *  1. **보이는 건 데모로, 안 보이는 건 테스트로.** `invisible`-only 변경이면
 *     데모 URL 자리에 테스트 케이스 목록이 전면에 온다.
 *  2. **머지 요청 문구는 어떤 성공 패킷에서도 빠지지 않는다.** 봇이 머지하지
 *     않는다는 사실이 매번 명시돼야 게이트 ②가 습관이 된다.
 */

import type { BuildResult, ParsedTask } from "./contract";

export interface PacketInput {
  result: BuildResult;
  /** Vercel 프리뷰 URL (명세 §7 Phase 1). 없으면 데모 줄을 생략한다 */
  previewUrl?: string | null;
  /** plan.md에서 파싱한 태스크 — visible 유무 판정에 쓴다 */
  tasks?: Pick<ParsedTask, "id" | "validation">[];
  /** 커버 케이스 목록 링크 (레포 내 plan.md 경로 등) */
  testCasesUrl?: string | null;
}

export function hasVisibleWork(input: PacketInput): boolean {
  if (input.result.screenshots?.length) return true;
  if (input.tasks?.length) return input.tasks.some((t) => t.validation === "visible");
  // 태그 정보가 없으면 스크린샷 유무로만 판단한다 — 없으면 invisible 취급.
  return false;
}

function testLine(r: BuildResult): string {
  if (!r.tests) return "🧪 테스트: 결과 미보고";
  const { passed, failed } = r.tests;
  const total = passed + failed;
  const mark = failed === 0 ? "pass" : `pass · ${failed} FAIL`;
  return `🧪 테스트: ${passed}/${total} ${mark}${r.tests.summary ? ` — ${r.tests.summary}` : ""}`;
}

function concernLines(r: BuildResult): string[] {
  const out: string[] = [];
  if (r.concerns?.length) {
    out.push(`⚠️ concerns ${r.concerns.length}건`);
    out.push(...r.concerns.map((c) => `   · [Task ${c.task_id}] ${c.note}`));
  }
  // 검증 공백은 성공했어도 반드시 노출한다 (명세 §3.4 폴백)
  if (r.verification_gaps?.length) {
    out.push(`🕳 검증 공백 ${r.verification_gaps.length}건 — 골든셋 부재로 구조 assert만 수행됨`);
    out.push(...r.verification_gaps.map((g) => `   · [Task ${g.task_id}] ${g.reason}`));
  }
  return out;
}

const MERGE_NOTE = "👉 확인 후 직접 머지해주세요. 저는 머지하지 않습니다.";

function successPacket(input: PacketInput): string {
  const r = input.result;
  const lines = [`✅ 빌드 완료 — ${r.branch}`];

  lines.push(`🔗 PR: ${r.pr_url}`);

  if (hasVisibleWork(input)) {
    // 보이는 변경 — 데모가 증거의 무게중심
    if (input.previewUrl) lines.push(`🌐 데모: ${input.previewUrl}`);
    else lines.push("🌐 데모: (프리뷰 배포 없음 — 스크린샷으로 확인)");
    if (r.screenshots?.length) lines.push(`🖼 스크린샷 ${r.screenshots.length}장`);
    lines.push(testLine(r));
  } else {
    // invisible-only — 테스트 케이스가 전면에 온다 (명세 §5.6 마지막 항)
    lines.push("👁 화면 변경 없음 — 테스트가 유일한 증거입니다");
    lines.push(testLine(r));
    const cases = r.test_cases ?? [];
    if (cases.length === 0) {
      lines.push("⚠️ invisible 변경인데 커버 케이스가 보고되지 않았습니다 — 검증 근거가 없습니다");
    } else {
      lines.push(`🧾 커버 케이스 ${cases.length}건`);
      lines.push(
        ...cases.map((c) => `   ${c.result === "pass" ? "✓" : "✗"} [Task ${c.task_id}] ${c.case}`),
      );
    }
    if (input.testCasesUrl) lines.push(`📄 전체 목록: ${input.testCasesUrl}`);
  }

  if (r.tasks_total !== undefined) {
    lines.push(`📦 태스크 ${r.tasks_done ?? r.tasks_total}/${r.tasks_total} 완료`);
  }
  lines.push(...concernLines(r));
  lines.push(MERGE_NOTE);
  return lines.join("\n");
}

function rejectedPacket(r: BuildResult): string {
  const lines = [
    `↩️ REJECTED — ${r.branch}`,
    "플랜 자체에 결함이 있어 빌드를 중단했습니다. **플랜은 고치지 않았습니다** (명세 §6.3).",
    "",
  ];
  for (const d of r.defects ?? []) {
    lines.push(`■ Task ${d.task_id}`);
    lines.push(`   플랜 원문: ${d.plan_text}`);
    lines.push(`   충돌: ${d.conflict}`);
    if (d.suggested_fix) lines.push(`   제안: ${d.suggested_fix}`);
    lines.push("");
  }
  lines.push("👉 플랜을 수정한 뒤 **게이트 ① 재승인**이 필요합니다. 이전 승인은 재사용되지 않습니다.");
  return lines.join("\n").trimEnd();
}

function blockedPacket(r: BuildResult): string {
  const b = r.blocked;
  const lines = [
    `⛔ BLOCKED — ${r.branch}`,
    `태스크 [${b?.task_id ?? "?"}]에서 막혔습니다. 임의 우회하지 않고 정지했습니다.`,
    `사유: ${b?.reason ?? "(미보고)"}`,
  ];
  if (b?.attempts?.length) {
    lines.push("시도 내역:");
    lines.push(...b.attempts.slice(0, 3).map((a, i) => `   ${i + 1}. ${a}`));
  }
  if (r.commits?.length) lines.push(`💾 여기까지의 커밋 ${r.commits.length}개는 브랜치에 남아 있습니다`);
  lines.push(...concernLines(r));
  lines.push("👉 재개 / 태스크 스킵 / 세션 중단 중 하나를 지시해주세요.");
  return lines.join("\n");
}

export function formatPacket(input: PacketInput): string {
  switch (input.result.outcome) {
    case "SUCCESS":
      return successPacket(input);
    case "REJECTED":
      return rejectedPacket(input.result);
    case "BLOCKED":
      return blockedPacket(input.result);
  }
}

/**
 * 계약 검증에 실패해 빌드를 시작조차 못 한 경우 (명세 §4.3).
 * 이건 builder의 보고가 아니라 컨트롤러의 보고다.
 */
export function formatContractRejection(branch: string, violations: string): string {
  return [
    `↩️ REJECTED — ${branch}`,
    "핸드오프 계약 검증에 실패해 **빌드를 시작하지 않았습니다** (명세 §4.3).",
    "```",
    violations,
    "```",
    "👉 문서를 고친 뒤 게이트 ① 재승인이 필요합니다.",
  ].join("\n");
}

/** 상태 전이 한 줄 게시 (명세 §2) */
export function formatTransition(to: string, note?: string): string {
  return note ? `▸ ${to} 진입 — ${note}` : `▸ ${to} 진입`;
}
