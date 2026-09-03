import { describe, expect, test } from "bun:test";
import type { BuildResult } from "./contract";
import { formatContractRejection, formatPacket, formatTransition, hasVisibleWork } from "./report";

const base: BuildResult = {
  schema: 1,
  branch: "feature/persona-list",
  outcome: "SUCCESS",
  pr_url: "https://github.com/o/r/pull/7",
  tasks_total: 3,
  tasks_done: 3,
  tests: { passed: 12, failed: 0, summary: "output pristine" },
};

describe("hasVisibleWork", () => {
  test("스크린샷이 있으면 visible", () => {
    expect(hasVisibleWork({ result: { ...base, screenshots: ["a.png"] } })).toBe(true);
  });

  test("태그에 visible이 있으면 visible", () => {
    expect(hasVisibleWork({ result: base, tasks: [{ id: "1", validation: "visible" }] })).toBe(true);
  });

  test("태그가 전부 invisible이면 false", () => {
    expect(
      hasVisibleWork({
        result: base,
        tasks: [
          { id: "1", validation: "invisible" },
          { id: "2", validation: "invisible" },
        ],
      }),
    ).toBe(false);
  });

  test("정보가 없으면 invisible로 취급한다 — 데모가 있다고 주장하지 않는다", () => {
    expect(hasVisibleWork({ result: base })).toBe(false);
  });
});

describe("SUCCESS 패킷 — visible", () => {
  const packet = formatPacket({
    result: { ...base, screenshots: ["s1.png", "s2.png"] },
    previewUrl: "https://preview.vercel.app",
  });

  test("PR과 데모 URL과 스크린샷 수를 담는다", () => {
    expect(packet).toContain("https://github.com/o/r/pull/7");
    expect(packet).toContain("https://preview.vercel.app");
    expect(packet).toContain("스크린샷 2장");
  });

  test("머지 요청 문구가 있다 — 게이트 ②", () => {
    expect(packet).toContain("직접 머지해주세요");
    expect(packet).toContain("저는 머지하지 않습니다");
  });

  test("테스트 결과를 담는다", () => {
    expect(packet).toContain("12/12");
  });

  test("프리뷰 URL이 없으면 없다고 말한다 — 빈 링크를 내보내지 않는다", () => {
    const p = formatPacket({ result: { ...base, screenshots: ["s.png"] }, previewUrl: null });
    expect(p).toContain("프리뷰 배포 없음");
    expect(p).not.toContain("🌐 데모: \n");
  });
});

describe("SUCCESS 패킷 — invisible-only (명세 §5.6)", () => {
  const invisibleResult: BuildResult = {
    ...base,
    test_cases: [
      { task_id: "1", case: "빈 입력이면 400", result: "pass" },
      { task_id: "1", case: "최신순 정렬", result: "pass" },
    ],
  };
  const tasks = [
    { id: "1", validation: "invisible" as const },
    { id: "2", validation: "invisible" as const },
  ];

  test("데모 URL 대신 커버 케이스를 전면에 놓는다", () => {
    const p = formatPacket({ result: invisibleResult, previewUrl: "https://preview.app", tasks });
    expect(p).not.toContain("https://preview.app");
    expect(p).toContain("커버 케이스 2건");
    expect(p).toContain("빈 입력이면 400");
  });

  test("화면 변경이 없다고 명시한다", () => {
    const p = formatPacket({ result: invisibleResult, tasks });
    expect(p).toContain("화면 변경 없음");
  });

  test("invisible인데 케이스가 없으면 경고한다 — 검증 근거 없음을 숨기지 않는다", () => {
    const p = formatPacket({ result: { ...base, test_cases: [] }, tasks });
    expect(p).toContain("커버 케이스가 보고되지 않았습니다");
  });

  test("실패한 케이스는 ✗로 표시된다", () => {
    const p = formatPacket({
      result: { ...invisibleResult, test_cases: [{ task_id: "2", case: "x", result: "fail" }] },
      tasks,
    });
    expect(p).toContain("✗ [Task 2] x");
  });
});

describe("concerns / 검증 공백", () => {
  test("concerns를 성공 패킷에도 담는다 — 성공이 concern을 지우지 않는다", () => {
    const p = formatPacket({
      result: { ...base, screenshots: ["a.png"], concerns: [{ task_id: "5", note: "파일이 커짐" }] },
    });
    expect(p).toContain("concerns 1건");
    expect(p).toContain("[Task 5] 파일이 커짐");
  });

  test("검증 공백을 전면에 노출한다 (명세 §3.4 폴백)", () => {
    const p = formatPacket({
      result: {
        ...base,
        screenshots: ["a.png"],
        verification_gaps: [{ task_id: "6", reason: "골든셋 없음" }],
      },
    });
    expect(p).toContain("검증 공백 1건");
    expect(p).toContain("[Task 6] 골든셋 없음");
  });
});

describe("REJECTED 패킷 (명세 §6.3)", () => {
  const p = formatPacket({
    result: {
      schema: 1,
      branch: "feature/foo",
      outcome: "REJECTED",
      defects: [
        {
          task_id: "2",
          plan_text: "Task 2는 Task 4의 함수를 쓴다",
          conflict: "Task 4가 Task 2보다 뒤에 있음",
          suggested_fix: "Task 2와 4의 순서를 바꿀 것",
        },
      ],
    },
  });

  test("결함의 플랜 원문과 충돌을 나란히 담는다", () => {
    expect(p).toContain("Task 2는 Task 4의 함수를 쓴다");
    expect(p).toContain("Task 4가 Task 2보다 뒤에 있음");
    expect(p).toContain("Task 2와 4의 순서를 바꿀 것");
  });

  test("플랜을 고치지 않았음을 명시한다", () => {
    expect(p).toContain("플랜은 고치지 않았습니다");
  });

  test("재승인이 필요하다고 말한다 — 이전 승인 재사용 금지", () => {
    expect(p).toContain("재승인");
    expect(p).toContain("이전 승인은 재사용되지 않습니다");
  });

  test("머지 요청 문구는 없다 — 머지할 것이 없다", () => {
    expect(p).not.toContain("직접 머지해주세요");
  });
});

describe("BLOCKED 패킷 (명세 §6.1)", () => {
  const p = formatPacket({
    result: {
      schema: 1,
      branch: "feature/foo",
      outcome: "BLOCKED",
      commits: ["abc1234 feat: 일부"],
      blocked: {
        task_id: "4",
        reason: "외부 API 스펙이 플랜과 다름",
        attempts: ["재디스패치", "상위 모델 재시도", "컨텍스트 보강"],
      },
    },
  });

  test("태스크·사유·시도 내역 3줄을 담는다", () => {
    expect(p).toContain("[4]");
    expect(p).toContain("외부 API 스펙이 플랜과 다름");
    expect(p).toContain("1. 재디스패치");
    expect(p).toContain("3. 컨텍스트 보강");
  });

  test("시도 내역은 3줄로 자른다", () => {
    const many = formatPacket({
      result: {
        schema: 1,
        branch: "b",
        outcome: "BLOCKED",
        blocked: { task_id: "1", reason: "r", attempts: ["a", "b", "c", "d", "e"] },
      },
    });
    expect(many).toContain("3. c");
    expect(many).not.toContain("4. d");
  });

  test("여기까지의 커밋이 남아 있음을 알린다", () => {
    expect(p).toContain("커밋 1개는 브랜치에 남아");
  });

  test("사람의 선택지 3개를 제시한다", () => {
    expect(p).toContain("재개 / 태스크 스킵 / 세션 중단");
  });
});

describe("formatContractRejection (명세 §4.3)", () => {
  test("빌드를 시작하지 않았음을 명시한다", () => {
    const p = formatContractRejection("feature/foo", "✗ ERROR (1)\n   plan.md [§3.4] Tags 없음");
    expect(p).toContain("빌드를 시작하지 않았습니다");
    expect(p).toContain("Tags 없음");
  });
});

describe("formatTransition (명세 §2)", () => {
  test("한 줄이다", () => {
    expect(formatTransition("ENG_REVIEW", "아키텍처 검토 중").split("\n")).toHaveLength(1);
  });

  test("노트가 있으면 붙인다", () => {
    expect(formatTransition("ENG_REVIEW", "아키텍처 검토 중")).toBe("▸ ENG_REVIEW 진입 — 아키텍처 검토 중");
  });

  test("노트가 없으면 상태만", () => {
    expect(formatTransition("BUILDING")).toBe("▸ BUILDING 진입");
  });
});
