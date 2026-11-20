import { Router, type IRouter } from "express";
import { webullSignedFetch } from "../lib/webull/webullClient.js";
import {
  getWebullToken,
  isWebullTradingReady,
  parseWebullAccountHash,
  webullCredentialsConfigured,
} from "../lib/webull/webullTokenStore.js";
import { mapWebullOrderRow, webullFetchHistoricalOrders } from "../lib/webull/webullOrderBridge.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

function tradingReady(res: Parameters<typeof router.get>[1] extends (req: any, r: infer R) => any ? R : never) {
  if (!webullCredentialsConfigured()) {
    res.status(503).json({ error: "webull_not_configured" });
    return false;
  }
  return true;
}

async function requireNormalToken(res: Parameters<typeof router.get>[1] extends (req: any, r: infer R) => any ? R : never) {
  const token = await getWebullToken();
  if (!isWebullTradingReady(token)) {
    res.status(401).json({ error: "webull_not_connected" });
    return null;
  }
  return token;
}

router.get("/trading/accounts/list", async (_req, res) => {
  if (!tradingReady(res)) return;
  const token = await requireNormalToken(res);
  if (!token) return;
  try {
    const data = await webullSignedFetch({
      method: "GET",
      path: "/trading/accounts/list",
      withAccessToken: true,
    });
    return res.json(data);
  } catch (err) {
    logger.error({ err }, "Webull accounts list failed");
    return res.status(502).json({ error: "webull_api_error" });
  }
});

router.get("/trading/assets/balances/get", async (req, res) => {
  if (!tradingReady(res)) return;
  const token = await requireNormalToken(res);
  if (!token) return;
  const accountId =
    typeof req.query.account_id === "string"
      ? req.query.account_id
      : parseWebullAccountHash(typeof req.query.accountHash === "string" ? req.query.accountHash : null);
  if (!accountId) return res.status(400).json({ error: "missing_account_id" });
  try {
    const data = await webullSignedFetch({
      method: "GET",
      path: "/trading/assets/balances/get",
      query: { account_id: accountId },
      withAccessToken: true,
    });
    return res.json(data);
  } catch (err) {
    logger.error({ err }, "Webull balances failed");
    return res.status(502).json({ error: "webull_api_error" });
  }
});

router.get("/trading/assets/positions/list", async (req, res) => {
  if (!tradingReady(res)) return;
  const token = await requireNormalToken(res);
  if (!token) return;
  const accountId =
    typeof req.query.account_id === "string"
      ? req.query.account_id
      : parseWebullAccountHash(typeof req.query.accountHash === "string" ? req.query.accountHash : null);
  if (!accountId) return res.status(400).json({ error: "missing_account_id" });
  try {
    const data = await webullSignedFetch({
      method: "GET",
      path: "/trading/assets/positions/list",
      query: { account_id: accountId },
      withAccessToken: true,
    });
    return res.json(data);
  } catch (err) {
    logger.error({ err }, "Webull positions failed");
    return res.status(502).json({ error: "webull_api_error" });
  }
});

router.get("/trading/orders/historical-orders/list", async (req, res) => {
  if (!tradingReady(res)) return;
  const token = await requireNormalToken(res);
  if (!token) return;
  const accountId =
    typeof req.query.account_id === "string"
      ? req.query.account_id
      : parseWebullAccountHash(typeof req.query.accountHash === "string" ? req.query.accountHash : null);
  if (!accountId) return res.status(400).json({ error: "missing_account_id" });

  const days = Math.min(60, parseInt(String(req.query.days ?? "30"), 10) || 30);
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  const startTime = typeof req.query.start_time === "string" ? req.query.start_time : start.toISOString();
  const endTime = typeof req.query.end_time === "string" ? req.query.end_time : end.toISOString();
  const paginationKey = typeof req.query.pagination_key === "string" ? req.query.pagination_key : undefined;

  try {
    const payload = await webullFetchHistoricalOrders(accountId, startTime, endTime, paginationKey);
    const rows = Array.isArray(payload.data) ? payload.data : [];
    const orders = rows.map((row) => mapWebullOrderRow(row));
    return res.json({
      accountHash: `webull:${accountId}`,
      pagination_key: payload.pagination_key ?? null,
      orders,
    });
  } catch (err) {
    logger.error({ err }, "Webull historical orders failed");
    return res.status(502).json({ error: "webull_api_error" });
  }
});

export default router;