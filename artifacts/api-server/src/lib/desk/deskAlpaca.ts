import { deskEnv } from "./deskEnv.js";
import { deskTouchFeed, deskMarkFeedNotConfigured, deskMarkFeedError } from "./deskFeedFreshness.js";

const ALPACA_DATA = "https://data.alpaca.markets";

export function getAlpacaKeys(): { keyId: string; secret: string } {
  const keyId = deskEnv("ALPACA_API_KEY_ID", "APCA_API_KEY_ID");
  const secret = deskEnv("ALPACA_API_SECRET_KEY", "APCA_API_SECRET_KEY");
  return { keyId, secret };
}

export async function deskAlpacaQuotes(
  symbols: string[],
): Promise<{ quotes: Record<string, unknown>[]; asOfMs: number }> {
  const { keyId, secret } = getAlpacaKeys();
  if (!keyId || !secret) {
    deskMarkFeedNotConfigured("alpaca");
    return { quotes: [], asOfMs: Date.now() };
  }

  const out: Record<string, unknown>[] = [];
  let latest = Date.now();

  for (const raw of symbols) {
    const sym = raw.trim().toUpperCase();
    if (!sym) continue;
    const url = `${ALPACA_DATA}/v2/stocks/${encodeURIComponent(sym)}/quotes/latest`;
    const res = await fetch(url, {
      headers: {
        "APCA-API-KEY-ID": keyId,
        "APCA-API-SECRET-KEY": secret,
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      deskMarkFeedError("alpaca", `alpaca_http_${res.status}`);
      continue;
    }
    const json = (await res.json()) as { quote?: Record<string, unknown> };
    if (json.quote) {
      out.push({ symbol: sym, ...json.quote });
      const t = json.quote["t"] as string | undefined;
      if (t) latest = Math.max(latest, Date.parse(t));
    }
  }

  if (out.length) deskTouchFeed("alpaca");
  return { quotes: out, asOfMs: latest };
}