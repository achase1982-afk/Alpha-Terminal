import type { Request, Response } from "express";
import {
  deskSchwab2AppKey,
  deskSchwab2AppSecret,
  getSchwab2RedirectUri,
  schwab2StateAfterBrokerage,
  verifySchwab2State,
} from "./deskSchwab2OAuth.js";
import { storeSchwab2Tokens } from "./deskSchwab2TokenStore.js";
import {
  errorPage,
  schwab2StandaloneSuccessPage,
  traderSuccessPage,
} from "./schwabOAuthPages.js";

const SCHWAB_TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";

function basicAuth(appKey: string, appSecret: string): string {
  return "Basic " + Buffer.from(`${appKey}:${appSecret}`).toString("base64");
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
  const redirectUri = getSchwab2RedirectUri();

  if (!appKey || !appSecret || !redirectUri) {
    res.status(400).send(errorPage("Not Configured", "Schwab market-data app credentials are not configured."));
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
      res.status(400).send(errorPage("Authentication Failed", "Schwab market-data authorization failed."));
      return true;
    }

    const tokenData = JSON.parse(responseText) as Record<string, unknown>;
    const accessToken = tokenData["access_token"];
    const refreshToken = tokenData["refresh_token"];
    if (typeof accessToken !== "string" || !accessToken) {
      res.status(502).send(errorPage("Invalid Token", "Schwab did not return a valid access token."));
      return true;
    }

    const rfTok = typeof refreshToken === "string" ? refreshToken : "";
    const expiresIn = typeof tokenData["expires_in"] === "number" ? tokenData["expires_in"] : 1800;
    await storeSchwab2Tokens(accessToken, rfTok, expiresIn, { newGrant: true });
    req.log.info("Schwab app 2 OAuth callback succeeded");
    if (schwab2StateAfterBrokerage(state)) {
      res.send(traderSuccessPage({ marketDataAlsoConnected: true }));
    } else {
      res.send(schwab2StandaloneSuccessPage());
    }
    return true;
  } catch (err) {
    req.log.error({ err }, "Schwab app 2 OAuth network error");
    res.status(500).send(errorPage("Connection Error", "Could not reach Schwab API."));
    return true;
  }
}
