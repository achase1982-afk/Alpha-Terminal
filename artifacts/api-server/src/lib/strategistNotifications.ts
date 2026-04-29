import { logger } from "./logger.js";
import { sendPushToAll } from "./pushService.js";

export type StrategistNotificationKind = "ready" | "failed" | "ivr_ready" | "ivr_failed";

export interface StrategistNotificationEvent {
  kind: StrategistNotificationKind;
  ticker: string;
  jobId?: string | null;
  message: string;
  resultStatus?: string;
  createdAt?: string;
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
  const stamped = { ...event, createdAt: event.createdAt ?? new Date().toISOString() };
  recentEvents.unshift(stamped);
  if (recentEvents.length > MAX_RECENT_EVENTS) recentEvents.length = MAX_RECENT_EVENTS;

  for (const listener of listeners) {
    Promise.resolve(listener(stamped)).catch((err) => {
      logger.warn({ err, event: stamped }, "Strategist notification listener failed");
    });
  }

  void sendPushToAll({
    title: "Alpha Terminal",
    body: stamped.message,
    tag: `strategist-${stamped.jobId ?? stamped.ticker}`,
    data: {
      type: "strategist",
      ticker: stamped.ticker,
      jobId: stamped.jobId ?? null,
      kind: stamped.kind,
      resultStatus: stamped.resultStatus ?? null,
      url: `/?tab=ai&aiTab=strategist&symbol=${encodeURIComponent(stamped.ticker)}`,
    },
  });
}
