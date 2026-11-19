import { Router, type IRouter } from "express";
import { logger } from "../lib/logger.js";
import { webullCreateToken, webullCheckToken } from "../lib/webull/webullClient.js";
import {
  clearWebullToken,
  getWebullToken,
  persistWebullToken,
  webullCredentialsConfigured,
  type WebullTokenStatus,
} from "../lib/webull/webullTokenStore.js";

const router: IRouter = Router();

router.get("/status", async (_req, res) => {
  if (!webullCredentialsConfigured()) {
    return res.json({ configured: false, connected: false, status: "NONE" });
  }
  const stored = await getWebullToken();
  if (!stored) {
    return res.json({ configured: true, connected: false, status: "NONE" });
  }
  try {
    const checked = await webullCheckToken(stored.accessToken);
    const status = (checked.status ?? stored.status) as WebullTokenStatus;
    const next = {
      accessToken: stored.accessToken,
      expiresAt: Number(checked.expires_at ?? stored.expiresAt),
      status,
    };
    await persistWebullToken(next);
    return res.json({
      configured: true,
      connected: status === "NORMAL",
      status,
      expiresAt: next.expiresAt,
    });
  } catch (err) {
    logger.warn({ err }, "Webull status check failed");
    return res.json({
      configured: true,
      connected: stored.status === "NORMAL",
      status: stored.status,
      expiresAt: stored.expiresAt,
    });
  }
});

/** Explicit user action — triggers Webull 2FA push; never call on boot. */
router.post("/connect", async (_req, res) => {
  if (!webullCredentialsConfigured()) {
    return res.status(503).json({ error: "webull_not_configured" });
  }
  try {
    const created = await webullCreateToken();
    await persistWebullToken({
      accessToken: created.token,
      expiresAt: Number(created.expires_at),
      status: (created.status as WebullTokenStatus) ?? "PENDING",
    });
    return res.json({
      status: created.status,
      expiresAt: created.expires_at,
      message: "Approve the Webull OpenAPI verification in the app within 5 minutes.",
    });
  } catch (err) {
    logger.error({ err }, "Webull connect failed");
    return res.status(502).json({ error: "webull_connect_failed" });
  }
});

router.post("/disconnect", async (_req, res) => {
  await clearWebullToken();
  return res.json({ success: true });
});

export default router;