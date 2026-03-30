import { Router, type IRouter } from "express";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const SCHWAB_TRADER_BASE = "https://api.schwabapi.com/trader/v1";

async function schwabGet(url: string, token: string) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Schwab ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

router.get("/summary", async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "unauthorized" });

  try {
    const accounts = await schwabGet(
      `${SCHWAB_TRADER_BASE}/accounts?fields=positions`,
      token
    ) as any[];

    if (!accounts || accounts.length === 0) {
      return res.json({ accounts: [] });
    }

    const mapped = accounts.map((acct: any) => {
      const info = acct.securitiesAccount ?? acct;
      const positions = (info.positions ?? []).map((p: any) => ({
        symbol: p.instrument?.symbol ?? "N/A",
        description: p.instrument?.description ?? null,
        assetType: p.instrument?.assetType ?? null,
        quantity: p.longQuantity ?? p.shortQuantity ?? 0,
        isLong: (p.longQuantity ?? 0) > 0,
        averagePrice: p.averagePrice ?? null,
        currentDayProfitLoss: p.currentDayProfitLoss ?? null,
        currentDayProfitLossPercentage: p.currentDayProfitLossPercentage ?? null,
        marketValue: p.marketValue ?? null,
        maintenanceRequirement: p.maintenanceRequirement ?? null,
      }));

      const bal = info.currentBalances ?? info.initialBalances ?? {};
      const proj = info.projectedBalances ?? {};

      return {
        accountNumber: info.accountNumber ?? acct.accountNumber ?? "N/A",
        type: info.type ?? "UNKNOWN",
        isClosingOnlyRestricted: info.isClosingOnlyRestricted ?? false,
        isDayTrader: info.isDayTrader ?? false,
        roundTrips: info.roundTrips ?? 0,
        balances: {
          liquidationValue: bal.liquidationValue ?? null,
          cashBalance: bal.cashBalance ?? null,
          availableFunds: bal.availableFunds ?? null,
          buyingPower: bal.buyingPower ?? null,
          equity: bal.equity ?? null,
          longMarketValue: bal.longMarketValue ?? null,
          shortMarketValue: bal.shortMarketValue ?? null,
          marginBalance: bal.marginBalance ?? null,
          maintenanceRequirement: bal.maintenanceRequirement ?? null,
          moneyMarketFund: bal.moneyMarketFund ?? null,
          cashAvailableForTrading: bal.cashAvailableForTrading ?? null,
          cashAvailableForWithdrawal: bal.cashAvailableForWithdrawal ?? null,
          dayTradingBuyingPower: bal.dayTradingBuyingPower ?? null,
          accountValue: bal.accountValue ?? bal.liquidationValue ?? null,
        },
        projectedBalances: {
          availableFunds: proj.availableFunds ?? null,
          buyingPower: proj.buyingPower ?? null,
          dayTradingBuyingPower: proj.dayTradingBuyingPower ?? null,
          cashAvailableForWithdrawal: proj.cashAvailableForWithdrawal ?? null,
        },
        positions,
      };
    });

    logger.info({ count: mapped.length }, "Account summary fetched");
    res.json({ accounts: mapped });
  } catch (err: any) {
    logger.error({ err: err.message }, "Account summary failed");
    if (err.message?.includes("401")) {
      return res.status(401).json({ error: "unauthorized" });
    }
    res.status(500).json({ error: "Failed to fetch account data" });
  }
});

router.get("/transactions", async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "unauthorized" });

  try {
    const accounts = await schwabGet(
      `${SCHWAB_TRADER_BASE}/accounts`,
      token
    ) as any[];

    if (!accounts || accounts.length === 0) {
      return res.json({ transactions: [] });
    }

    const acctHash = accounts[0].hashValue ?? accounts[0].securitiesAccount?.accountNumber;
    if (!acctHash) {
      return res.json({ transactions: [] });
    }

    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 30);

    const txUrl = `${SCHWAB_TRADER_BASE}/accounts/${acctHash}/transactions?startDate=${startDate.toISOString()}&endDate=${now.toISOString()}&types=TRADE,RECEIVE_AND_DELIVER,DIVIDEND_OR_INTEREST`;
    const txns = await schwabGet(txUrl, token) as any[];

    const mapped = (txns ?? []).slice(0, 50).map((tx: any) => ({
      transactionId: tx.transactionId ?? tx.activityId ?? null,
      type: tx.type ?? tx.transactionType ?? null,
      description: tx.description ?? null,
      date: tx.transactionDate ?? tx.tradeDate ?? null,
      settlementDate: tx.settlementDate ?? null,
      netAmount: tx.netAmount ?? null,
      symbol: tx.transactionItems?.[0]?.instrument?.symbol ?? null,
      quantity: tx.transactionItems?.[0]?.amount ?? null,
      price: tx.transactionItems?.[0]?.price ?? null,
      instruction: tx.transactionItems?.[0]?.instruction ?? null,
    }));

    logger.info({ count: mapped.length }, "Transactions fetched");
    res.json({ transactions: mapped });
  } catch (err: any) {
    logger.error({ err: err.message }, "Transactions fetch failed");
    if (err.message?.includes("401")) {
      return res.status(401).json({ error: "unauthorized" });
    }
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

router.get("/orders", async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "unauthorized" });

  try {
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 7);

    const orders = await schwabGet(
      `${SCHWAB_TRADER_BASE}/orders?fromEnteredTime=${startDate.toISOString()}&toEnteredTime=${now.toISOString()}`,
      token
    ) as any[];

    const mapped = (orders ?? []).slice(0, 50).map((o: any) => ({
      orderId: o.orderId ?? null,
      status: o.status ?? null,
      enteredTime: o.enteredTime ?? null,
      closedTime: o.closeTime ?? null,
      orderType: o.orderType ?? null,
      instruction: o.orderLegCollection?.[0]?.instruction ?? null,
      symbol: o.orderLegCollection?.[0]?.instrument?.symbol ?? null,
      quantity: o.quantity ?? o.filledQuantity ?? null,
      price: o.price ?? o.stopPrice ?? null,
      filledQuantity: o.filledQuantity ?? null,
      remainingQuantity: o.remainingQuantity ?? null,
      duration: o.duration ?? null,
      session: o.session ?? null,
    }));

    logger.info({ count: mapped.length }, "Orders fetched");
    res.json({ orders: mapped });
  } catch (err: any) {
    logger.error({ err: err.message }, "Orders fetch failed");
    if (err.message?.includes("401")) {
      return res.status(401).json({ error: "unauthorized" });
    }
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

export default router;
