import { logger } from "./logger.js";

export type StrategistNotificationKind = "ready" | "failed" | "ivr_ready" | "ivr_failed";

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
