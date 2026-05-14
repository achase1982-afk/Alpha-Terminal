import { logger } from "./logger.js";
import type { StrategistV2Result } from "./strategistV2.js";

export type StrategistNotificationKind = "ready" | "failed" | "ivr_ready" | "ivr_failed";

/** Matches telemetry / UI rules for when a desk run produced an actionable trade idea. */
export function deskRecommendationHasTrade(result: StrategistV2Result): boolean {
  if (result.status !== "desk_recommendation" || !result.deskResult) return false;
  const dr = result.deskResult;
  if (dr.mode === "conviction_desk") {
    return (
      dr.conviction != null &&
      dr.conviction.pm.decision === "trade" &&
      dr.conviction.pm.structure != null
    );
  }
  return dr.pm.decision === "trade";
}

function deskTradeStructureLabel(result: StrategistV2Result): string | null {
  if (result.status !== "desk_recommendation" || !result.deskResult) return null;
  const dr = result.deskResult;
  const structure =
    dr.mode === "conviction_desk" ? dr.conviction?.pm.structure ?? null : dr.pm.structure;
  const raw = structure?.type;
  if (!raw || typeof raw !== "string") return null;
  return raw.replace(/_/g, " ");
}

/**
 * Copy for analyze-job completion: distinguish classic Strategist recommendations from desk /
 * conviction-desk results, and pair push body with pm.decision (trade vs pass).
 */
export function buildStrategistAnalyzeCompletionPush(
  result: StrategistV2Result,
  ticker: string,
): {
  notifyKind: Extract<StrategistNotificationKind, "ready" | "failed">;
  notifyMessage: string;
  pushTitle: string;
  pushBody: string;
} {
  const ok = result.status === "recommendation" || result.status === "desk_recommendation";
  if (!ok) {
    return {
      notifyKind: "failed",
      notifyMessage: `Strategist failed for ${ticker}`,
      pushTitle: `Strategist — ${ticker}`,
      pushBody: "Analysis finished with no trade. Open the app for details.",
    };
  }

  if (result.status === "recommendation") {
    return {
      notifyKind: "ready",
      notifyMessage: `Strategist ready for ${ticker}`,
      pushTitle: `Strategist ready — ${ticker}`,
      pushBody: "Analysis finished. Open the app to view the card.",
    };
  }

  const hasTrade = deskRecommendationHasTrade(result);
  const label = hasTrade ? deskTradeStructureLabel(result) : null;
  const tradeBody =
    label != null
      ? `${label.charAt(0).toUpperCase() + label.slice(1)} trade ready. Open the app for details.`
      : "Trade recommendation ready. Open the app for details.";
  return {
    notifyKind: "ready",
    notifyMessage: `Strategist ready for ${ticker}`,
    pushTitle: `Strategist ready — ${ticker}`,
    pushBody: hasTrade ? tradeBody : "Analysis finished with no trade. Open the app for details.",
  };
}

export interface StrategistNotificationEvent {
  kind: StrategistNotificationKind;
  ticker: string;
  jobId?: string | null;
  message: string;
  resultStatus?: string;
}

type Listener = (event: StrategistNotificationEvent) => void | Promise<void>;

const listeners = new Set<Listener>();
const recentEvents: StrategistNotificationEvent[] = [];
const MAX_RECENT_EVENTS = 100;

export function subscribeStrategistNotifications(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRecentStrategistNotifications(): StrategistNotificationEvent[] {
  return [...recentEvents];
}

export function notifyStrategistCompletion(event: StrategistNotificationEvent): void {
  recentEvents.unshift(event);
  if (recentEvents.length > MAX_RECENT_EVENTS) recentEvents.length = MAX_RECENT_EVENTS;

  for (const listener of listeners) {
    Promise.resolve(listener(event)).catch((err) => {
      logger.warn({ err, event }, "Strategist notification listener failed");
    });
  }
}
