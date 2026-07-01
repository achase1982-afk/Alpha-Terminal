import { fetchWithAuth } from "./fetchWithAuth";
import { useTerminalStore } from "./store";
import { clearSchwabAuthNotice } from "./authNoticeStore";

type ServerTokenPayload = {
  accessToken: string;
  refreshToken: string;
};

type ServerTokensResponse = {
  market?: ServerTokenPayload | null;
  trader?: ServerTokenPayload | null;
};

function applyServerTokens(tok: ServerTokenPayload) {
  const { setTokens, setTraderTokens } = useTerminalStore.getState();
  setTokens(tok.accessToken, tok.refreshToken || "");
  setTraderTokens(tok.accessToken, tok.refreshToken || "");
  // Fresh tokens mean the Schwab session is alive again — any "session
  // expired / reconnect Schwab" banner still on screen is stale. Clearing
  // here (the single choke point for token arrival) fixes the banner
  // surviving a successful reconnect when the WS portfolio stream is down
  // or slow to report status "ok".
  clearSchwabAuthNotice();
}

/** Pull canonical Schwab tokens from the API server without consuming a refresh grant. */
export async function syncSchwabTokensFromServer(): Promise<boolean> {
  try {
    const res = await fetchWithAuth("/api/auth/server-tokens");
    if (!res.ok) return false;
    const data = (await res.json()) as ServerTokensResponse;
    const tok = data.trader ?? data.market;
    if (!tok?.accessToken) return false;
    applyServerTokens(tok);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ask the server to refresh Schwab. The server prefers its own persisted
 * refresh token, but we include the client's persisted copy as a fallback:
 * if the server lost its token store (redeploy without the DB store, wiped
 * .data volume) it would otherwise answer "No Schwab session on server"
 * forever even though this device still holds a perfectly valid grant.
 */
export async function refreshSchwabViaServer(): Promise<{
  ok: boolean;
  status: number;
  bodyText: string;
}> {
  const { refreshToken, traderRefreshToken } = useTerminalStore.getState();
  const clientRefreshToken = traderRefreshToken || refreshToken;
  try {
    const res = await fetchWithAuth("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clientRefreshToken ? { refreshToken: clientRefreshToken } : {}),
    });
    const bodyText = await res.text().catch(() => "");
    if (!res.ok) {
      return { ok: false, status: res.status, bodyText };
    }
    try {
      const data = JSON.parse(bodyText) as {
        accessToken?: string;
        refreshToken?: string;
      };
      if (data.accessToken) {
        applyServerTokens({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken ?? "",
        });
        return { ok: true, status: res.status, bodyText };
      }
    } catch {
      /* fall through */
    }
    return { ok: false, status: res.status, bodyText };
  } catch {
    return { ok: false, status: 0, bodyText: "" };
  }
}

export function schwabRefreshErrorDetail(bodyText: string): string | undefined {
  if (!bodyText) return undefined;
  try {
    const j = JSON.parse(bodyText) as { message?: string; error?: string };
    const pick = j.message || j.error;
    return typeof pick === "string" && pick.length > 0 ? pick : undefined;
  } catch {
    return bodyText.length > 200 ? `${bodyText.slice(0, 199)}…` : bodyText;
  }
}
