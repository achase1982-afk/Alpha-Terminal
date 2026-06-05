import { Router, type IRouter } from "express";
import { getTokens } from "../lib/tokenStore.js";
import { logger } from "../lib/logger.js";
import { broadcastToClients } from "../lib/wsServer.js";
import { sendPushToAll } from "../lib/pushService.js";
import { markAlertSeen } from "../lib/schwabStreamer.js";
import {
  fetchMappedSchwabAccounts,
  fetchAccountNumberRows,
  resolveAccountHash,
  schwabTraderGet,
} from "../lib/schwabPortfolioAccounts.js";
import {
  getPortfolioPrefs,
  savePortfolioPrefs,
  portfolioPrefsUserId,
} from "../lib/portfolioPreferences.js";
import { db } from "@workspace/db";
import { tradeJournalTable } from "@workspace/db/schema";

const router: IRouter = Router();

/** Schwab order body fragment we read after placement (forwarded JSON). */
interface SchwabOrderLegInstrument {
  symbol?: string;
}

interface SchwabOrderLeg {
  instruction?: string;
  quantity?: number;
  instrument?: SchwabOrderLegInstrument;
}

interface SchwabPlaceOrderBody extends Record<string, unknown> {
  orderLegCollection?: SchwabOrderLeg[];
}

/** Client-supplied journal metadata when logging a trade alongside an order. */
interface TradeJournalContextPayload {
  symbol?: string;
  strategyType?: string | null;
  direction?: string;
  pulseComposite?: number | null;
  pulseConfidence?: number | null;
  pulseBias?: string | null;
  scannerScore?: number | null;
  tradingMode?: number | null;
  tradingModeLabel?: string | null;
  eventConflicts?: unknown;
  ivr?: number | null;
  entryPrice?: number | null;
  isCredit?: boolean | null;
  maxLoss?: number | null;
  maxGain?: number | null;
  thesis?: string | null;
  legs?: unknown;
  quantity?: number | null;
}

const SCHWAB_TRADER_BASE = "https://api.schwabapi.com/trader/v1";

let accountsCache: { data: any; fetchedAt: number } | null = null;
const ACCOUNTS_CACHE_TTL = 20_000;

function getTraderToken(): string | null {
  const trader = getTokens("trader");
  return trader?.accessToken ?? null;
}

router.get("/accounts", async (_req, res) => {
  const token = getTraderToken();
  if (!token) return res.status(401).json({ error: "no_trader_token" });

  if (accountsCache && (Date.now() - accountsCache.fetchedAt) < ACCOUNTS_CACHE_TTL) {
    return res.json(accountsCache.data);
  }

  try {
    const mapped = await fetchMappedSchwabAccounts(token);
    accountsCache = { data: mapped, fetchedAt: Date.now() };
    return res.json(mapped);
  } catch (err) {
    logger.error({ err }, "Portfolio accounts fetch failed");
    if (accountsCache) return res.json(accountsCache.data);
    return res.status(502).json({ error: "schwab_api_error" });
  }
});

router.get("/account-numbers", async (_req, res) => {
  const token = getTraderToken();
  if (!token) return res.status(401).json({ error: "no_trader_token" });
  try {
    const rows = await fetchAccountNumberRows(token);
    return res.json(rows);
  } catch (err) {
    logger.error({ err }, "Account numbers fetch failed");
    return res.status(502).json({ error: "schwab_api_error" });
  }
});

router.get("/preferences", async (req, res) => {
  const userId = portfolioPrefsUserId(req);
  const prefs = await getPortfolioPrefs(userId);
  return res.json(prefs);
});

router.put("/preferences", async (req, res) => {
  const userId = portfolioPrefsUserId(req);
  const body = req.body as {
    viewSelection?: string;
    defaultTradingAccountHash?: string | null;
    hideBalances?: boolean;
  };
  const prefs = await savePortfolioPrefs(userId, body);
  return res.json(prefs);
});

router.get("/accounts/raw-balances", async (_req, res) => {
  const token = getTraderToken();
  if (!token) return res.status(401).json({ error: "no_trader_token" });

  try {
    const accounts = await schwabTraderGet("/accounts?fields=positions", token, 2);
    const raw = accounts.map((acct: any) => {
      const sa = acct.securitiesAccount;
      return {
        accountType: sa.type,
        currentBalances: sa.currentBalances,
        initialBalances: sa.initialBalances,
        projectedBalances: sa.projectedBalances,
      };
    });
    return res.json(raw);
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
});

router.get("/orders", async (req, res) => {
  const token = getTraderToken();
  if (!token) return res.status(401).json({ error: "no_trader_token" });

  try {
    const userId = portfolioPrefsUserId(req);
    const prefs = await getPortfolioPrefs(userId);
    const requested =
      typeof req.query.accountHash === "string"
        ? req.query.accountHash
        : prefs.viewSelection !== "all"
          ? prefs.viewSelection
          : prefs.defaultTradingAccountHash;
    const hash = await resolveAccountHash(token, requested);
    if (!hash) return res.json([]);

    const days = parseInt(req.query.days as string) || 30;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - Math.min(days, 60));

    const orders = await schwabTraderGet(
      `/accounts/${hash}/orders?fromEnteredTime=${start.toISOString()}&toEnteredTime=${end.toISOString()}`,
      token
    );

    const mapped = (Array.isArray(orders) ? orders : []).map((o: any) => {
      const legs = (o.orderLegCollection ?? []).map((leg: any) => ({
        instruction: leg.instruction,
        quantity: leg.quantity,
        symbol: leg.instrument?.symbol,
        underlyingSymbol: leg.instrument?.underlyingSymbol ?? leg.instrument?.symbol,
        assetType: leg.instrument?.assetType,
        putCall: leg.instrument?.putCall ?? null,
        description: leg.instrument?.description ?? leg.instrument?.symbol,
      }));

      const fills = (o.orderActivityCollection ?? []).flatMap((act: any) =>
        (act.executionLegs ?? []).map((el: any) => ({
          legId: el.legId,
          price: el.price,
          quantity: el.quantity,
          time: el.time,
        }))
      );

      return {
        orderId: o.orderId,
        orderType: o.orderType,
        session: o.session,
        duration: o.duration,
        status: o.status,
        filledQuantity: o.filledQuantity ?? 0,
        remainingQuantity: o.remainingQuantity ?? 0,
        price: o.price ?? o.stopPrice ?? null,
        complexStrategy: o.complexOrderStrategyType ?? "NONE",
        enteredTime: o.enteredTime,
        closeTime: o.closeTime ?? null,
        legs,
        fills,
        tag: o.tag ?? null,
      };
    });

    mapped.sort((a: any, b: any) =>
      new Date(b.enteredTime).getTime() - new Date(a.enteredTime).getTime()
    );

    res.json(mapped);
    return;
  } catch (err) {
    logger.error({ err }, "Portfolio orders fetch failed");
    return res.status(502).json({ error: "schwab_api_error" });
  }
});

router.get("/transactions", async (req, res) => {
  const token = getTraderToken();
  if (!token) return res.status(401).json({ error: "no_trader_token" });

  try {
    const requested =
      typeof req.query.accountHash === "string" ? req.query.accountHash : null;
    const hash = await resolveAccountHash(token, requested);
    if (!hash) return res.json([]);

    const days = parseInt(req.query.days as string) || 30;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - Math.min(days, 365));

    const txns = await schwabTraderGet(
      `/accounts/${hash}/transactions?startDate=${start.toISOString()}&endDate=${end.toISOString()}&types=TRADE`,
      token
    );

    const mapped = (Array.isArray(txns) ? txns : []).map((t: any) => ({
      transactionId: t.transactionId,
      type: t.type,
      subAccount: t.subAccount,
      tradeDate: t.tradeDate,
      settlementDate: t.settlementDate,
      netAmount: t.netAmount ?? 0,
      description: t.description,
      transactionItem: t.transactionItem
        ? {
            instruction: t.transactionItem.instruction,
            amount: t.transactionItem.amount,
            price: t.transactionItem.price,
            symbol: t.transactionItem.instrument?.symbol,
            assetType: t.transactionItem.instrument?.assetType,
          }
        : null,
    }));

    res.json(mapped);
    return;
  } catch (err) {
    logger.error({ err }, "Portfolio transactions fetch failed");
    return res.status(502).json({ error: "schwab_api_error" });
  }
});

router.get("/account-hash", async (req, res) => {
  const token = getTraderToken();
  if (!token) return res.status(401).json({ error: "no_trader_token" });

  try {
    const requested =
      typeof req.query.accountHash === "string" ? req.query.accountHash : null;
    const hash = await resolveAccountHash(token, requested);
    if (!hash) return res.status(404).json({ error: "no_accounts" });
    return res.json({ hashValue: hash });
  } catch (err) {
    logger.error({ err }, "Account hash fetch failed");
    return res.status(502).json({ error: "schwab_api_error" });
  }
});

router.post("/place-order", async (req, res) => {
  const token = getTraderToken();
  if (!token) return res.status(401).json({ error: "no_trader_token" });

  const { accountHash, order, journalContext } = req.body as {
    accountHash: string;
    order: SchwabPlaceOrderBody;
    journalContext?: TradeJournalContextPayload;
  };

  if (!accountHash || !order) {
    return res.status(400).json({ error: "Missing accountHash or order" });
  }

  try {
    const NO_PRICE_TYPES = new Set(["MARKET", "STOP", "TRAILING_STOP", "MARKET_ON_CLOSE"]);
    if (typeof order.orderType === "string" && NO_PRICE_TYPES.has(order.orderType)) {
      delete order.price;
    }
    if (order.price != null && (typeof order.price !== "number" || order.price <= 0 || !isFinite(order.price))) {
      delete order.price;
    }
    logger.info({ order }, "Placing Schwab order");
    const schwabRes = await fetch(
      `${SCHWAB_TRADER_BASE}/accounts/${accountHash}/orders`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(order),
      }
    );

    if (!schwabRes.ok) {
      const body = await schwabRes.text().catch(() => "");
      logger.error({ status: schwabRes.status, body: body.slice(0, 500) }, "Schwab order placement failed");
      return res.status(schwabRes.status).json({
        error: "order_rejected",
        message: body.slice(0, 500),
      });
    }

    const locationHeader = schwabRes.headers.get("location") ?? "";
    const orderIdMatch = locationHeader.match(/orders\/(\d+)/);
    const orderId = orderIdMatch ? orderIdMatch[1] : null;

    const legs = order.orderLegCollection ?? [];
    const firstLeg = legs[0] ?? {};
    const sym = firstLeg?.instrument?.symbol ?? "";
    const side = firstLeg?.instruction ?? "";
    const qty = firstLeg?.quantity ?? "";

    if (orderId) {
      markAlertSeen(orderId, "OrderCreated");
      markAlertSeen(orderId, "OrderAccepted");
    }

    broadcastToClients("orderAlert", {
      type: "OrderCreated",
      symbol: sym,
      side,
      quantity: String(qty),
      orderId,
      status: "CREATED",
      timestamp: Date.now(),
      raw: "",
    });

    void sendPushToAll({
      title: "ALPHA TERMINAL",
      body: `${side} ${qty} ${sym} order PLACED`.trim(),
      tag: "OrderCreated",
      data: { orderId, symbol: sym },
    });

    if (journalContext && orderId) {
      try {
        const jc = journalContext;
        await db.insert(tradeJournalTable).values({
          schwabOrderId: orderId,
          symbol: jc.symbol ?? sym,
          strategyType: jc.strategyType ?? null,
          direction: jc.direction ?? side,
          pulseComposite: jc.pulseComposite ?? null,
          pulseConfidence: jc.pulseConfidence ?? null,
          pulseBias: jc.pulseBias ?? null,
          scannerScore: jc.scannerScore ?? null,
          tradingMode: jc.tradingMode ?? null,
          tradingModeLabel: jc.tradingModeLabel ?? null,
          eventConflicts: jc.eventConflicts ?? null,
          ivr: jc.ivr ?? null,
          entryPrice: jc.entryPrice ?? null,
          isCredit: jc.isCredit ?? null,
          maxLoss: jc.maxLoss ?? null,
          maxGain: jc.maxGain ?? null,
          thesis: jc.thesis ?? null,
          legs: jc.legs ?? null,
          quantity: jc.quantity ?? (parseInt(String(qty)) || null),
          accountHash,
        });
        logger.info({ orderId, symbol: sym }, "Trade journal entry created");
      } catch (journalErr) {
        logger.error({ journalErr }, "Failed to create journal entry (non-blocking)");
      }
    }

    res.json({ success: true, orderId });
    return;
  } catch (err) {
    logger.error({ err }, "Order placement error");
    return res.status(502).json({ error: "schwab_api_error" });
  }
});

router.delete("/cancel-order", async (req, res) => {
  const token = getTraderToken();
  if (!token) return res.status(401).json({ error: "no_trader_token" });

  const { accountHash, orderId } = req.body as {
    accountHash: string;
    orderId: string;
  };

  if (!accountHash || !orderId) {
    return res.status(400).json({ error: "Missing accountHash or orderId" });
  }

  try {
    const schwabRes = await fetch(
      `${SCHWAB_TRADER_BASE}/accounts/${accountHash}/orders/${orderId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!schwabRes.ok) {
      const body = await schwabRes.text().catch(() => "");
      return res.status(schwabRes.status).json({ error: "cancel_failed", message: body.slice(0, 500) });
    }

    if (orderId) {
      markAlertSeen(orderId, "CancelAccepted");
      markAlertSeen(orderId, "OrderUROutCompleted");
    }

    broadcastToClients("orderAlert", {
      type: "CancelAccepted",
      symbol: null,
      side: null,
      quantity: null,
      orderId,
      status: "CANCELED",
      timestamp: Date.now(),
      raw: "",
    });

    void sendPushToAll({
      title: "ALPHA TERMINAL",
      body: `Order ${orderId} CANCELED`,
      tag: "CancelAccepted",
      data: { orderId },
    });

    res.json({ success: true });
    return;
  } catch (err) {
    logger.error({ err }, "Order cancel error");
    return res.status(502).json({ error: "schwab_api_error" });
  }
});

export default router;
