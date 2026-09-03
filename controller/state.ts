/**
 * 세션 상태 저장소 + 상태 머신 (명세 §2).
 *
 * 스레드 = 세션 = 문서 = 브랜치 1:1:1:1. 이 파일이 그 매핑의 권위다.
 * planner-bot은 stateless 재구성이므로(§3.1 D3) 상태를 스스로 추론하지 않고
 * 여기서 주입받는다.
 *
 * SQLite를 쓰는 이유: 단일 호스트, 동시성 낮음, 의존성 0 (bun 내장).
 * git 트래킹 JSON은 봇 커밋이 레포 이력을 오염시켜 배제했다 (BUILD-PLAN I4).
 */

import { Database } from "bun:sqlite";
import { branchSlug } from "./paths";

export const STATES = [
  "DRAFTING",
  "CEO_REVIEW",
  "ENG_REVIEW",
  "PLAN_READY",
  "STALE",
  "APPROVED",
  "BUILDING",
  "BLOCKED",
  "PR_OPEN",
  "MERGED",
  "REJECTED",
] as const;

export type State = (typeof STATES)[number];

/**
 * 허용 전이. 여기 없는 전이는 예외다.
 *
 * 이 표가 명세 §2의 다이어그램을 기계로 만든 것이고, 게이트 ①·②가
 * "문서상의 약속"이 아니라 코드가 되는 지점이다.
 */
const TRANSITIONS: Record<State, State[]> = {
  DRAFTING: ["CEO_REVIEW"],
  CEO_REVIEW: ["ENG_REVIEW", "DRAFTING"], // ceo-review가 전제를 뒤집으면 기획으로 되돌아간다
  ENG_REVIEW: ["PLAN_READY", "DRAFTING"],
  // 게이트 ① — APPROVED로 가는 유일한 경로. approve()만 이 전이를 만든다.
  PLAN_READY: ["APPROVED", "STALE", "DRAFTING", "ENG_REVIEW"],
  STALE: ["PLAN_READY", "DRAFTING"],
  APPROVED: ["BUILDING"],
  BUILDING: ["PR_OPEN", "BLOCKED", "REJECTED"],
  BLOCKED: ["BUILDING", "REJECTED"], // 사람이 재개시키거나 반송한다
  // 게이트 ② — MERGED로 가는 전이는 사람의 머지 관찰로만 기록된다.
  PR_OPEN: ["MERGED", "BUILDING", "REJECTED"],
  MERGED: [],
  REJECTED: ["DRAFTING", "ENG_REVIEW", "PLAN_READY"], // 플랜 수정 후 게이트 ① 재승인 필요
};

/** PLAN_READY 무응답 리마인드 기준 (명세 §2) */
export const STALE_AFTER_MS = 72 * 60 * 60 * 1000;

export interface Session {
  threadTs: string;
  channel: string;
  branch: string;
  slug: string;
  state: State;
  /** 게이트 ① 승인자. APPROVED 이후에만 채워진다 */
  approvedBy: string | null;
  approvedAt: string | null;
  prUrl: string | null;
  remindedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransitionEvent {
  threadTs: string;
  from: State;
  to: State;
  actor: string;
  note: string | null;
  at: string;
}

export class IllegalTransition extends Error {
  constructor(
    readonly from: State,
    readonly to: State,
  ) {
    super(`허용되지 않는 상태 전이: ${from} → ${to}`);
    this.name = "IllegalTransition";
  }
}

export function canTransition(from: State, to: State): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

const nowIso = () => new Date().toISOString();

export class SessionStore {
  private db: Database;

  constructor(path = process.env.STATE_DB ?? "state.sqlite") {
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        thread_ts   TEXT PRIMARY KEY,
        channel     TEXT NOT NULL,
        branch      TEXT NOT NULL UNIQUE,
        slug        TEXT NOT NULL UNIQUE,
        state       TEXT NOT NULL,
        approved_by TEXT,
        approved_at TEXT,
        pr_url      TEXT,
        reminded_at TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transitions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_ts  TEXT NOT NULL,
        from_state TEXT NOT NULL,
        to_state   TEXT NOT NULL,
        actor      TEXT NOT NULL,
        note       TEXT,
        at         TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_transitions_thread ON transitions(thread_ts);
    `);
  }

  close(): void {
    this.db.close();
  }

  private row(r: Record<string, unknown> | null): Session | null {
    if (!r) return null;
    return {
      threadTs: r.thread_ts as string,
      channel: r.channel as string,
      branch: r.branch as string,
      slug: r.slug as string,
      state: r.state as State,
      approvedBy: (r.approved_by as string) ?? null,
      approvedAt: (r.approved_at as string) ?? null,
      prUrl: (r.pr_url as string) ?? null,
      remindedAt: (r.reminded_at as string) ?? null,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    };
  }

  /** 스레드 시작 — DRAFTING으로 세션을 만든다. */
  create(threadTs: string, channel: string, branch: string): Session {
    const slug = branchSlug(branch);
    const at = nowIso();
    this.db
      .query(
        `INSERT INTO sessions (thread_ts, channel, branch, slug, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'DRAFTING', ?, ?)`,
      )
      .run(threadTs, channel, branch, slug, at, at);
    return this.get(threadTs)!;
  }

  get(threadTs: string): Session | null {
    return this.row(
      this.db.query("SELECT * FROM sessions WHERE thread_ts = ?").get(threadTs) as Record<
        string,
        unknown
      > | null,
    );
  }

  byBranch(branch: string): Session | null {
    return this.row(
      this.db.query("SELECT * FROM sessions WHERE branch = ?").get(branch) as Record<
        string,
        unknown
      > | null,
    );
  }

  list(state?: State): Session[] {
    const rows = state
      ? this.db.query("SELECT * FROM sessions WHERE state = ? ORDER BY updated_at DESC").all(state)
      : this.db.query("SELECT * FROM sessions ORDER BY updated_at DESC").all();
    return (rows as Record<string, unknown>[]).map((r) => this.row(r)!);
  }

  history(threadTs: string): TransitionEvent[] {
    const rows = this.db
      .query("SELECT * FROM transitions WHERE thread_ts = ? ORDER BY id ASC")
      .all(threadTs) as Record<string, unknown>[];
    return rows.map((r) => ({
      threadTs: r.thread_ts as string,
      from: r.from_state as State,
      to: r.to_state as State,
      actor: r.actor as string,
      note: (r.note as string) ?? null,
      at: r.at as string,
    }));
  }

  /**
   * 상태 전이. 허용되지 않으면 던진다.
   *
   * 던지는 쪽이 옳다 — 잘못된 전이를 조용히 무시하면 게이트가 무력화된다.
   */
  transition(threadTs: string, to: State, actor: string, note?: string): Session {
    const s = this.get(threadTs);
    if (!s) throw new Error(`세션이 없습니다: ${threadTs}`);
    if (!canTransition(s.state, to)) throw new IllegalTransition(s.state, to);
    if (to === "APPROVED") {
      throw new Error("APPROVED로의 전이는 approve()만 수행할 수 있습니다 (게이트 ①)");
    }
    const at = nowIso();
    this.db.transaction(() => {
      this.db
        .query("UPDATE sessions SET state = ?, updated_at = ?, reminded_at = NULL WHERE thread_ts = ?")
        .run(to, at, threadTs);
      this.db
        .query(
          "INSERT INTO transitions (thread_ts, from_state, to_state, actor, note, at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(threadTs, s.state, to, actor, note ?? null, at);
    })();
    return this.get(threadTs)!;
  }

  /**
   * 게이트 ① (명세 §3.5) — 사람의 명시 승인만이 builder-bot을 기동시킨다.
   *
   * `approver`가 비면 거부한다. planner-bot이 자기 이름으로 호출하는 것을
   * 코드로 막을 수는 없지만, **승인자가 기록에 남으므로 감사 가능하다.**
   * 실제 차단은 planner 프로세스에 이 경로를 배선하지 않는 것으로 한다
   * (BUILD-PLAN Phase 3-C).
   */
  approve(threadTs: string, approver: string, note?: string): Session {
    if (!approver.trim()) {
      throw new Error("승인자가 비어 있습니다 — 게이트 ①은 사람의 명시 발화만 통과시킵니다");
    }
    const s = this.get(threadTs);
    if (!s) throw new Error(`세션이 없습니다: ${threadTs}`);
    if (!canTransition(s.state, "APPROVED")) throw new IllegalTransition(s.state, "APPROVED");
    const at = nowIso();
    this.db.transaction(() => {
      this.db
        .query(
          "UPDATE sessions SET state = 'APPROVED', approved_by = ?, approved_at = ?, updated_at = ? WHERE thread_ts = ?",
        )
        .run(approver, at, at, threadTs);
      this.db
        .query(
          "INSERT INTO transitions (thread_ts, from_state, to_state, actor, note, at) VALUES (?, ?, 'APPROVED', ?, ?, ?)",
        )
        .run(threadTs, s.state, approver, note ?? null, at);
    })();
    return this.get(threadTs)!;
  }

  setPrUrl(threadTs: string, prUrl: string): void {
    this.db
      .query("UPDATE sessions SET pr_url = ?, updated_at = ? WHERE thread_ts = ?")
      .run(prUrl, nowIso(), threadTs);
  }

  markReminded(threadTs: string): void {
    this.db
      .query("UPDATE sessions SET reminded_at = ?, updated_at = ? WHERE thread_ts = ?")
      .run(nowIso(), nowIso(), threadTs);
  }

  /**
   * 리마인드 대상 (명세 §2): PLAN_READY 72시간 무응답 + 아직 리마인드 안 한 세션.
   * 리마인드는 **1회**다. 그 후 STALE 표기이며 자동 진행은 없다.
   */
  needsReminder(now = Date.now()): Session[] {
    return this.list("PLAN_READY").filter(
      (s) => s.remindedAt === null && now - Date.parse(s.updatedAt) >= STALE_AFTER_MS,
    );
  }

  /** 재승인이 필요한지 — REJECTED를 거친 세션은 이전 승인을 재사용할 수 없다 (명세 §6.3) */
  needsReapproval(threadTs: string): boolean {
    const h = this.history(threadTs);
    const lastApproval = h.findLastIndex((e) => e.to === "APPROVED");
    const lastReject = h.findLastIndex((e) => e.to === "REJECTED");
    if (lastApproval === -1) return true;
    return lastReject > lastApproval;
  }
}
