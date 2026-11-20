import { Router, type IRouter } from "express";
import {
  ENTITLED_HTTP_METHODS,
  EntitledGatewayError,
  forwardEntitledResponse,
  parseEntitledMethod,
} from "../lib/entitledGateway.js";
import {
  PROVIDER_CAPABILITIES,
  invokeProviderEndpoint,
  type EntitledProvider,
} from "../lib/providerEntitlements.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const providers = new Set<EntitledProvider>(["alpaca", "tradier", "tastytrade", "unusual-whales"]);

function providerFrom(value: unknown): EntitledProvider {
  if (typeof value !== "string" || !providers.has(value as EntitledProvider)) {
    throw new EntitledGatewayError("unknown_provider");
  }
  return value as EntitledProvider;
}

router.get("/:provider/capabilities", (req, res) => {
  try {
    const provider = providerFrom(req.params.provider);
    return res.json({
      provider,
      endpoint: `/api/providers/${provider}/invoke`,
      methods: ENTITLED_HTTP_METHODS,
      onDemand: true,
      automaticPolling: false,
      ...PROVIDER_CAPABILITIES[provider],
    });
  } catch (err) {
    if (err instanceof EntitledGatewayError) return res.status(400).json({ error: err.message });
    return res.status(500).json({ error: "provider_capabilities_error" });
  }
});

router.post("/:provider/invoke", async (req, res) => {
  let provider: EntitledProvider | undefined;
  try {
    provider = providerFrom(req.params.provider);
    const payload = (req.body ?? {}) as {
      target?: unknown;
      method?: unknown;
      path?: unknown;
      query?: unknown;
      body?: unknown;
    };
    const upstream = await invokeProviderEndpoint({
      provider,
      target: payload.target,
      method: parseEntitledMethod(payload.method),
      path: payload.path,
      query: payload.query,
      body: payload.body,
    });
    return await forwardEntitledResponse(upstream, res);
  } catch (err) {
    if (err instanceof EntitledGatewayError) return res.status(400).json({ error: err.message });
    logger.error({ err, provider }, "Entitled provider invocation failed");
    return res.status(502).json({ error: "provider_api_error" });
  }
});

export default router;
