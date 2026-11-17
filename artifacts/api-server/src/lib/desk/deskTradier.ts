import { deskEnv } from "./deskEnv.js";
import { deskTouchFeed, deskMarkFeedNotConfigured, deskMarkFeedError } from "./deskFeedFreshness.js";

const TRADIER_BASE = "https://api.tradier.com/v1";

export function getTradierToken(): string {
  return deskEnv("TRADIER_API_KEY", "TRADIER_TOKEN");
}

export async function deskTradierQuotes(symbols: string[]): Promise<{ quotes: Record<string, unknown>[]; asOfMs: number }> {
  const token = getTradierToken();
  if (!token) {
    deskMarkFeedNotConfigured("tradier");
    return { quotes: [], asOfMs: Date.now() };
  }

  const sym = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean).join(",");
  const url = `${TRADIER_BASE}/markets/quotes?symbols=${encodeURIComponent(sym)}&greeks=false`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    deskMarkFeedError("tradier", `tradier_http_${res.status}`);
    return { quotes: [], asOfMs: Date.now() };
  }
  const json = (await res.json()) as { quotes?: { quote?: unknown } };
  const q = json.quotes?.quote;
  const list = q == null ? [] : Array.isArray(q) ? q : [q];
  const asOfMs = Date.now();
  deskTouchFeed("tradier", asOfMs, "tradier");
  return { quotes: list as Record<string, unknown>[], asOfMs };
}