import { useEffect } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { signalSchwabAuthLost, clearSchwabAuthNotice } from "@/lib/authNoticeStore";

const POLL_MS = 5 * 60 * 1000;
const WARN_BEFORE_MS = 48 * 60 * 60 * 1000;

type SchwabOAuthPanel = {
  connected?: boolean;
  refresh_token_expires_at?: number | null;
};

type ServerTokensOauth = {
  schwab_oauth?: {
    app1?: SchwabOAuthPanel;
    app2?: SchwabOAuthPanel;
  };
};

function formatExpiryEt(ms: number): string {
  try {
    return new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York" });
  } catch {
    return new Date(ms).toISOString();
  }
}

async function pollSchwabOAuthExpiry(): Promise<void> {
  try {
    const res = await fetchWithAuth("/api/auth/server-tokens");
    if (!res.ok) return;
    const data = (await res.json()) as ServerTokensOauth;
    const now = Date.now();
    const app1 = data.schwab_oauth?.app1;
    const app2 = data.schwab_oauth?.app2;
    const app1Exp = app1?.refresh_token_expires_at ?? null;
    const app2Exp = app2?.refresh_token_expires_at ?? null;

    const app1Needs =
      app1Exp != null && (app1Exp <= now || app1Exp - now < WARN_BEFORE_MS) && app1?.connected;
    const app2Needs =
      app2?.connected && app2Exp != null && (app2Exp <= now || app2Exp - now < WARN_BEFORE_MS);

    if (app2Needs && !app1Needs) {
      const detail = app2Exp != null ? `Market-data login expires ${formatExpiryEt(app2Exp)} ET.` : undefined;
      signalSchwabAuthLost(
        app2Exp != null && app2Exp <= now
          ? "Schwab market-data session ended."
          : "Schwab market-data login expires soon.",
        detail,
        "market_data_app2",
      );
      return;
    }

    if (app1Needs) {
      const detail = app1Exp != null ? `Brokerage login expires ${formatExpiryEt(app1Exp)} ET.` : undefined;
      signalSchwabAuthLost(
        app1Exp != null && app1Exp <= now
          ? "Schwab brokerage session ended."
          : "Schwab brokerage login expires soon.",
        detail,
        "brokerage",
      );
      return;
    }

    if (app1?.connected && (!app2?.connected || (app2Exp != null && app2Exp > now))) {
      clearSchwabAuthNotice();
    }
  } catch {
    /* ignore */
  }
}

/** Warn when either Schwab app refresh grant is within 48h of expiry (7-day OAuth clock). */
export function useSchwabOAuthExpiryWatch(): void {
  useEffect(() => {
    void pollSchwabOAuthExpiry();
    const id = window.setInterval(() => {
      void pollSchwabOAuthExpiry();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void pollSchwabOAuthExpiry();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}