import { Router, type IRouter } from "express";
import crypto from "crypto";
import {
  GetAuthUrlResponse,
  ExchangeCodeBody,
  ExchangeCodeResponse,
  RefreshTokenBody,
  RefreshTokenResponse,
  GetAuthStatusResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const SCHWAB_AUTH_BASE = "https://api.schwabapi.com/v1/oauth/authorize";
const SCHWAB_TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";

interface StoredFlow {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  createdAt: number;
}

interface PendingFlow {
  createdAt: number;
}

const flowStore = new Map<string, StoredFlow>();
const pendingFlows = new Map<string, PendingFlow>();

setInterval(() => {
  const now = Date.now();
  for (const [id, flow] of flowStore) {
    if (now - flow.createdAt > 120_000) flowStore.delete(id);
  }
  for (const [id, flow] of pendingFlows) {
    if (now - flow.createdAt > 300_000) pendingFlows.delete(id);
  }
}, 30_000);

function basicAuth(appKey: string, appSecret: string): string {
  return "Basic " + Buffer.from(`${appKey}:${appSecret}`).toString("base64");
}

function getFrontendOrigin(): string {
  const domain = process.env.REPLIT_DEV_DOMAIN;
  if (domain) return `https://${domain}`;
  return "";
}

router.post("/init-flow", (_req, res) => {
  const flowId = crypto.randomBytes(32).toString("hex");
  pendingFlows.set(flowId, { createdAt: Date.now() });
  res.json({ flowId });
});

router.get("/url", (req, res) => {
  const appKey = process.env.SCHWAB_APP_KEY;
  const redirectUri = process.env.SCHWAB_REDIRECT_URI;

  if (!appKey || !redirectUri) {
    return res.json(GetAuthUrlResponse.parse({ url: "", configured: false }));
  }

  const state = (req.query.state as string) || "";

  const params = new URLSearchParams({
    response_type: "code",
    client_id: appKey,
    redirect_uri: redirectUri,
  });

  if (state) {
    params.set("state", state);
  }

  const url = `${SCHWAB_AUTH_BASE}?${params.toString()}`;
  res.json(GetAuthUrlResponse.parse({ url, configured: true }));
});

router.get("/redirect-uri", (_req, res) => {
  res.json({ redirectUri: process.env.SCHWAB_REDIRECT_URI || "" });
});

router.get("/callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;

  if (!code) {
    return res.status(400).json({ error: "missing_code", message: "No authorization code provided" });
  }

  const appKey = process.env.SCHWAB_APP_KEY;
  const appSecret = process.env.SCHWAB_APP_SECRET;
  const redirectUri = process.env.SCHWAB_REDIRECT_URI;

  if (!appKey || !appSecret || !redirectUri) {
    return res.status(400).json({ error: "not_configured", message: "Schwab credentials not configured" });
  }

  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", redirectUri);

  req.log.info(
    { url: SCHWAB_TOKEN_URL, grant_type: "authorization_code", redirect_uri: redirectUri, code_length: code.length },
    "Native callback: attempting Schwab token exchange"
  );

  const origin = getFrontendOrigin();

  try {
    const response = await fetch(SCHWAB_TOKEN_URL, {
      method: "POST",
      headers: {
        "Authorization": basicAuth(appKey, appSecret),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const responseText = await response.text();

    if (!response.ok) {
      req.log.error({ status: response.status, body: responseText }, "Native callback: token exchange failed");
      const failMsg = encodeURIComponent("Token exchange failed. Please try again.");
      const failMobile = /Android|iPhone|iPad|iPod|webOS|Mobile/i.test(req.headers["user-agent"] || "");
      if (failMobile) {
        return res.redirect(`${origin}/?schwab=error&message=${failMsg}`);
      }
      return res.redirect(`${origin}/oauth-success?status=error&message=${failMsg}`);
    }

    req.log.info({ status: response.status }, "Native callback: token exchange succeeded");
    const tokenData = JSON.parse(responseText) as Record<string, unknown>;

    let flowId: string;
    if (state && pendingFlows.has(state)) {
      flowId = state;
      pendingFlows.delete(state);
    } else {
      flowId = crypto.randomBytes(32).toString("hex");
    }
    flowStore.set(flowId, {
      accessToken: tokenData["access_token"] as string,
      refreshToken: tokenData["refresh_token"] as string,
      expiresIn: tokenData["expires_in"] as number,
      tokenType: tokenData["token_type"] as string,
      createdAt: Date.now(),
    });

    const isMobileUA = /Android|iPhone|iPad|iPod|webOS|Mobile/i.test(req.headers["user-agent"] || "");
    if (isMobileUA) {
      res.redirect(`${origin}/?schwab=connected&flowId=${flowId}`);
    } else {
      res.redirect(`${origin}/oauth-success?status=success&flowId=${flowId}`);
    }
  } catch (err) {
    req.log.error({ err }, "Native callback: network error");
    const errMobile = /Android|iPhone|iPad|iPod|webOS|Mobile/i.test(req.headers["user-agent"] || "");
    const errMsg = encodeURIComponent("Network error reaching Schwab API.");
    if (errMobile) {
      res.redirect(`${origin}/?schwab=error&message=${errMsg}`);
    } else {
      res.redirect(`${origin}/oauth-success?status=error&message=${errMsg}`);
    }
  }
});

router.get("/flow-status", (req, res) => {
  const flowId = req.query.flowId as string | undefined;

  if (!flowId) {
    return res.json({ connected: false });
  }

  const flow = flowStore.get(flowId);
  if (!flow) {
    return res.json({ connected: false });
  }

  return res.json({ connected: true });
});

router.get("/flow-tokens/:flowId", (req, res) => {
  const flow = flowStore.get(req.params.flowId);
  if (!flow) {
    return res.status(404).json({ error: "flow_not_found", message: "Flow expired or already consumed" });
  }

  flowStore.delete(req.params.flowId);

  res.json({
    accessToken: flow.accessToken,
    refreshToken: flow.refreshToken,
    expiresIn: flow.expiresIn,
    tokenType: flow.tokenType,
  });
});

router.post("/callback", async (req, res) => {
  const parsed = ExchangeCodeBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "validation_error", message: "Invalid request body" });
  }

  const { code } = parsed.data;
  const appKey = process.env.SCHWAB_APP_KEY;
  const appSecret = process.env.SCHWAB_APP_SECRET;
  const redirectUri = process.env.SCHWAB_REDIRECT_URI;

  if (!appKey || !appSecret || !redirectUri) {
    return res.status(400).json({ error: "not_configured", message: "Schwab credentials not configured in environment" });
  }

  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", redirectUri);

  req.log.info(
    { url: SCHWAB_TOKEN_URL, grant_type: "authorization_code", redirect_uri: redirectUri, code_length: code.length },
    "Attempting Schwab token exchange"
  );

  try {
    const response = await fetch(SCHWAB_TOKEN_URL, {
      method: "POST",
      headers: {
        "Authorization": basicAuth(appKey, appSecret),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const responseText = await response.text();

    if (!response.ok) {
      req.log.error(
        { status: response.status, body: responseText, redirect_uri: redirectUri },
        "Token exchange failed"
      );
      let detail = responseText;
      try {
        const parsed = JSON.parse(responseText);
        detail = parsed.error_description || parsed.message || responseText;
      } catch { /* keep raw text */ }
      return res.status(400).json({
        error: "token_exchange_failed",
        message: detail,
      });
    }

    req.log.info({ status: response.status }, "Token exchange succeeded");
    const tokenData = JSON.parse(responseText) as Record<string, unknown>;
    res.json(ExchangeCodeResponse.parse({
      accessToken: tokenData["access_token"],
      refreshToken: tokenData["refresh_token"],
      expiresIn: tokenData["expires_in"],
      tokenType: tokenData["token_type"],
    }));
  } catch (err) {
    req.log.error({ err }, "Token exchange network error");
    res.status(500).json({ error: "network_error", message: "Failed to reach Schwab API" });
  }
});

router.post("/refresh", async (req, res) => {
  const parsed = RefreshTokenBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "validation_error", message: "Invalid request body" });
  }

  const { refreshToken } = parsed.data;
  const appKey = process.env.SCHWAB_APP_KEY;
  const appSecret = process.env.SCHWAB_APP_SECRET;

  if (!appKey || !appSecret) {
    return res.status(400).json({ error: "not_configured", message: "Schwab credentials not configured" });
  }

  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refreshToken);

  try {
    const response = await fetch(SCHWAB_TOKEN_URL, {
      method: "POST",
      headers: {
        "Authorization": basicAuth(appKey, appSecret),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const responseText = await response.text();

    if (!response.ok) {
      req.log.error({ status: response.status, body: responseText }, "Token refresh failed");
      let detail = responseText;
      try {
        const p = JSON.parse(responseText);
        detail = p.error_description || p.message || responseText;
      } catch { /* keep raw */ }
      return res.status(400).json({ error: "refresh_failed", message: detail });
    }

    const tokenData = JSON.parse(responseText) as Record<string, unknown>;
    res.json(RefreshTokenResponse.parse({
      accessToken: tokenData["access_token"],
      refreshToken: tokenData["refresh_token"] ?? refreshToken,
      expiresIn: tokenData["expires_in"],
      tokenType: tokenData["token_type"],
    }));
  } catch (err) {
    req.log.error({ err }, "Token refresh error");
    res.status(500).json({ error: "internal_error", message: "Failed to refresh token" });
  }
});

router.get("/status", (_req, res) => {
  const configured = !!(process.env.SCHWAB_APP_KEY && process.env.SCHWAB_APP_SECRET && process.env.SCHWAB_REDIRECT_URI);
  const geminiConfigured = !!process.env.GEMINI_API_KEY;
  res.json(GetAuthStatusResponse.parse({ configured, geminiConfigured }));
});

export default router;
