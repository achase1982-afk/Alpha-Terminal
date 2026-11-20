import { Router, type IRouter } from "express";
import {
  normalizeSchwabStringRecord,
  parseSchwabHttpMethod,
  parseSchwabRestApp,
  parseSchwabStreamerCommand,
  parseSchwabStreamerService,
  SCHWAB_HTTP_METHODS,
  SCHWAB_REST_NAMESPACES,
  SCHWAB_STREAMER_COMMANDS,
  SCHWAB_STREAMER_SERVICES,
  SchwabCapabilityError,
  validateSchwabRestPath,
} from "../lib/schwabCapabilities.js";
import { schwabEntitledFetch } from "../lib/schwabEntitledClient.js";
import {
  getStreamerStatus,
  sendSchwabCapabilityStreamerRequest,
} from "../lib/schwabStreamer.js";
import { getValidAccessToken } from "../lib/tokenStore.js";
import { deskSchwab2Configured } from "../lib/desk/deskSchwab2OAuth.js";
import { getSchwab2TokenMeta } from "../lib/desk/deskSchwab2TokenStore.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/capabilities", (_req, res) => {
  const app2 = getSchwab2TokenMeta();
  return res.json({
    apps: {
      app1: {
        product: "Accounts and Trading Production",
        connected: Boolean(getValidAccessToken("trader")),
        restAndStreamer: true,
      },
      app2: {
        product: "Market Data Production",
        configured: deskSchwab2Configured(),
        connected: app2.has_tokens,
        restOnly: true,
      },
    },
    rest: {
      endpoint: "/api/schwab/invoke",
      pathGate: "Every path under /marketdata/v1/ and /trader/v1/ is accepted. The operation lists are a catalog, not a block list.",
      methods: SCHWAB_HTTP_METHODS,
      namespaces: SCHWAB_REST_NAMESPACES,
    },
    streamer: {
      endpoint: "/api/schwab/stream/invoke",
      status: getStreamerStatus(),
      commands: SCHWAB_STREAMER_COMMANDS,
      services: SCHWAB_STREAMER_SERVICES,
      responseEvent: "schwabStreamerResponse",
      dataEvent: "schwabStreamerData",
      onDemand: true,
    },
  });
});

router.post("/invoke", async (req, res) => {
  try {
    const payload = (req.body ?? {}) as {
      method?: unknown;
      path?: unknown;
      query?: unknown;
      body?: unknown;
      app?: unknown;
    };
    const method = parseSchwabHttpMethod(payload.method ?? "GET");
    const { path, product } = validateSchwabRestPath(payload.path);
    const query = normalizeSchwabStringRecord(payload.query, "invalid_schwab_query");
    const app = parseSchwabRestApp(payload.app, product.defaultApp);
    const result = await schwabEntitledFetch({
      method,
      path,
      query,
      body: payload.body,
      app,
    });

    const text = await result.res.text().catch(() => "");
    const contentType = result.res.headers.get("content-type");
    const location = result.res.headers.get("location");
    const correlId = result.res.headers.get("schwab-client-correlid");
    if (contentType) res.setHeader("Content-Type", contentType);
    if (location) res.setHeader("Location", location);
    if (correlId) res.setHeader("Schwab-Client-CorrelId", correlId);
    res.setHeader("X-Alpha-Schwab-App", result.app);
    res.setHeader("X-Alpha-Schwab-Fallback", String(result.fellBack));
    return res.status(result.res.status).send(text || undefined);
  } catch (err) {
    if (err instanceof SchwabCapabilityError) {
      return res.status(400).json({ error: err.message });
    }
    logger.error({ err }, "Schwab entitled REST invocation failed");
    return res.status(502).json({ error: "schwab_api_error" });
  }
});

router.post("/stream/invoke", (req, res) => {
  try {
    const payload = (req.body ?? {}) as {
      service?: unknown;
      command?: unknown;
      parameters?: unknown;
    };
    const service = parseSchwabStreamerService(payload.service);
    const command = parseSchwabStreamerCommand(payload.command ?? "SUBS");
    const parameters = normalizeSchwabStringRecord(
      payload.parameters,
      "invalid_schwab_streamer_parameters",
    );
    const result = sendSchwabCapabilityStreamerRequest({
      service,
      command,
      parameters,
    });
    if (!result.sent) {
      return res.status(409).json({
        error: "schwab_streamer_not_connected",
        status: result.status,
      });
    }
    return res.status(202).json({
      accepted: true,
      service,
      command,
      requestId: result.requestId,
    });
  } catch (err) {
    if (err instanceof SchwabCapabilityError) {
      return res.status(400).json({ error: err.message });
    }
    logger.error({ err }, "Schwab entitled streamer invocation failed");
    return res.status(502).json({ error: "schwab_streamer_error" });
  }
});

export default router;
