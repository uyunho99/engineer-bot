/**
 * Slack 아웃바운드 (BUILD-PLAN Phase 3-A).
 *
 * 인바운드(planner-bot 이벤트 수신)는 Socket Mode가 필요하고 토큰 결정이
 * 선행돼야 하므로 Phase 3-B다. 아웃바운드만으로도 즉시 가치가 있다 —
 * 빌드 결과가 스레드에 남는다.
 *
 * 의존성 0. `chat.postMessage`는 `thread_ts`를 받으므로 스레드 게시가 되고,
 * webhook은 스레드를 지정할 수 없어 채널 게시만 된다 — 스레드 = 세션인
 * 이 설계(명세 §2)에서는 **봇 토큰 경로가 정답이고 webhook은 폴백이다.**
 */

export interface SlackConfig {
  /** xoxb- 봇 토큰. 스레드 게시에 필요 */
  botToken?: string;
  /** 폴백 — 스레드 지정 불가 */
  webhookUrl?: string;
  defaultChannel?: string;
}

export function configFromEnv(): SlackConfig {
  return {
    botToken: process.env.SLACK_BOT_TOKEN,
    webhookUrl: process.env.SLACK_WEBHOOK_URL,
    defaultChannel: process.env.SLACK_CHANNEL,
  };
}

export interface PostTarget {
  channel?: string;
  /** 스레드 최상단 메시지 ts. 세션의 앵커다 (명세 §2) */
  threadTs?: string;
}

export interface PostResult {
  ok: boolean;
  /** 실제로 전송했는지. dryRun이거나 설정이 없으면 false */
  sent: boolean;
  via: "bot" | "webhook" | "none";
  error?: string;
  ts?: string;
}

/**
 * 메시지를 게시한다.
 *
 * `dryRun`이 true면 아무것도 보내지 않고 무엇을 보낼지만 돌려준다 —
 * 배선 검증용. **설정이 없으면 조용히 성공하지 않는다** (`ok: false`):
 * 보고가 사라진 것을 성공으로 기록하면 게이트 ②가 무력화된다.
 */
export async function post(
  text: string,
  target: PostTarget = {},
  cfg: SlackConfig = configFromEnv(),
  dryRun = process.env.SLACK_DRY_RUN === "1",
): Promise<PostResult> {
  const channel = target.channel ?? cfg.defaultChannel;

  if (dryRun) {
    return { ok: true, sent: false, via: cfg.botToken ? "bot" : cfg.webhookUrl ? "webhook" : "none" };
  }

  if (cfg.botToken) {
    if (!channel) return { ok: false, sent: false, via: "bot", error: "channel이 없습니다" };
    try {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: `Bearer ${cfg.botToken}`,
        },
        body: JSON.stringify({
          channel,
          text,
          thread_ts: target.threadTs,
          unfurl_links: false,
        }),
      });
      const body = (await res.json()) as { ok: boolean; ts?: string; error?: string };
      return { ok: body.ok, sent: body.ok, via: "bot", ts: body.ts, error: body.error };
    } catch (e) {
      return { ok: false, sent: false, via: "bot", error: (e as Error).message };
    }
  }

  if (cfg.webhookUrl) {
    if (target.threadTs) {
      // 스레드 게시가 필요한데 webhook만 있으면 조용히 채널에 흘리지 않는다.
      return {
        ok: false,
        sent: false,
        via: "webhook",
        error: "webhook은 스레드 게시를 지원하지 않습니다 — SLACK_BOT_TOKEN이 필요합니다",
      };
    }
    try {
      const res = await fetch(cfg.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const ok = res.ok;
      return { ok, sent: ok, via: "webhook", error: ok ? undefined : `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, sent: false, via: "webhook", error: (e as Error).message };
    }
  }

  return {
    ok: false,
    sent: false,
    via: "none",
    error: "SLACK_BOT_TOKEN 또는 SLACK_WEBHOOK_URL이 설정되지 않았습니다",
  };
}
