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
import {
  startAutoTrade,
  stopAutoTrade,
  isAutoTradeRunning,
  autoTradeRunnerInfo,
} from "../lib/autoTrade/engine.js";
import { addSymbols, addChartEquitySymbols } from "../lib/schwabStreamer.js";
import { resolveAccountHash } from "../lib/schwabPortfolioAccounts.js";

const router: IRouter = Router();
const SCHWAB_TRADER_BASE = "https://api.schwabapi.com/trader/v1";

router.get("/config", async (req, res) => {
  const userId = portfolioPrefsUserId(req);
  const config = await getAutoTradeConfig(userId);
  const runner = autoTradeRunnerInfo(userId);
  res.json({ config, runner });
});

router.put("/config", async (req, res) => {
  const userId = portfolioPrefsUserId(req);
  const body = req.body as Partial<AutoTradeConfig>;
  if (body.modelId !== undefined && typeof body.modelId === "string" && !isAiModelId(body.modelId)) {
    return res.status(400).json({ error: "invalid_model_id" });
  }
  try {
    const config = await saveAutoTradeConfig(userId, body);
    // If tickers were updated while the runner is live, subscribe new ones immediately.
    if (body.tickers && isAutoTradeRunning(userId) && config.tickers.length > 0) {
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
  let config = await getAutoTradeConfig(userId);

  // Auto-resolve account hash from Schwab if not set — never block on UI state.
  if (!config.accountHash) {
    const resolved = await resolveAccountHash(token, null).catch(() => null);
    if (resolved) {
      config = await saveAutoTradeConfig(userId, { accountHash: resolved });
      logger.info({ userId, accountHash: resolved }, "autoTrade start: auto-resolved accountHash");
    }
  }

  if (!config.accountHash) {
    return res.status(400).json({ error: "no_account_selected" });
  }
  if (!config.tickers.length) {
    return res.status(400).json({ error: "no_tickers" });
  }
  await saveAutoTradeConfig(userId, { enabled: true });
  await startAutoTrade(userId);
  return res.json({ ok: true, runner: autoTradeRunnerInfo(userId) });
});

/** Hard kill switch: stop the loop, disable, and cancel any working orders. */
router.post("/stop", async (req, res) => {
  const userId = portfolioPrefsUserId(req);
  await stopAutoTrade(userId);
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
  res.json({ config, runner: autoTradeRunnerInfo(userId) });
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
