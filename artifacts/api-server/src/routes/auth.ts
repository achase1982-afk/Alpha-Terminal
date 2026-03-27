import { Router, type IRouter } from "express";
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

/** Build a Basic auth header from app key + secret */
function basicAuth(appKey: string, appSecret: string): string {
  return "Basic " + Buffer.from(`${appKey}:${appSecret}`).toString("base64");
}

router.get("/url", (_req, res) => {
  const appKey = process.env.SCHWAB_APP_KEY;
  const redirectUri = process.env.SCHWAB_REDIRECT_URI;

  if (!appKey || !redirectUri) {
    return res.json(GetAuthUrlResponse.parse({ url: "", configured: false }));
  }

  const params = new URLSearchParams({
    response_type: "code",
    client_id: appKey,
    redirect_uri: redirectUri,
  });

  const url = `${SCHWAB_AUTH_BASE}?${params.toString()}`;
  res.json(GetAuthUrlResponse.parse({ url, configured: true }));
});

/** Expose the exact redirect URI from env so the frontend always uses the right one */
router.get("/redirect-uri", (_req, res) => {
  res.json({ redirectUri: process.env.SCHWAB_REDIRECT_URI || "" });
});

router.post("/callback", async (req, res) => {
  const parsed = ExchangeCodeBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "validation_error", message: "Invalid request body" });
  }

  const { code } = parsed.data;
  const appKey = process.env.SCHWAB_APP_KEY;
  const appSecret = process.env.SCHWAB_APP_SECRET;
  // Always use the env-registered redirect URI — never trust the client-supplied value
  const redirectUri = process.env.SCHWAB_REDIRECT_URI;

  if (!appKey || !appSecret || !redirectUri) {
    return res.status(400).json({ error: "not_configured", message: "Schwab credentials not configured in environment" });
  }

  // Build x-www-form-urlencoded body per Schwab docs
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
      // Surface the Schwab error message directly to help debug
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
