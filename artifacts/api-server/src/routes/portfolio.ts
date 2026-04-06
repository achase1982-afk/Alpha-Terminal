import { Router, type IRouter } from "express";
import { getTokens } from "../lib/tokenStore.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const SCHWAB_TRADER_BASE = "https://api.schwabapi.com/trader/v1";

function getTraderToken(): string | null {
  const trader = getTokens("trader");
  return trader?.accessToken ?? null;
}

async function schwabGet(path: string, token: string): Promise<any> {
  const res = await fetch(`${SCHWAB_TRADER_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Schwab ${path} returned ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

router.get("/accounts", async (_req, res) => {
  const token = getTraderToken();
  if (!token) return res.status(401).json({ error: "no_trader_token" });

  try {
    const accounts = await schwabGet("/accounts?fields=positions", token);
    const mapped = accounts.map((acct: any) => {
      const sa = acct.securitiesAccount;
      const bal = sa.currentBalances ?? {};
      const initBal = sa.initialBalances ?? {};

      const dayPL = (sa.positions ?? []).reduce(
        (sum: number, p: any) => sum + (p.currentDayProfitLoss ?? 0),
        0
      );
      const totalPL = (sa.positions ?? []).reduce(
        (sum: number, p: any) => sum + (p.longOpenProfitLoss ?? 0),
        0
      );

      const positions = (sa.positions ?? []).map((p: any) => {
        const inst = p.instrument ?? {};
        return {
          symbol: inst.symbol,
          underlyingSymbol: inst.underlyingSymbol ?? inst.symbol,
          description: inst.description ?? inst.symbol,
          assetType: inst.assetType,
          putCall: inst.putCall ?? null,
          cusip: inst.cusip,
          longQuantity: p.longQuantity ?? 0,
          shortQuantity: p.shortQuantity ?? 0,
          averagePrice: p.averagePrice ?? 0,
          marketValue: p.marketValue ?? 0,
          currentDayProfitLoss: p.currentDayProfitLoss ?? 0,
          currentDayProfitLossPercentage: p.currentDayProfitLossPercentage ?? 0,
          longOpenProfitLoss: p.longOpenProfitLoss ?? 0,
          maintenanceRequirement: p.maintenanceRequirement ?? 0,
          settledLongQuantity: p.settledLongQuantity ?? 0,
          settledShortQuantity: p.settledShortQuantity ?? 0,
          previousSessionLongQuantity: p.previousSessionLongQuantity ?? 0,
        };
      });

      const acctNum = String(sa.accountNumber ?? "");
      return {
        accountNumber: acctNum.length > 4 ? `****${acctNum.slice(-4)}` : acctNum,
        type: sa.type,
        isDayTrader: sa.isDayTrader ?? false,
        roundTrips: sa.roundTrips ?? 0,
        balances: {
          liquidationValue: bal.liquidationValue ?? 0,
          equity: bal.equity ?? 0,
          buyingPower: bal.buyingPower ?? 0,
          dayTradingBuyingPower: bal.dayTradingBuyingPower ?? 0,
          cashBalance: bal.cashBalance ?? 0,
          availableFunds: bal.availableFunds ?? 0,
          marginBalance: bal.marginBalance ?? 0,
          maintenanceRequirement: bal.maintenanceRequirement ?? 0,
          longMarketValue: bal.longMarketValue ?? 0,
          shortMarketValue: bal.shortMarketValue ?? 0,
          longOptionMarketValue: bal.longOptionMarketValue ?? 0,
          shortOptionMarketValue: bal.shortOptionMarketValue ?? 0,
          moneyMarketFund: bal.moneyMarketFund ?? 0,
          mutualFundValue: bal.mutualFundValue ?? 0,
          bondValue: bal.bondValue ?? 0,
          pendingDeposits: bal.pendingDeposits ?? 0,
          sma: bal.sma ?? 0,
        },
        initialBalances: {
          accountValue: initBal.accountValue ?? initBal.liquidationValue ?? 0,
          equity: initBal.equity ?? 0,
          liquidationValue: initBal.liquidationValue ?? 0,
        },
        dayPL,
        totalPL,
        positions,
      };
    });

    res.json(mapped);
  } catch (err) {
    logger.error({ err }, "Portfolio accounts fetch failed");
    res.status(502).json({ error: "schwab_api_error" });
  }
});

router.get("/orders", async (req, res) => {
  const token = getTraderToken();
  if (!token) return res.status(401).json({ error: "no_trader_token" });

  try {
    const nums = await schwabGet("/accounts/accountNumbers", token);
    if (!nums.length) return res.json([]);
    const hash = nums[0].hashValue;

    const days = parseInt(req.query.days as string) || 30;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - Math.min(days, 60));

    const orders = await schwabGet(
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
  } catch (err) {
    logger.error({ err }, "Portfolio orders fetch failed");
    res.status(502).json({ error: "schwab_api_error" });
  }
});

router.get("/transactions", async (req, res) => {
  const token = getTraderToken();
  if (!token) return res.status(401).json({ error: "no_trader_token" });

  try {
    const nums = await schwabGet("/accounts/accountNumbers", token);
    if (!nums.length) return res.json([]);
    const hash = nums[0].hashValue;

    const days = parseInt(req.query.days as string) || 30;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - Math.min(days, 365));

    const txns = await schwabGet(
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
  } catch (err) {
    logger.error({ err }, "Portfolio transactions fetch failed");
    res.status(502).json({ error: "schwab_api_error" });
  }
});

router.get("/account-hash", async (_req, res) => {
  const token = getTraderToken();
  if (!token) return res.status(401).json({ error: "no_trader_token" });

  try {
    const nums = await schwabGet("/accounts/accountNumbers", token);
    if (!nums.length) return res.status(404).json({ error: "no_accounts" });
    res.json({ hashValue: nums[0].hashValue });
  } catch (err) {
    logger.error({ err }, "Account hash fetch failed");
    res.status(502).json({ error: "schwab_api_error" });
  }
});

router.post("/place-order", async (req, res) => {
  const token = getTraderToken();
  if (!token) return res.status(401).json({ error: "no_trader_token" });

  const { accountHash, order } = req.body as {
    accountHash: string;
    order: Record<string, unknown>;
  };

  if (!accountHash || !order) {
    return res.status(400).json({ error: "Missing accountHash or order" });
  }

  try {
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

    res.json({ success: true, orderId });
  } catch (err) {
    logger.error({ err }, "Order placement error");
    res.status(502).json({ error: "schwab_api_error" });
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

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Order cancel error");
    res.status(502).json({ error: "schwab_api_error" });
  }
});

export default router;
