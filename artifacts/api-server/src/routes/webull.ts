import { Router, type IRouter } from "express";
import { WebullApiError, webullSignedFetch } from "../lib/webull/webullClient.js";
import {
  normalizeWebullQuery,
  parseWebullMethod,
  validateWebullEntitledPath,
  WEBULL_HTTP_METHODS,
  WEBULL_HTTP_NAMESPACES,
  WebullCapabilityError,
} from "../lib/webull/webullCapabilities.js";
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

router.get("/capabilities", async (_req, res) => {
  const token = await getWebullToken();
  return res.json({
    configured: webullCredentialsConfigured(),
    connected: isWebullTradingReady(token),
    authentication: {
      tokenCreate: "/api/auth/webull/connect",
      tokenStatus: "/api/auth/webull/status",
      tokenDelete: "/api/auth/webull/disconnect",
    },
    invocation: {
      endpoint: "/api/webull/invoke",
      methods: WEBULL_HTTP_METHODS,
      namespaces: WEBULL_HTTP_NAMESPACES,
      accessTokenAppliedServerSide: true,
      appSecretExposed: false,
      additionalAccounts: "Pass any account_id returned by /trading/accounts/list.",
    },
  });
});

/**
 * Signed gateway for every HTTP endpoint in the Webull Trading and Market
 * Data products. The host and top-level namespaces are fixed server-side, so
 * callers get all granted capabilities without access to credentials or an
 * arbitrary outbound proxy.
 */
router.post("/invoke", async (req, res) => {
  if (!tradingReady(res)) return;
  const token = await requireNormalToken(res);
  if (!token) return;

  try {
    const payload = (req.body ?? {}) as {
      method?: unknown;
      path?: unknown;
      query?: unknown;
      body?: unknown;
    };
    const method = parseWebullMethod(payload.method ?? "GET");
    const path = validateWebullEntitledPath(payload.path);
    const query = normalizeWebullQuery(payload.query);
    const data = await webullSignedFetch({
      method,
      path,
      query,
      body: payload.body,
      withAccessToken: true,
    });
    return res.json(data);
  } catch (err) {
    if (err instanceof WebullCapabilityError) {
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof WebullApiError) {
      let message = "Webull rejected the request.";
      try {
        const parsed = JSON.parse(err.body) as { message?: unknown; error_code?: unknown };
        const detail =
          typeof parsed.message === "string"
            ? parsed.message
            : typeof parsed.error_code === "string"
              ? parsed.error_code
              : "";
        if (detail) message = detail.slice(0, 400);
      } catch {
        const detail = err.body.trim();
        if (detail) message = detail.slice(0, 400);
      }
      return res.status(err.status).json({
        error: "webull_api_error",
        upstreamStatus: err.status,
        message,
      });
    }
    logger.error({ err }, "Webull entitled endpoint invocation failed");
    return res.status(502).json({ error: "webull_api_error" });
  }
});

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