/**
 * Enrichment fields for persisted options prints (DTE, session phase, venue).
 */

/** Common OPRA TRF / ADF exchange ids (extend via ops review). */
const TRF_EXCHANGE_IDS = new Set([301, 302, 303, 304, 305, 306, 307, 308, 309, 310]);

/** OPRA / SIP exchange id → coarse venue bucket (Item 12). */
export function venueClassFromExchangeId(exchangeId: number | null | undefined): "on_exchange" | "trf" | "unknown" {
  if (exchangeId == null || !Number.isFinite(exchangeId)) return "unknown";
  if (TRF_EXCHANGE_IDS.has(Math.floor(exchangeId))) return "trf";
  if (exchangeId > 0) return "on_exchange";
  return "unknown";
}

function nyParts(ms: number): { ymd: string; hm: number } {
  const d = new Date(ms);
  const ymd = d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const parts = d.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const [hh, mm] = parts.split(":").map((x) => Number(x));
  const hm = (Number.isFinite(hh) ? hh : 0) * 60 + (Number.isFinite(mm) ? mm : 0);
  return { ymd, hm };
}

/** RTH-relative phase for prints (Item 11). */
export function sessionPhaseFromTradeMs(tradeMs: number): "open_auction" | "mid_session" | "close_auction" | "unknown" {
  const { hm } = nyParts(tradeMs);
  // 9:30 = 570, 10:00 = 600, 15:30 = 930, 16:00 = 960
  if (hm >= 570 && hm < 600) return "open_auction";
  if (hm >= 930 && hm < 960) return "close_auction";
  if (hm >= 600 && hm < 930) return "mid_session";
  return "unknown";
}

export function dteCalendarDays(expirationYmd: string, tradeMs: number): number {
  const exp = new Date(`${expirationYmd}T20:00:00Z`).getTime();
  const t = tradeMs;
  return Math.max(0, Math.round((exp - t) / 86_400_000));
}
