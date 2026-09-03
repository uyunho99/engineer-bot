/**
 * 핸드오프 계약 스키마 체커 (명세 §4.2 · §4.3).
 *
 * builder-bot은 기동 시 이 체크를 통과해야 한다. 실패하면 **빌드 시작 전**
 * REJECTED로 반송한다 — 잘못된 플랜으로 완주하는 것이 SDD의 성질이므로,
 * 계약 검증이 유일하게 값싼 방어선이다.
 *
 * 추가 검증 항목 (명세에 없지만 필수 — AMENDMENTS B4):
 * superpowers `scripts/task-brief`는 `^#+[ \t]+Task[ \t]+[0-9]+` 로만
 * 태스크를 추출한다. 헤딩 형식이 어긋나면 SDD 루프가 시작조차 못 하므로
 * 여기서 잡는다.
 */

export type Severity = "error" | "warn";

export interface Violation {
  severity: Severity;
  file: "design-doc.md" | "plan.md" | "build-result.json";
  /** 명세/AMENDMENTS의 근거 조항 */
  rule: string;
  message: string;
  /** 해당 태스크가 있으면 */
  taskId?: string;
}

export interface CheckResult {
  ok: boolean;
  violations: Violation[];
}

const err = (v: Omit<Violation, "severity">): Violation => ({ severity: "error", ...v });
const warn = (v: Omit<Violation, "severity">): Violation => ({ severity: "warn", ...v });

/** 코드 펜스 안의 내용은 문서 구조가 아니다 — 헤딩 오탐을 막는다. */
function stripFences(text: string): string {
  const out: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      out.push(""); // 줄 번호 보존
      continue;
    }
    out.push(inFence ? "" : line);
  }
  return out.join("\n");
}

function hasSection(text: string, aliases: string[]): boolean {
  const lines = stripFences(text).split("\n");
  return lines.some((line) => {
    const m = /^#{1,6}\s+(.*)$/.exec(line);
    if (!m) return false;
    const heading = m[1].toLowerCase().replace(/[*_`:#]/g, "").trim();
    return aliases.some((a) => heading.includes(a.toLowerCase()));
  });
}

// ─── design-doc.md (명세 §4.2) ────────────────────────────────

/**
 * 필수 섹션. 한국어/영어 별칭을 모두 받는다 — gstack 스킬은 영어로 쓰여 있고
 * 실제 산출은 대화 언어를 따르므로 어느 쪽이 나올지 확정할 수 없다.
 */
const DESIGN_SECTIONS: Array<{ name: string; aliases: string[] }> = [
  { name: "문제 정의", aliases: ["문제", "problem"] },
  { name: "전제", aliases: ["전제", "가정", "assumption", "premise"] },
  { name: "스코프 / 비스코프", aliases: ["스코프", "범위", "scope"] },
  { name: "제약", aliases: ["제약", "constraint"] },
  { name: "수용 기준", aliases: ["수용 기준", "수용기준", "완료 조건", "acceptance"] },
  { name: "아키텍처 결정", aliases: ["아키텍처", "architecture"] },
];

export function checkDesignDoc(text: string): Violation[] {
  const v: Violation[] = [];
  if (!text.trim()) {
    return [err({ file: "design-doc.md", rule: "§4.3", message: "파일이 비어 있습니다" })];
  }
  for (const { name, aliases } of DESIGN_SECTIONS) {
    if (!hasSection(text, aliases)) {
      v.push(
        err({
          file: "design-doc.md",
          rule: "§4.2",
          message: `필수 섹션 누락: ${name} (헤딩으로 존재해야 합니다)`,
        }),
      );
    }
  }
  // 비스코프는 스코프 섹션 안에 있을 수 있으므로 본문에서 찾는다.
  if (!/비\s?스코프|non-?goal|out of scope|범위 외/i.test(text)) {
    v.push(
      warn({
        file: "design-doc.md",
        rule: "§4.2",
        message: "비스코프(Non-Goals) 언급을 찾지 못했습니다 — 스코프만 있으면 스코프 크립의 방어선이 없습니다",
      }),
    );
  }
  return v;
}

// ─── plan.md (명세 §4.2 · §3.4 · AMENDMENTS B4) ───────────────

export type Verification = "deterministic" | "generative";
export type Validation = "visible" | "invisible";

export interface ParsedTask {
  id: string;
  heading: string;
  /** 태스크 본문 (다음 Task 헤딩 전까지) */
  body: string;
  verification?: Verification;
  validation?: Validation;
  /** 태그 라인이 아예 없었는지 */
  hasTagLine: boolean;
}

const TASK_HEADING = /^(#{1,6})[ \t]+Task[ \t]+(\d+)([^0-9].*)?$/;
const TAG_LINE = /^\s*\*\*Tags:\*\*\s*(.+)$/;

export function parseTasks(planText: string): ParsedTask[] {
  const lines = stripFences(planText).split("\n");
  const raw = planText.split("\n");
  const tasks: ParsedTask[] = [];
  let current: { id: string; heading: string; start: number } | null = null;

  const flush = (end: number) => {
    if (!current) return;
    const body = raw.slice(current.start, end).join("\n");
    const tagMatch = body.split("\n").map((l) => TAG_LINE.exec(l)).find(Boolean);
    let verification: Verification | undefined;
    let validation: Validation | undefined;
    if (tagMatch) {
      const spec = tagMatch[1];
      const ver = /verification\s*=\s*([a-z]+)/i.exec(spec)?.[1]?.toLowerCase();
      const val = /validation\s*=\s*([a-z]+)/i.exec(spec)?.[1]?.toLowerCase();
      if (ver === "deterministic" || ver === "generative") verification = ver;
      if (val === "visible" || val === "invisible") validation = val;
    }
    tasks.push({
      id: current.id,
      heading: current.heading,
      body,
      verification,
      validation,
      hasTagLine: Boolean(tagMatch),
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const m = TASK_HEADING.exec(lines[i]);
    if (m) {
      flush(i);
      current = { id: m[2], heading: raw[i].trim(), start: i };
    }
  }
  flush(lines.length);
  return tasks;
}

/**
 * task-brief의 awk가 추출하지 못할 형태의 태스크 헤딩을 찾는다.
 * `### 3. 무엇` 처럼 `Task N` 형식을 안 지킨 헤딩이 있으면 SDD가 시작 못 한다.
 */
function findMalformedTaskHeadings(planText: string): string[] {
  const bad: string[] = [];
  for (const line of stripFences(planText).split("\n")) {
    const m = /^#{1,6}[ \t]+(.*)$/.exec(line);
    if (!m) continue;
    const h = m[1].trim();
    if (TASK_HEADING.test(line)) continue;
    // "태스크 3", "Task3", "3. 무엇" 처럼 태스크를 의도한 듯한 헤딩
    if (/^(태스크|task)\s*\d+/i.test(h) || /^\d+[.)]\s+\S/.test(h)) {
      bad.push(h);
    }
  }
  return bad;
}

export function checkPlan(planText: string): Violation[] {
  const v: Violation[] = [];
  if (!planText.trim()) {
    return [err({ file: "plan.md", rule: "§4.3", message: "파일이 비어 있습니다" })];
  }

  if (!hasSection(planText, ["global constraints", "전역 제약"])) {
    v.push(
      err({
        file: "plan.md",
        rule: "writing-plans 템플릿",
        message:
          "`## Global Constraints` 섹션이 없습니다 — SDD가 리뷰어에게 넘길 attention lens가 사라집니다",
      }),
    );
  }

  for (const h of findMalformedTaskHeadings(planText)) {
    v.push(
      err({
        file: "plan.md",
        rule: "AMENDMENTS B4",
        message: `태스크 헤딩 형식 위반: "${h}" — \`### Task N: ...\` 이어야 task-brief가 추출합니다`,
      }),
    );
  }

  const tasks = parseTasks(planText);
  if (tasks.length === 0) {
    v.push(
      err({
        file: "plan.md",
        rule: "AMENDMENTS B4",
        message: "`### Task N: ...` 형식의 태스크가 하나도 없습니다",
      }),
    );
    return v;
  }

  // 번호 연속성 — task-brief는 번호로 찾으므로 누락되면 조용히 건너뛴다
  const ids = tasks.map((t) => Number(t.id));
  for (let i = 1; i <= Math.max(...ids); i++) {
    if (!ids.includes(i)) {
      v.push(
        err({
          file: "plan.md",
          rule: "AMENDMENTS B4",
          message: `Task ${i}이 없습니다 — 번호가 1..N 연속이어야 합니다 (현재: ${ids.join(",")})`,
        }),
      );
    }
  }
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  for (const d of new Set(dupes)) {
    v.push(
      err({
        file: "plan.md",
        rule: "AMENDMENTS B4",
        taskId: String(d),
        message: `Task ${d}이 중복됩니다 — task-brief가 두 태스크를 한 브리프로 합칩니다`,
      }),
    );
  }

  for (const t of tasks) {
    if (!t.hasTagLine) {
      v.push(
        err({
          file: "plan.md",
          rule: "§3.4",
          taskId: t.id,
          message: `Task ${t.id}: \`**Tags:**\` 라인이 없습니다`,
        }),
      );
      continue;
    }
    if (!t.verification) {
      v.push(
        err({
          file: "plan.md",
          rule: "§3.4",
          taskId: t.id,
          message: `Task ${t.id}: verification 태그가 없거나 값이 잘못됐습니다 (deterministic|generative)`,
        }),
      );
    }
    if (!t.validation) {
      v.push(
        err({
          file: "plan.md",
          rule: "§3.4",
          taskId: t.id,
          message: `Task ${t.id}: validation 태그가 없거나 값이 잘못됐습니다 (visible|invisible)`,
        }),
      );
    }
    // invisible 태스크는 테스트 케이스 목록이 필수 (명세 §3.4)
    if (t.validation === "invisible") {
      const hasCases = /테스트로 증명할 것|test cases? to prove|증명할 것/i.test(t.body);
      const bullets = (t.body.match(/^\s*-\s+\[[ x]\]\s+\S/gim) ?? []).length;
      if (!hasCases) {
        v.push(
          err({
            file: "plan.md",
            rule: "§3.4",
            taskId: t.id,
            message: `Task ${t.id} (invisible): "테스트로 증명할 것" 섹션이 없습니다 — invisible 태스크는 테스트가 유일한 증거입니다`,
          }),
        );
      } else if (bullets === 0) {
        v.push(
          err({
            file: "plan.md",
            rule: "§3.4",
            taskId: t.id,
            message: `Task ${t.id} (invisible): 테스트 케이스 항목이 비어 있습니다`,
          }),
        );
      }
    }
    // generative 태스크는 골든셋 유무가 명기돼야 폴백 판단이 된다
    if (t.verification === "generative" && !/골든셋|golden/i.test(t.body)) {
      v.push(
        warn({
          file: "plan.md",
          rule: "§3.4 폴백",
          taskId: t.id,
          message: `Task ${t.id} (generative): 골든셋 경로나 부재가 명기되지 않았습니다 — builder가 폴백 판단을 못 합니다`,
        }),
      );
    }
  }

  const generative = tasks.filter((t) => t.verification === "generative").length;
  if (tasks.length > 0 && generative / tasks.length > 0.5) {
    v.push(
      warn({
        file: "plan.md",
        rule: "§3.4",
        message: `generative 태스크가 ${generative}/${tasks.length} — 검증 가능성이 낮은 플랜입니다`,
      }),
    );
  }

  return v;
}

// ─── build-result.json (AMENDMENTS A6) ────────────────────────

export type Outcome = "SUCCESS" | "REJECTED" | "BLOCKED";

export interface BuildResult {
  schema: number;
  branch: string;
  outcome: Outcome;
  finished_at?: string;
  tasks_total?: number;
  tasks_done?: number;
  pr_url?: string;
  commits?: string[];
  tests?: { passed: number; failed: number; summary?: string };
  test_cases?: Array<{ task_id: string; case: string; result: string }>;
  screenshots?: string[];
  concerns?: Array<{ task_id: string; note: string }>;
  verification_gaps?: Array<{ task_id: string; reason: string }>;
  defects?: Array<{ task_id: string; plan_text: string; conflict: string; suggested_fix?: string }>;
  blocked?: { task_id: string; reason: string; attempts?: string[] };
}

/**
 * 세션 외부 보고를 검증한다.
 *
 * **파싱 실패를 성공으로 처리하지 않는다** — 이 함수가 위반을 돌려주면
 * 컨트롤러는 BLOCKED로 취급한다. 미완성 태스크가 조용히 PR에 들어가는 것이
 * 이 시스템의 최악 실패 모드다.
 */
export function checkBuildResult(raw: string): CheckResult & { result?: BuildResult } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      violations: [
        err({
          file: "build-result.json",
          rule: "A6",
          message: `JSON 파싱 실패: ${(e as Error).message}`,
        }),
      ],
    };
  }
  const v: Violation[] = [];
  const r = parsed as Partial<BuildResult>;

  if (r === null || typeof r !== "object" || Array.isArray(r)) {
    return {
      ok: false,
      violations: [err({ file: "build-result.json", rule: "A6", message: "최상위가 객체가 아닙니다" })],
    };
  }
  if (r.schema !== 1) {
    v.push(err({ file: "build-result.json", rule: "A6", message: `schema가 1이 아닙니다: ${r.schema}` }));
  }
  if (typeof r.branch !== "string" || !r.branch) {
    v.push(err({ file: "build-result.json", rule: "A6", message: "branch가 없습니다" }));
  }
  const outcomes: Outcome[] = ["SUCCESS", "REJECTED", "BLOCKED"];
  if (!outcomes.includes(r.outcome as Outcome)) {
    v.push(
      err({
        file: "build-result.json",
        rule: "A6",
        message: `outcome이 ${outcomes.join("|")} 중 하나가 아닙니다: ${JSON.stringify(r.outcome)}`,
      }),
    );
    return { ok: false, violations: v };
  }

  switch (r.outcome) {
    case "SUCCESS":
      if (!r.pr_url) {
        v.push(
          err({
            file: "build-result.json",
            rule: "A6",
            message: "SUCCESS인데 pr_url이 없습니다 — PR이 없으면 성공이 아닙니다",
          }),
        );
      }
      if (r.tests && r.tests.failed > 0) {
        v.push(
          err({
            file: "build-result.json",
            rule: "§5.6",
            message: `SUCCESS인데 실패 테스트가 ${r.tests.failed}건입니다`,
          }),
        );
      }
      break;
    case "REJECTED":
      if (!Array.isArray(r.defects) || r.defects.length === 0) {
        v.push(
          err({
            file: "build-result.json",
            rule: "§6.3",
            message: "REJECTED인데 defects[]가 비어 있습니다 — planner가 플랜을 고칠 수 없습니다",
          }),
        );
      }
      break;
    case "BLOCKED":
      if (!r.blocked?.reason) {
        v.push(
          err({ file: "build-result.json", rule: "§6.1", message: "BLOCKED인데 blocked.reason이 없습니다" }),
        );
      }
      if (!r.blocked?.attempts?.length) {
        v.push(
          warn({
            file: "build-result.json",
            rule: "§6.1",
            message: "BLOCKED인데 attempts[]가 없습니다 — 시도 내역 3줄이 명세 요건입니다",
          }),
        );
      }
      break;
  }

  // 검증 공백은 성공해도 보고에 남아야 한다 (명세 §3.4 폴백)
  if (r.outcome === "SUCCESS" && r.verification_gaps?.length) {
    v.push(
      warn({
        file: "build-result.json",
        rule: "§3.4 폴백",
        message: `검증 공백 ${r.verification_gaps.length}건 — 보고 패킷 전면에 표기됩니다`,
      }),
    );
  }

  const ok = !v.some((x) => x.severity === "error");
  return { ok, violations: v, result: ok ? (r as BuildResult) : undefined };
}

// ─── 진입점 ───────────────────────────────────────────────────

/** 빌드 시작 전 게이트 (명세 §4.3). error가 하나라도 있으면 기동하지 않는다. */
export function checkHandoff(designDoc: string, plan: string): CheckResult {
  const violations = [...checkDesignDoc(designDoc), ...checkPlan(plan)];
  return { ok: !violations.some((v) => v.severity === "error"), violations };
}

export function formatViolations(violations: Violation[]): string {
  if (violations.length === 0) return "계약 위반 없음";
  const order: Severity[] = ["error", "warn"];
  return order
    .flatMap((sev) => {
      const group = violations.filter((v) => v.severity === sev);
      if (group.length === 0) return [];
      const icon = sev === "error" ? "✗" : "!";
      return [
        `${icon} ${sev.toUpperCase()} (${group.length})`,
        ...group.map((v) => `   ${v.file} [${v.rule}] ${v.message}`),
      ];
    })
    .join("\n");
}
