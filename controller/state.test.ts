import { beforeEach, describe, expect, test } from "bun:test";
import { IllegalTransition, SessionStore, STALE_AFTER_MS, canTransition } from "./state";

let store: SessionStore;
const TS = "1753000000.000100";
const CH = "C_DCX";

beforeEach(() => {
  store = new SessionStore(":memory:");
});

const seed = (branch = "feature/persona-list") => store.create(TS, CH, branch);

/** 승인까지 정상 경로로 데려간다 */
function toPlanReady() {
  seed();
  store.transition(TS, "CEO_REVIEW", "planner-bot");
  store.transition(TS, "ENG_REVIEW", "planner-bot");
  store.transition(TS, "PLAN_READY", "planner-bot");
}

describe("canTransition", () => {
  test("명세 §2의 정상 경로를 허용한다", () => {
    expect(canTransition("DRAFTING", "CEO_REVIEW")).toBe(true);
    expect(canTransition("ENG_REVIEW", "PLAN_READY")).toBe(true);
    expect(canTransition("APPROVED", "BUILDING")).toBe(true);
    expect(canTransition("BUILDING", "PR_OPEN")).toBe(true);
    expect(canTransition("PR_OPEN", "MERGED")).toBe(true);
  });

  test("단계를 건너뛰는 전이를 막는다", () => {
    expect(canTransition("DRAFTING", "PLAN_READY")).toBe(false);
    expect(canTransition("DRAFTING", "BUILDING")).toBe(false);
    expect(canTransition("PLAN_READY", "BUILDING")).toBe(false);
    expect(canTransition("PLAN_READY", "PR_OPEN")).toBe(false);
  });

  test("MERGED는 종착지다", () => {
    expect(canTransition("MERGED", "BUILDING")).toBe(false);
    expect(canTransition("MERGED", "DRAFTING")).toBe(false);
  });

  test("BUILDING에서 반송과 BLOCKED가 가능하다 (§6.1 · §6.3)", () => {
    expect(canTransition("BUILDING", "REJECTED")).toBe(true);
    expect(canTransition("BUILDING", "BLOCKED")).toBe(true);
  });

  test("BLOCKED는 재개되거나 반송된다 — 스스로 PR로 가지 않는다", () => {
    expect(canTransition("BLOCKED", "BUILDING")).toBe(true);
    expect(canTransition("BLOCKED", "REJECTED")).toBe(true);
    expect(canTransition("BLOCKED", "PR_OPEN")).toBe(false);
  });
});

describe("create / get", () => {
  test("DRAFTING으로 시작하고 슬러그를 유도한다", () => {
    const s = seed("feature/persona-list");
    expect(s.state).toBe("DRAFTING");
    expect(s.slug).toBe("feature-persona-list");
    expect(s.approvedBy).toBeNull();
  });

  test("브랜치로도 조회된다 — builder의 유일한 입력이 브랜치명이다", () => {
    seed("feature/foo");
    expect(store.byBranch("feature/foo")?.threadTs).toBe(TS);
  });

  test("같은 브랜치로 두 세션을 만들 수 없다 — 1:1:1:1 (명세 §2)", () => {
    seed("feature/foo");
    expect(() => store.create("1753000001.000200", CH, "feature/foo")).toThrow();
  });

  test("경로 이스케이프를 시도하는 브랜치명은 거부된다", () => {
    expect(() => store.create(TS, CH, "../../etc/passwd")).toThrow();
  });
});

describe("transition", () => {
  test("정상 전이는 상태를 바꾸고 이력을 남긴다", () => {
    seed();
    const s = store.transition(TS, "CEO_REVIEW", "planner-bot", "스코프 도전 시작");
    expect(s.state).toBe("CEO_REVIEW");
    const h = store.history(TS);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ from: "DRAFTING", to: "CEO_REVIEW", actor: "planner-bot" });
  });

  test("허용되지 않는 전이는 던진다 — 조용히 무시하지 않는다", () => {
    seed();
    expect(() => store.transition(TS, "BUILDING", "planner-bot")).toThrow(IllegalTransition);
  });

  test("실패한 전이는 상태를 바꾸지 않고 이력도 남기지 않는다", () => {
    seed();
    expect(() => store.transition(TS, "PR_OPEN", "x")).toThrow();
    expect(store.get(TS)!.state).toBe("DRAFTING");
    expect(store.history(TS)).toHaveLength(0);
  });

  test("transition()으로는 APPROVED에 갈 수 없다 — 게이트 ①은 approve()만이다", () => {
    toPlanReady();
    expect(() => store.transition(TS, "APPROVED", "planner-bot")).toThrow(/approve\(\)/);
    expect(store.get(TS)!.state).toBe("PLAN_READY");
  });

  test("없는 세션에 전이하면 던진다", () => {
    expect(() => store.transition("nope", "CEO_REVIEW", "x")).toThrow(/세션이 없습니다/);
  });
});

describe("approve — 게이트 ① (명세 §3.5)", () => {
  test("승인자를 기록하며 APPROVED로 간다", () => {
    toPlanReady();
    const s = store.approve(TS, "U_YUNHO", "이 플랜으로 빌드해");
    expect(s.state).toBe("APPROVED");
    expect(s.approvedBy).toBe("U_YUNHO");
    expect(s.approvedAt).not.toBeNull();
  });

  test("승인자가 비면 거부한다 — 익명 승인은 게이트가 아니다", () => {
    toPlanReady();
    expect(() => store.approve(TS, "   ")).toThrow(/승인자/);
    expect(store.get(TS)!.state).toBe("PLAN_READY");
  });

  test("PLAN_READY가 아닌 상태에서는 승인할 수 없다", () => {
    seed();
    expect(() => store.approve(TS, "U_YUNHO")).toThrow(IllegalTransition);
  });

  test("승인 후에야 BUILDING으로 갈 수 있다", () => {
    toPlanReady();
    store.approve(TS, "U_YUNHO");
    expect(store.transition(TS, "BUILDING", "builder-bot").state).toBe("BUILDING");
  });
});

describe("needsReapproval — 반송 후 재승인 (명세 §6.3)", () => {
  test("승인 이력이 없으면 true", () => {
    toPlanReady();
    expect(store.needsReapproval(TS)).toBe(true);
  });

  test("승인 직후에는 false", () => {
    toPlanReady();
    store.approve(TS, "U_YUNHO");
    expect(store.needsReapproval(TS)).toBe(false);
  });

  test("반송되면 다시 true — 이전 승인을 재사용할 수 없다", () => {
    toPlanReady();
    store.approve(TS, "U_YUNHO");
    store.transition(TS, "BUILDING", "builder-bot");
    store.transition(TS, "REJECTED", "builder-bot", "플랜 결함");
    expect(store.needsReapproval(TS)).toBe(true);
  });

  test("반송 후 재승인하면 다시 false", () => {
    toPlanReady();
    store.approve(TS, "U_YUNHO");
    store.transition(TS, "BUILDING", "builder-bot");
    store.transition(TS, "REJECTED", "builder-bot");
    store.transition(TS, "PLAN_READY", "planner-bot", "플랜 수정 완료");
    store.approve(TS, "U_YUNHO", "재승인");
    expect(store.needsReapproval(TS)).toBe(false);
  });
});

describe("needsReminder — PLAN_READY 정체 (명세 §2)", () => {
  test("72시간 전이면 대상이 아니다", () => {
    toPlanReady();
    expect(store.needsReminder(Date.now() + STALE_AFTER_MS - 1000)).toHaveLength(0);
  });

  test("72시간 경과하면 대상이다", () => {
    toPlanReady();
    expect(store.needsReminder(Date.now() + STALE_AFTER_MS + 1000)).toHaveLength(1);
  });

  test("리마인드는 1회다 — 표기 후 다시 뜨지 않는다", () => {
    toPlanReady();
    store.markReminded(TS);
    expect(store.needsReminder(Date.now() + STALE_AFTER_MS * 10)).toHaveLength(0);
  });

  test("PLAN_READY가 아닌 상태는 대상이 아니다", () => {
    toPlanReady();
    store.approve(TS, "U_YUNHO");
    expect(store.needsReminder(Date.now() + STALE_AFTER_MS * 10)).toHaveLength(0);
  });
});

describe("list / setPrUrl", () => {
  test("상태로 필터한다", () => {
    seed("feature/a");
    store.create("1753000002.000300", CH, "feature/b");
    store.transition("1753000002.000300", "CEO_REVIEW", "planner-bot");
    expect(store.list("DRAFTING").map((s) => s.branch)).toEqual(["feature/a"]);
    expect(store.list("CEO_REVIEW").map((s) => s.branch)).toEqual(["feature/b"]);
  });

  test("PR URL이 기록된다 — 게이트 ②의 대상", () => {
    seed();
    store.setPrUrl(TS, "https://github.com/o/r/pull/7");
    expect(store.get(TS)!.prUrl).toBe("https://github.com/o/r/pull/7");
  });
});
