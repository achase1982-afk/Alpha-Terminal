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
import { startLlmEngine, stopLlmEngine } from "../engine/llmEngine.js";
import { writeConfigPatch, readRawConfig } from "../engine/config.js";

const router: IRouter = Router();
const SCHWAB_TRADER_BASE = "https://api.schwabapi.com/trader/v1";

type EngineKind = "deterministic" | "llm";

/** Selected engine — persisted in config.yaml (no DB column needed). */
function readEngineKind(): EngineKind {
  return (readRawConfig().engine as string) === "llm" ? "llm" : "deterministic";
}

router.get("/config", async (req, res) => {
  const userId = portfolioPrefsUserId(req);
  const config = await getAutoTradeConfig(userId);
  res.json({ config: { ...config, engine: readEngineKind() }, engine: engineStatus() });
});

router.put("/config", async (req, res) => {
  const userId = portfolioPrefsUserId(req);
  const body = req.body as Partial<AutoTradeConfig>;
  const engineSel = (req.body as { engine?: string }).engine;
  if (body.modelId !== undefined && typeof body.modelId === "string" && !isAiModelId(body.modelId)) {
    return res.status(400).json({ error: "invalid_model_id" });
  }
  if (engineSel !== undefined && engineSel !== "deterministic" && engineSel !== "llm") {
    return res.status(400).json({ error: "invalid_engine" });
  }
  try {
    const config = await saveAutoTradeConfig(userId, body);
    // Engine selection persists to config.yaml (hot-reloaded on START).
    if (engineSel === "deterministic" || engineSel === "llm") {
      writeConfigPatch({ engine: engineSel });
    }
    // If tickers were updated while the engine is running, subscribe new ones immediately.
    if (body.tickers && engineStatus().running && config.tickers.length > 0) {
      addSymbols(config.tickers);
      addChartEquitySymbols(config.tickers);
    }
    return res.json({ config: { ...config, engine: readEngineKind() } });
  } catch (err) {
    logger.error({ err, userId }, "autoTrade saveConfig failed");
    return res.status(500).json({ error: "save_failed" });
  }
});

router.post("/start", async (req, res) => {
  try {
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
    await saveAutoTradeConfig(userId, { enabled: true });
    const engineKind = readEngineKind();
    // Bridge ALL operative UI settings into config.yaml so the selected engine
    // picks them up (hot-reload). Full ticker list — each symbol runs independently.
    writeConfigPatch({
      symbol: config.tickers[0],
      symbols: config.tickers,
      accountHash: config.accountHash,
      engine: engineKind,
      modelId: config.modelId,
      totalBudget: config.totalBudget,
      maxPerTrade: config.maxPerTrade,
      dailyMaxLoss: config.dailyMaxLoss,
      pollIntervalSec: config.pollIntervalSec,
      enableExtendedHours: config.enableExtendedHours,
      flattenAtClose: config.flattenAtClose,
    });
    // START launches the engine the user selected.
    if (engineKind === "llm") startLlmEngine(userId);
    else startEngine(userId);
    return res.json({ ok: true, engine: engineStatus() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "autoTrade start failed");
    return res.status(500).json({ error: "start_failed", detail: msg });
  }
});

/** Hard kill switch: stop the engine, disable, and cancel any working orders. */
router.post("/stop", async (req, res) => {
  const userId = portfolioPrefsUserId(req);
  // Stop whichever engine is running (both are no-ops if not active).
  stopEngine();
  stopLlmEngine();
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
