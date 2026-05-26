import pLimit from "p-limit";
import { getBestAccessToken } from "../tokenStore.js";
import { nyCalendarYmd } from "../usEquityMarketCalendar.js";
import { logger } from "../logger.js";

const SCHWAB_API_BASE = "https://api.schwabapi.com/marketdata/v1";
const POLYGON_API = "https://api.polygon.io";
const PROBE_TIMEOUT_MS = 12_000;
const probeLimit = pLimit(8);

export type CatalystOptionsChainVerdict = "yes" | "no" | "unknown";

/**
 * Live chain-existence check for Catalysts rebuild only — never reads options_chain_daily.
 * Timeout / transport failure → `unknown` (keep the name).
 */
export async function resolveLiveOptionsChainVerdicts(
  symbols: string[],
): Promise<Map<string, CatalystOptionsChainVerdict>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase().trim()).filter(Boolean))];
  const out = new Map<string, CatalystOptionsChainVerdict>();
  if (unique.length === 0) return out;

  await Promise.all(
    unique.map((sym) =>
      probeLimit(async () => {
        out.set(sym, await probeOne(sym));
      }),
    ),
  );

  return out;
}

async function probeOne(symbol: string): Promise<CatalystOptionsChainVerdict> {
  const polygon = await polygonHasContracts(symbol);
  if (polygon === "yes" || polygon === "no") return polygon;

  const schwab = await schwabHasOptionsChain(symbol);
  if (schwab === "yes" || schwab === "no") return schwab;

  return "unknown";
}

async function polygonHasContracts(symbol: string): Promise<CatalystOptionsChainVerdict> {
  const apiKey = (process.env["POLYGON_API_KEY"] ?? "").trim();
  if (!apiKey) return "unknown";

  const today = nyCalendarYmd(new Date());
  const url =
    `${POLYGON_API}/v3/reference/options/contracts` +
    `?underlying_ticker=${encodeURIComponent(symbol.toUpperCase())}` +
    `&expiration_date.gte=${today}` +
    `&limit=1` +
    `&apiKey=${apiKey}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!res.ok) {
      logger.debug({ symbol, status: res.status }, "Polygon options contract probe failed");
      return "unknown";
    }
    const json = (await res.json()) as { results?: unknown[] };
    const n = Array.isArray(json.results) ? json.results.length : 0;
    return n > 0 ? "yes" : "no";
  } catch (err) {
    logger.debug({ symbol, err }, "Polygon options contract probe error");
    return "unknown";
  }
}

async function schwabHasOptionsChain(symbol: string): Promise<CatalystOptionsChainVerdict> {
  const token = getBestAccessToken();
  if (!token) return "unknown";

  const params = new URLSearchParams({
    symbol: symbol.toUpperCase(),
    contractType: "CALL",
    strikeCount: "1",
    range: "NTM",
  });
  const url = `${SCHWAB_API_BASE}/chains?${params.toString()}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return "unknown";
    const json = (await res.json()) as Record<string, unknown>;
    const callMap = json["callExpDateMap"];
    const has =
      callMap != null && typeof callMap === "object" && Object.keys(callMap).length > 0;
    return has ? "yes" : "no";
  } catch {
    return "unknown";
  }
}
