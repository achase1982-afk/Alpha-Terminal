import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import {
  GetAuthUrlResponse,
  ExchangeCodeBody,
  ExchangeCodeResponse,
  RefreshTokenBody,
  RefreshTokenResponse,
  GetAuthStatusResponse,
} from "@workspace/api-zod";
import { storeTokens, hasValidTokens, getTokens, clearTokens as clearServerTokens } from "../lib/tokenStore.js";
import { stopStreamer } from "../lib/schwabStreamer.js";

const router: IRouter = Router();

const SCHWAB_AUTH_BASE = "https://api.schwabapi.com/v1/oauth/authorize";
const SCHWAB_TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";

const isProd = process.env.NODE_ENV === "production";

function getSchwabRedirectUri(): string {
  return (isProd ? process.env.SCHWAB_REDIRECT_URI_PROD : process.env.SCHWAB_REDIRECT_URI) || "";
}

function getTraderRedirectUri(): string {
  return (isProd ? process.env.SCHWAB_TRADER_REDIRECT_URI_PROD : process.env.SCHWAB_TRADER_REDIRECT_URI) || "";
}

const pendingStates = new Map<string, number>();
const pendingTokens = new Map<string, { accessToken: string; refreshToken: string; ts: number }>();
const STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_TTL_MS = 5 * 60 * 1000;

function cleanExpired() {
  const now = Date.now();
  for (const [key, ts] of pendingStates) {
    if (now - ts > STATE_TTL_MS) pendingStates.delete(key);
  }
  for (const [key, val] of pendingTokens) {
    if (now - val.ts > TOKEN_TTL_MS) pendingTokens.delete(key);
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function basicAuth(appKey: string, appSecret: string): string {
  return "Basic " + Buffer.from(`${appKey}:${appSecret}`).toString("base64");
}

function successPage(label: string) {
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="background:#0A0F16;color:#fff;font-family:-apple-system,system-ui,sans-serif;padding:40px 20px;text-align:center">
      <h2 style="color:#00d166;font-size:18px">${escapeHtml(label)} Connected</h2>
      <p style="color:#ccc;font-size:14px;line-height:1.5">Return to Alpha Terminal — it will pick up the session automatically.</p>
      <script>setTimeout(function(){ window.close(); }, 1500);</script>
    </body></html>`;
}

function errorPage(title: string, msg: string) {
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="background:#0A0F16;color:#fff;font-family:-apple-system,system-ui,sans-serif;padding:60px 20px;text-align:center">
      <h2 style="color:#FF1744;font-size:18px;margin-bottom:12px">${escapeHtml(title)}</h2>
      <p style="color:#ccc;font-size:14px;line-height:1.5;margin-bottom:32px">${escapeHtml(msg)}</p>
      <button
        onclick="window.close(); setTimeout(function(){ history.back(); }, 300);"
        style="display:inline-block;background:#FFB800;color:#000;font-size:14px;font-weight:700;letter-spacing:0.05em;padding:12px 32px;border:none;border-radius:8px;cursor:pointer;font-family:-apple-system,system-ui,sans-serif"
      >Close &amp; Return</button>
      <p style="margin-top:24px;font-size:12px;color:#555">If the button doesn&#39;t close this tab, you can close it manually and return to Alpha Terminal.</p>
    </body></html>`;
}

router.get("/url", (_req, res) => {
  const appKey = process.env.SCHWAB_TRADER_APP_KEY || process.env.SCHWAB_APP_KEY;
  const redirectUri = getTraderRedirectUri() || getSchwabRedirectUri();

  if (!appKey || !redirectUri) {
    return res.json(GetAuthUrlResponse.parse({ url: "", configured: false }));
  }

  cleanExpired();
  const state = crypto.randomBytes(24).toString("hex");
  pendingStates.set(state, Date.now());

  const params = new URLSearchParams({
    response_type: "code",
    client_id: appKey,
    redirect_uri: redirectUri,
    state,
  });

  const url = `${SCHWAB_AUTH_BASE}?${params.toString()}`;
  res.json(GetAuthUrlResponse.parse({ url, configured: true }));
});

router.get("/redirect-uri", (_req, res) => {
  res.json({ redirectUri: getSchwabRedirectUri() });
});

router.get("/callback", async (req, res) => {
  const code = req.query["code"] as string | undefined;
  const state = req.query["state"] as string | undefined;

  if (!code) {
    return res.status(400).send(errorPage("Missing Code", "No authorization code was received from Schwab."));
  }

  if (!state || !pendingStates.has(state)) {
    req.log.warn({ state: state?.slice(0, 8) }, "GET /callback — invalid or missing state parameter");
    return res.status(400).send(errorPage("Invalid Request", "OAuth state validation failed. Please try signing in again."));
  }
  pendingStates.delete(state);

  const appKey = process.env.SCHWAB_TRADER_APP_KEY || process.env.SCHWAB_APP_KEY;
  const appSecret = process.env.SCHWAB_TRADER_APP_SECRET || process.env.SCHWAB_APP_SECRET;
  const redirectUri = getTraderRedirectUri() || getSchwabRedirectUri();

  if (!appKey || !appSecret || !redirectUri) {
    return res.status(400).send(errorPage("Not Configured", "Schwab credentials are not configured."));
  }

  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", redirectUri);

  req.log.info(
    { grant_type: "authorization_code", redirect_uri: redirectUri, code_length: code.length },
    "GET /callback — exchanging code for tokens"
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
      req.log.error({ status: response.status, body: responseText }, "GET /callback token exchange failed");
      return res.status(400).send(errorPage("Authentication Failed", "Schwab returned an error. The authorization code may have expired. Please try again."));
    }

    let tokenData: Record<string, unknown>;
    try {
      tokenData = JSON.parse(responseText);
    } catch {
      req.log.error({ body: responseText.slice(0, 200) }, "GET /callback — invalid JSON from Schwab");
      return res.status(502).send(errorPage("Unexpected Response", "Received an invalid response from Schwab. Please try again."));
    }

    const accessToken = tokenData["access_token"];
    const refreshToken = tokenData["refresh_token"];

    if (typeof accessToken !== "string" || !accessToken) {
      req.log.error({ keys: Object.keys(tokenData) }, "GET /callback — missing access_token");
      return res.status(502).send(errorPage("Invalid Token", "Schwab did not return a valid access token. Please try again."));
    }

    const rfTok = typeof refreshToken === "string" ? refreshToken : "";
    const expiresIn = typeof tokenData["expires_in"] === "number" ? tokenData["expires_in"] : 1800;

    storeTokens("market", accessToken, rfTok, expiresIn);
    storeTokens("trader", accessToken, rfTok, expiresIn);
    pendingTokens.set("latest", { accessToken, refreshToken: rfTok, ts: Date.now() });
    pendingTokens.set("trader_latest", { accessToken, refreshToken: rfTok, ts: Date.now() });

    req.log.info("GET /callback — token exchange succeeded (stored as market + trader)");
    res.redirect("/");
  } catch (err) {
    req.log.error({ err }, "GET /callback network error");
    res.status(500).send(errorPage("Connection Error", "Could not reach Schwab API. Please try again."));
  }
});

router.get("/pending-session", (_req, res) => {
  const pending = pendingTokens.get("latest");
  if (!pending || Date.now() - pending.ts > TOKEN_TTL_MS) {
    return res.json({ found: false });
  }
  pendingTokens.delete("latest");
  res.json({
    found: true,
    accessToken: pending.accessToken,
    refreshToken: pending.refreshToken,
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
  const redirectUri = getSchwabRedirectUri();

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
    const at = tokenData["access_token"] as string;
    const rt = (tokenData["refresh_token"] as string) ?? "";
    const ei = (tokenData["expires_in"] as number) ?? 1800;
    storeTokens("market", at, rt, ei);
    res.json(ExchangeCodeResponse.parse({
      accessToken: at,
      refreshToken: rt,
      expiresIn: ei,
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
  const appKey = process.env.SCHWAB_TRADER_APP_KEY || process.env.SCHWAB_APP_KEY;
  const appSecret = process.env.SCHWAB_TRADER_APP_SECRET || process.env.SCHWAB_APP_SECRET;

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
    const newAt = tokenData["access_token"] as string;
    const newRt = (tokenData["refresh_token"] as string) ?? refreshToken;
    const newEi = (tokenData["expires_in"] as number) ?? 1800;
    storeTokens("market", newAt, newRt, newEi);
    res.json(RefreshTokenResponse.parse({
      accessToken: newAt,
      refreshToken: newRt,
      expiresIn: newEi,
      tokenType: tokenData["token_type"],
    }));
  } catch (err) {
    req.log.error({ err }, "Token refresh error");
    res.status(500).json({ error: "internal_error", message: "Failed to refresh token" });
  }
});

router.get("/trader-url", (_req, res) => {
  const appKey = process.env.SCHWAB_TRADER_APP_KEY;
  const redirectUri = getTraderRedirectUri();

  if (!appKey || !redirectUri) {
    return res.json({ url: "", configured: false });
  }

  cleanExpired();
  const state = "trader_" + crypto.randomBytes(24).toString("hex");
  pendingStates.set(state, Date.now());

  const params = new URLSearchParams({
    response_type: "code",
    client_id: appKey,
    redirect_uri: redirectUri,
    state,
  });

  const url = `${SCHWAB_AUTH_BASE}?${params.toString()}`;
  res.json({ url, configured: true });
});

router.get("/trader-callback", async (req, res) => {
  const code = req.query["code"] as string | undefined;
  const state = req.query["state"] as string | undefined;

  if (!code) {
    return res.status(400).send(errorPage("Missing Code", "No authorization code was received from Schwab."));
  }

  if (!state || !pendingStates.has(state)) {
    req.log.warn({ state: state?.slice(0, 8) }, "GET /trader-callback — invalid or missing state");
    return res.status(400).send(errorPage("Invalid Request", "OAuth state validation failed. Please try again."));
  }
  pendingStates.delete(state);

  const appKey = process.env.SCHWAB_TRADER_APP_KEY;
  const appSecret = process.env.SCHWAB_TRADER_APP_SECRET;
  const redirectUri = getTraderRedirectUri();

  if (!appKey || !appSecret || !redirectUri) {
    return res.status(400).send(errorPage("Not Configured", "Trader API credentials are not configured."));
  }

  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", redirectUri);

  req.log.info(
    { redirect_uri: redirectUri, code_length: code.length },
    "GET /trader-callback — exchanging code for Trader tokens"
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
      req.log.error({ status: response.status, body: responseText }, "Trader token exchange failed");
      return res.status(400).send(errorPage("Authentication Failed", "Schwab Trader API returned an error. Please try again."));
    }

    let tokenData: Record<string, unknown>;
    try {
      tokenData = JSON.parse(responseText);
    } catch {
      return res.status(502).send(errorPage("Unexpected Response", "Received an invalid response from Schwab."));
    }

    const accessToken = tokenData["access_token"];
    const refreshToken = tokenData["refresh_token"];

    if (typeof accessToken !== "string" || !accessToken) {
      return res.status(502).send(errorPage("Invalid Token", "Schwab did not return a valid Trader access token."));
    }

    const trRfTok = typeof refreshToken === "string" ? refreshToken : "";
    const trExpiresIn = typeof tokenData["expires_in"] === "number" ? tokenData["expires_in"] : 1800;

    storeTokens("trader", accessToken, trRfTok, trExpiresIn);
    storeTokens("market", accessToken, trRfTok, trExpiresIn);
    pendingTokens.set("trader_latest", { accessToken, refreshToken: trRfTok, ts: Date.now() });
    pendingTokens.set("latest", { accessToken, refreshToken: trRfTok, ts: Date.now() });

    req.log.info("GET /trader-callback — Trader token exchange succeeded (stored as market + trader)");
    res.redirect("/");
  } catch (err) {
    req.log.error({ err }, "GET /trader-callback network error");
    res.status(500).send(errorPage("Connection Error", "Could not reach Schwab API."));
  }
});

router.get("/trader-pending-session", (_req, res) => {
  const pending = pendingTokens.get("trader_latest");
  if (!pending || Date.now() - pending.ts > TOKEN_TTL_MS) {
    return res.json({ found: false });
  }
  pendingTokens.delete("trader_latest");
  res.json({
    found: true,
    accessToken: pending.accessToken,
    refreshToken: pending.refreshToken,
  });
});

router.post("/trader-refresh", async (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken) {
    return res.status(400).json({ error: "missing_refresh_token" });
  }

  const appKey = process.env.SCHWAB_TRADER_APP_KEY;
  const appSecret = process.env.SCHWAB_TRADER_APP_SECRET;

  if (!appKey || !appSecret) {
    return res.status(400).json({ error: "not_configured", message: "Trader API credentials not configured" });
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
      req.log.error({ status: response.status, body: responseText }, "Trader token refresh failed");
      return res.status(400).json({ error: "refresh_failed", message: responseText.slice(0, 200) });
    }

    const tokenData = JSON.parse(responseText) as Record<string, unknown>;
    const trAt = tokenData["access_token"] as string;
    const trRt = (tokenData["refresh_token"] as string) ?? refreshToken;
    const trEi = (tokenData["expires_in"] as number) ?? 1800;
    storeTokens("trader", trAt, trRt, trEi);
    res.json({
      accessToken: trAt,
      refreshToken: trRt,
      expiresIn: trEi,
    });
  } catch (err) {
    req.log.error({ err }, "Trader token refresh error");
    res.status(500).json({ error: "internal_error", message: "Failed to refresh trader token" });
  }
});

router.post("/disconnect", (_req, res) => {
  clearServerTokens("market");
  clearServerTokens("trader");
  stopStreamer();
  res.json({ ok: true });
});

router.get("/server-tokens", (_req, res) => {
  const mkt = hasValidTokens("market") ? getTokens("market") : undefined;
  const trd = hasValidTokens("trader") ? getTokens("trader") : undefined;
  res.json({
    market: mkt ? { accessToken: mkt.accessToken, refreshToken: mkt.refreshToken, expiresAt: mkt.expiresAt } : null,
    trader: trd ? { accessToken: trd.accessToken, refreshToken: trd.refreshToken, expiresAt: trd.expiresAt } : null,
  });
});

router.get("/status", (_req, res) => {
  const configured = !!(
    (process.env.SCHWAB_TRADER_APP_KEY && process.env.SCHWAB_TRADER_APP_SECRET && getTraderRedirectUri()) ||
    (process.env.SCHWAB_APP_KEY && process.env.SCHWAB_APP_SECRET && getSchwabRedirectUri())
  );
  const claudeConfigured = !!process.env.ANTHROPIC_API_KEY;
  res.json(GetAuthStatusResponse.parse({ configured, claudeConfigured }));
});

export default router;
