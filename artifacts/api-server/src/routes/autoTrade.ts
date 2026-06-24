import { Router, type IRouter } from "express";
import { db, desc, eq } from "@workspace/db";
import { autoTradeDecisionsTable } from "@workspace/db/schema";
import { isAiModelId } from "@workspace/ai-models";
import { portfolioPrefsUserId } from "../lib/portfolioPreferences.js";
import { getTokens } from "../lib/tokenStore.js";
import { logger } from "../lib/logger.js";
import {
  getAutoTradeConfig,
  saveAutoTradeConfig,
  type AutoTradeConfig,
} from "../lib/autoTrade/config.js";
import { addSymbols, addChartEquitySymbols } from "../lib/schwabStreamer.js";
import { startEngine, stopEngine, engineStatus } from "../engine/index.js";
import { writeConfigPatch } from "../engine/config.js";

const router: IRouter = Router();
const SCHWAB_TRADER_BASE = "https://api.schwabapi.com/trader/v1";

router.get("/config", async (req, res) => {
  const userId = portfolioPrefsUserId(req);
  const config = await getAutoTradeConfig(userId);
  res.json({ config, engine: engineStatus() });
});

router.put("/config", async (req, res) => {
  const userId = portfolioPrefsUserId(req);
  const body = req.body as Partial<AutoTradeConfig>;
  if (body.modelId !== undefined && typeof body.modelId === "string" && !isAiModelId(body.modelId)) {
    return res.status(400).json({ error: "invalid_model_id" });
  }
  try {
    const config = await saveAutoTradeConfig(userId, body);
    // If tickers were updated while the engine is running, subscribe new ones immediately.
    if (body.tickers && engineStatus().running && config.tickers.length > 0) {
      addSymbols(config.tickers);
      addChartEquitySymbols(config.tickers);
    }
    return res.json({ config });
  } catch (err) {
    logger.error({ err, userId }, "autoTrade saveConfig failed");
    return res.status(500).json({ error: "save_failed" });
  }
});

router.post("/start", async (req, res) => {
  const userId = portfolioPrefsUserId(req);
  const token = getTokens("trader")?.accessToken;
  if (!token) {
    return res.status(401).json({ error: "no_trader_token" });
  }
  const config = await getAutoTradeConfig(userId);
  if (!config.accountHash) {
    return res.status(400).json({ error: "no_account_selected" });
  }
  if (!config.tickers.length) {
    return res.status(400).json({ error: "no_tickers" });
  }
  try {
    await saveAutoTradeConfig(userId, { enabled: true });
    // Bridge DB config into config.yaml so the deterministic engine picks it up
    writeConfigPatch({ symbol: config.tickers[0], accountHash: config.accountHash });
    startEngine();
    return res.json({ ok: true, engine: engineStatus() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, userId }, "autoTrade start failed");
    return res.status(500).json({ error: "start_failed", detail: msg });
  }
});

/** Hard kill switch: stop the engine, disable, and cancel any working orders. */
router.post("/stop", async (req, res) => {
  const userId = portfolioPrefsUserId(req);
  stopEngine();
  await saveAutoTradeConfig(userId, { enabled: false });

  let cancelled = 0;
  try {
    const config = await getAutoTradeConfig(userId);
    const token = getTokens("trader")?.accessToken;
    if (token && config.accountHash) {
      cancelled = await cancelWorkingOrders(config.accountHash, token);
    }
  } catch (err) {
    logger.warn({ err, userId }, "autoTrade kill-switch: cancel working orders failed");
  }

  return res.json({ ok: true, cancelledOrders: cancelled });
});

router.get("/status", async (req, res) => {
  const userId = portfolioPrefsUserId(req);
  const config = await getAutoTradeConfig(userId);
  res.json({ config, engine: engineStatus() });
});

router.get("/decisions", async (req, res) => {
  const userId = portfolioPrefsUserId(req);
  try {
    const rows = await db
      .select()
      .from(autoTradeDecisionsTable)
      .where(eq(autoTradeDecisionsTable.userId, userId))
      .orderBy(desc(autoTradeDecisionsTable.createdAt))
      .limit(100);
    res.json(rows);
  } catch (err) {
    logger.error({ err, userId }, "autoTrade decisions fetch failed");
    res.status(500).json({ error: "db_error" });
  }
});

async function cancelWorkingOrders(accountHash: string, token: string): Promise<number> {
  const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const to = new Date(Date.now() + 60 * 1000).toISOString();
  const ordersRes = await fetch(
    `${SCHWAB_TRADER_BASE}/accounts/${accountHash}/orders?fromEnteredTime=${encodeURIComponent(from)}&toEnteredTime=${encodeURIComponent(to)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!ordersRes.ok) return 0;
  const orders = (await ordersRes.json()) as Array<{ orderId?: number | string; status?: string }>;
  const cancellable = new Set(["WORKING", "PENDING_ACTIVATION", "QUEUED", "ACCEPTED", "AWAITING_PARENT_ORDER"]);
  let count = 0;
  for (const o of Array.isArray(orders) ? orders : []) {
    if (!o.orderId || !o.status || !cancellable.has(o.status)) continue;
    const delRes = await fetch(`${SCHWAB_TRADER_BASE}/accounts/${accountHash}/orders/${o.orderId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (delRes.ok) count++;
  }
  return count;
}

export default router;
