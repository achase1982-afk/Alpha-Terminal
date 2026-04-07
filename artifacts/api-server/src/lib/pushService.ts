import webpush from "web-push";
import { logger } from "./logger.js";

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = "mailto:admin@alpha-terminal.app";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  logger.info("Web Push VAPID configured");
} else {
  logger.warn("VAPID keys not set — push notifications disabled");
}

export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

const MAX_SUBSCRIPTIONS = 50;
const subscriptions = new Map<string, PushSubscription>();

export function addSubscription(sub: PushSubscription) {
  if (subscriptions.size >= MAX_SUBSCRIPTIONS && !subscriptions.has(sub.endpoint)) {
    const oldest = subscriptions.keys().next().value;
    if (oldest) subscriptions.delete(oldest);
  }
  subscriptions.set(sub.endpoint, sub);
  logger.info({ endpoint: sub.endpoint.slice(-20), total: subscriptions.size }, "Push subscription added");
}

export function removeSubscription(endpoint: string) {
  subscriptions.delete(endpoint);
  logger.info({ endpoint: endpoint.slice(-20), total: subscriptions.size }, "Push subscription removed");
}

export function getSubscriptionCount(): number {
  return subscriptions.size;
}

export async function sendPushToAll(payload: {
  title: string;
  body: string;
  tag?: string;
  data?: Record<string, unknown>;
}) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;
  if (subscriptions.size === 0) return;

  const message = JSON.stringify(payload);
  const stale: string[] = [];

  for (const [endpoint, sub] of subscriptions) {
    try {
      await webpush.sendNotification(sub, message, { TTL: 60 });
    } catch (err: any) {
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        stale.push(endpoint);
      } else {
        logger.warn({ err, endpoint: endpoint.slice(-20) }, "Push send failed");
      }
    }
  }

  for (const ep of stale) {
    subscriptions.delete(ep);
  }

  if (stale.length > 0) {
    logger.info({ removed: stale.length, remaining: subscriptions.size }, "Removed stale push subscriptions");
  }
}
