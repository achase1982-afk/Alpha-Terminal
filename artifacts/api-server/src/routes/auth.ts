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

function getTraderRedirectUri(): string {
  return (isProd ? process.env.SCHWAB_TRADER_REDIRECT_URI_PROD : process.env.SCHWAB_TRADER_REDIRECT_URI) || "";
}

const pendingTokens = new Map<string, { accessToken: string; refreshToken: string; ts: number }>();
const STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_TTL_MS = 5 * 60 * 1000;

function cleanExpired() {
  const now = Date.now();
  for (const [key, val] of pendingTokens) {
    if (now - val.ts > TOKEN_TTL_MS) pendingTokens.delete(key);
  }
}

// Stateless OAuth state: nonce.ts.hmac, signed with the app secret so any
// API-server instance can verify any callback. This avoids losing state
// across horizontally-scaled instances or process restarts.
function getStateSecret(): string {
  return process.env.SCHWAB_TRADER_APP_SECRET || process.env.SESSION_SECRET || "dev-state-secret-fallback";
}

function signState(prefix: string = ""): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const ts = Date.now().toString(36);
  const payload = `${prefix}${nonce}.${ts}`;
  const mac = crypto.createHmac("sha256", getStateSecret()).update(payload).digest("hex").slice(0, 32);
  return `${payload}.${mac}`;
}

function verifyState(state: string | undefined, prefix: string = ""): boolean {
  if (!state || typeof state !== "string") return false;
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [noncePart, ts, mac] = parts;
  if (!noncePart || !ts || !mac) return false;
  if (prefix && !noncePart.startsWith(prefix)) return false;
  if (!prefix && /^[a-z]+_/.test(noncePart)) return false; // reject prefixed states for unprefixed flows
  const payload = `${noncePart}.${ts}`;
  const expected = crypto.createHmac("sha256", getStateSecret()).update(payload).digest("hex").slice(0, 32);
  let macBuf: Buffer, expBuf: Buffer;
  try {
    macBuf = Buffer.from(mac, "hex");
    expBuf = Buffer.from(expected, "hex");
  } catch {
    return false;
  }
  if (macBuf.length !== expBuf.length || !crypto.timingSafeEqual(macBuf, expBuf)) return false;
  const issuedAt = parseInt(ts, 36);
  if (!Number.isFinite(issuedAt)) return false;
  if (Date.now() - issuedAt > STATE_TTL_MS) return false;
  return true;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function basicAuth(appKey: string, appSecret: string): string {
  return "Basic " + Buffer.from(`${appKey}:${appSecret}`).toString("base64");
}

function traderSuccessPage() {
  // IMPORTANT: do NOT redirect this page to "/". When the OAuth flow runs
  // inside an iOS in-app browser overlay (opened from a PWA via
  // `<a target="_blank">`), the overlay does NOT carry the PWA's auth
  // cookies. Navigating to "/" here would load the bare app inside the
  // overlay, which then fails the auth check and shows the Clerk sign-in
  // screen \u2014 confusing the user even though the PWA underneath already
  // has the token waiting.
  //
  // Instead: try `window.close()` silently a few times (works for true
  // popups; no-ops for iOS overlay tabs), and otherwise just show a clean
  // "tap the X to return" message. The PWA's visibilitychange handler will
  // pick up the new trader token from /api/auth/trader-pending-session as
  // soon as the user dismisses the overlay.
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connected</title></head>
    <body style="background:#0A0F16;color:#fff;font-family:-apple-system,system-ui,sans-serif;padding:60px 20px;text-align:center;margin:0">
      <div style="font-size:14px;color:#FFB800;letter-spacing:0.18em;font-weight:700;margin-bottom:14px">ALPHA TERMINAL</div>
      <div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:rgba(0,200,140,0.15);margin-bottom:18px">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00C88C" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <h2 style="color:#00C88C;font-size:18px;margin:0 0 10px">Connected to Schwab</h2>
      <p style="color:#bbb;font-size:14px;line-height:1.55;margin:0 0 8px;max-width:320px;margin-left:auto;margin-right:auto">Your brokerage is linked.</p>
      <p style="color:#888;font-size:13px;line-height:1.55;margin:0 0 28px;max-width:320px;margin-left:auto;margin-right:auto">Tap the <strong style="color:#fff">X</strong> in the top corner to return to Alpha Terminal. Your portfolio will load automatically.</p>
      <button id="closeBtn" style="display:inline-block;background:#FFB800;color:#000;font-size:13px;font-weight:700;letter-spacing:0.05em;padding:10px 28px;border:none;border-radius:8px;cursor:pointer;font-family:-apple-system,system-ui,sans-serif">CLOSE THIS PAGE</button>
      <script>
        (function () {
          function closeSelf() { try { window.close(); } catch (e) {} }
          // Best-effort self close (works only for true script-opened popups;
          // silently no-ops on iOS in-app browser overlays). Never navigate
          // to "/" \u2014 see comment in traderSuccessPage().
          closeSelf();
          setTimeout(closeSelf, 250);
          setTimeout(closeSelf, 1000);
          var btn = document.getElementById('closeBtn');
          if (btn) btn.addEventListener('click', closeSelf);
        })();
      </script>
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
  const appKey = process.env.SCHWAB_TRADER_APP_KEY;
  const redirectUri = getTraderRedirectUri();

  if (!appKey || !redirectUri) {
    return res.json(GetAuthUrlResponse.parse({ url: "", configured: false }));
  }

  cleanExpired();
  // Use "trader_" prefix so the state matches what /trader-callback validates.
  // The old /callback route (no prefix) is kept for backwards compat but the
  // registered Schwab redirect URI points to /trader-callback.
  const state = signState("trader_");

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
  res.json({ redirectUri: getTraderRedirectUri() });
});

router.get("/callback", async (req, res) => {
  const code = req.query["code"] as string | undefined;
  const state = req.query["state"] as string | undefined;

  if (!code) {
    return res.status(400).send(errorPage("Missing Code", "No authorization code was received from Schwab."));
  }

  if (!verifyState(state)) {
    req.log.warn({ state: state?.slice(0, 8) }, "GET /callback — invalid or missing state parameter");
    return res.status(400).send(errorPage("Invalid Request", "OAuth state validation failed. Please try signing in again."));
  }

  const appKey = process.env.SCHWAB_TRADER_APP_KEY;
  const appSecret = process.env.SCHWAB_TRADER_APP_SECRET;
  const redirectUri = getTraderRedirectUri();

  if (!appKey || !appSecret || !redirectUri) {
    return res.status(400).send(errorPage("Not Configured", "Schwab Trader API credentials are not configured."));
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
  const appKey = process.env.SCHWAB_TRADER_APP_KEY;
  const appSecret = process.env.SCHWAB_TRADER_APP_SECRET;
  const redirectUri = getTraderRedirectUri();

  if (!appKey || !appSecret || !redirectUri) {
    return res.status(400).json({ error: "not_configured", message: "Schwab Trader API credentials not configured" });
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
  const appKey = process.env.SCHWAB_TRADER_APP_KEY;
  const appSecret = process.env.SCHWAB_TRADER_APP_SECRET;

  if (!appKey || !appSecret) {
    return res.status(400).json({ error: "not_configured", message: "Schwab Trader API credentials not configured" });
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
  const state = signState("trader_");

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

  if (!verifyState(state, "trader_")) {
    req.log.warn({ state: state?.slice(0, 8) }, "GET /trader-callback — invalid or missing state");
    return res.status(400).send(errorPage("Invalid Request", "OAuth state validation failed. Please try again."));
  }

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
    res.send(traderSuccessPage());
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
    process.env.SCHWAB_TRADER_APP_KEY && process.env.SCHWAB_TRADER_APP_SECRET && getTraderRedirectUri()
  );
  const claudeConfigured = !!process.env.ANTHROPIC_API_KEY;
  res.json(GetAuthStatusResponse.parse({ configured, claudeConfigured }));
});

export default router;
