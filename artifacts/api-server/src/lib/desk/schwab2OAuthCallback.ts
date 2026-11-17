import type { Request, Response } from "express";
import { deskSchwab2AppKey, deskSchwab2AppSecret, verifySchwab2State } from "./deskSchwab2OAuth.js";
import { getSchwabBrokerageRedirectUri } from "./schwabOAuthRedirect.js";
import { storeSchwab2Tokens } from "./deskSchwab2TokenStore.js";

const SCHWAB_TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";

function basicAuth(appKey: string, appSecret: string): string {
  return "Basic " + Buffer.from(`${appKey}:${appSecret}`).toString("base64");
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function schwab2OAuthSuccessHtml(): string {
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connected</title></head>
    <body style="background:#0A0F16;color:#fff;font-family:-apple-system,system-ui,sans-serif;padding:60px 20px;text-align:center;margin:0">
      <div style="font-size:14px;color:#FFB800;letter-spacing:0.18em;font-weight:700;margin-bottom:14px">ALPHA TERMINAL</div>
      <h2 style="color:#00C88C;font-size:18px;margin:0 0 10px">Schwab connected</h2>
      <p style="color:#bbb;font-size:14px;line-height:1.55;margin:0 0 28px;max-width:320px;margin-left:auto;margin-right:auto">Brokerage and market data are linked. Tap the <strong style="color:#fff">X</strong> to return to Alpha Terminal.</p>
      <button id="closeBtn" style="display:inline-block;background:#FFB800;color:#000;font-size:13px;font-weight:700;padding:10px 28px;border:none;border-radius:8px;cursor:pointer;">CLOSE THIS PAGE</button>
      <script>
        (function () { function c(){try{window.close()}catch(e){}} c(); setTimeout(c,500); document.getElementById('closeBtn')?.addEventListener('click', c); })();
      </script>
    </body></html>`;
}

function oauthErrorPage(title: string, msg: string): string {
  return `<!DOCTYPE html><html><body style="background:#0A0F16;color:#fff;font-family:sans-serif;padding:60px 20px;text-align:center">
      <h2 style="color:#FF1744">${escapeHtml(title)}</h2><p>${escapeHtml(msg)}</p></body></html>`;
}

export function isSchwab2OAuthState(state: string | undefined): boolean {
  return verifySchwab2State(state);
}

export async function handleSchwab2OAuthCallback(
  req: Request,
  res: Response,
  code: string,
  state: string | undefined,
): Promise<boolean> {
  if (!verifySchwab2State(state)) return false;

  const appKey = deskSchwab2AppKey();
  const appSecret = deskSchwab2AppSecret();
  const redirectUri = getSchwabBrokerageRedirectUri();

  if (!appKey || !appSecret || !redirectUri) {
    res.status(400).send(oauthErrorPage("Not Configured", "Schwab market-data app credentials are not configured."));
    return true;
  }

  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", redirectUri);

  try {
    const response = await fetch(SCHWAB_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: basicAuth(appKey, appSecret),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    const responseText = await response.text();

    if (!response.ok) {
      req.log.error({ status: response.status, body: responseText.slice(0, 300) }, "Schwab app2 token exchange failed");
      res.status(400).send(oauthErrorPage("Authentication Failed", "Schwab market-data authorization failed."));
      return true;
    }

    const tokenData = JSON.parse(responseText) as Record<string, unknown>;
    const accessToken = tokenData["access_token"];
    const refreshToken = tokenData["refresh_token"];
    if (typeof accessToken !== "string" || !accessToken) {
      res.status(502).send(oauthErrorPage("Invalid Token", "Schwab did not return a valid access token."));
      return true;
    }

    const rfTok = typeof refreshToken === "string" ? refreshToken : "";
    const expiresIn = typeof tokenData["expires_in"] === "number" ? tokenData["expires_in"] : 1800;
    await storeSchwab2Tokens(accessToken, rfTok, expiresIn, { newGrant: true });
    req.log.info("Schwab app 2 OAuth callback succeeded");
    res.send(schwab2OAuthSuccessHtml());
    return true;
  } catch (err) {
    req.log.error({ err }, "Schwab app 2 OAuth network error");
    res.status(500).send(oauthErrorPage("Connection Error", "Could not reach Schwab API."));
    return true;
  }
}