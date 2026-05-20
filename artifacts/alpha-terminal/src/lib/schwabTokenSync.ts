import { fetchWithAuth } from "./fetchWithAuth";
import { useTerminalStore } from "./store";

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

/** Ask the server to refresh Schwab using its persisted refresh token (not the client copy). */
export async function refreshSchwabViaServer(): Promise<{
  ok: boolean;
  status: number;
  bodyText: string;
}> {
  try {
    const res = await fetchWithAuth("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
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
