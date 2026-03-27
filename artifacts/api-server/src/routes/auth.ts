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

const router: IRouter = Router();

const SCHWAB_AUTH_BASE = "https://api.schwabapi.com/v1/oauth/authorize";
const SCHWAB_TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";

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

router.get("/url", (_req, res) => {
  const appKey = process.env.SCHWAB_APP_KEY;
  const redirectUri = process.env.SCHWAB_REDIRECT_URI;

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
  res.json({ redirectUri: process.env.SCHWAB_REDIRECT_URI || "" });
});

router.get("/callback", async (req, res) => {
  const code = req.query["code"] as string | undefined;
  const state = req.query["state"] as string | undefined;
  const errorPage = (title: string, msg: string) => `
    <!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="background:#0A0F16;color:#fff;font-family:-apple-system,system-ui,sans-serif;padding:40px 20px;text-align:center">
      <h2 style="color:#FF1744;font-size:18px">${escapeHtml(title)}</h2>
      <p style="color:#ccc;font-size:14px;line-height:1.5">${escapeHtml(msg)}</p>
      <p style="margin-top:30px;font-size:13px;color:#666">Close this tab and return to Alpha Terminal to try again.</p>
    </body></html>`;

  if (!code) {
    return res.status(400).send(errorPage("Missing Code", "No authorization code was received from Schwab."));
  }

  if (!state || !pendingStates.has(state)) {
    req.log.warn({ state: state?.slice(0, 8) }, "GET /callback — invalid or missing state parameter");
    return res.status(400).send(errorPage("Invalid Request", "OAuth state validation failed. Please try signing in again."));
  }
  pendingStates.delete(state);

  const appKey = process.env.SCHWAB_APP_KEY;
  const appSecret = process.env.SCHWAB_APP_SECRET;
  const redirectUri = process.env.SCHWAB_REDIRECT_URI;

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

    pendingTokens.set("latest", {
      accessToken,
      refreshToken: typeof refreshToken === "string" ? refreshToken : "",
      ts: Date.now(),
    });

    req.log.info("GET /callback — token exchange succeeded, sending success page");

    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0A0F16;color:#fff;font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;text-align:center}</style>
      </head><body>
        <div style="max-width:360px">
          <div style="width:60px;height:60px;border-radius:50%;background:#0090FF22;margin:0 auto 16px;display:flex;align-items:center;justify-content:center">
            <svg width="28" height="28" fill="none" stroke="#0090FF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
          </div>
          <h2 style="color:#0090FF;font-size:20px;margin:0 0 8px">Connected to Schwab!</h2>
          <p style="color:#ccc;font-size:14px;line-height:1.5;margin:0 0 20px">Your session is ready.</p>
          <p style="color:#999;font-size:13px;line-height:1.5;margin:0 0 24px">Go back to the Alpha Terminal app in Replit to start trading. Your tokens have been saved and will be loaded automatically.</p>
          <p style="color:#555;font-size:11px">You can close this tab now.</p>
        </div>
      </body></html>`);
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
