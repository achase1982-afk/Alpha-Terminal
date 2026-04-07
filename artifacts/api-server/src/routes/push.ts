import { Router, type IRouter } from "express";
import { addSubscription, removeSubscription, getSubscriptionCount, type PushSubscription } from "../lib/pushService.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.post("/subscribe", (req, res) => {
  const sub = req.body as PushSubscription;

  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return res.status(400).json({ error: "Invalid push subscription" });
  }

  addSubscription(sub);
  res.json({ success: true, total: getSubscriptionCount() });
});

router.post("/unsubscribe", (req, res) => {
  const { endpoint } = req.body as { endpoint?: string };

  if (!endpoint) {
    return res.status(400).json({ error: "Missing endpoint" });
  }

  removeSubscription(endpoint);
  res.json({ success: true });
});

router.get("/vapid-key", (_req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY ?? "";
  if (!key) {
    return res.status(500).json({ error: "VAPID key not configured" });
  }
  res.json({ publicKey: key });
});

router.post("/test", async (_req, res) => {
  const { sendPushToAll } = await import("../lib/pushService.js");
  try {
    await sendPushToAll({
      title: "ALPHA TERMINAL",
      body: "Push notifications are working",
      tag: "test",
    });
    res.json({ success: true, subscribers: getSubscriptionCount() });
  } catch (err) {
    logger.error({ err }, "Test push failed");
    res.status(500).json({ error: "Push test failed" });
  }
});

export default router;
