/** CBOE roots whose contract symbol states the settlement session. */
const SETTLEMENT_BY_ROOT: Record<string, "AM" | "PM"> = {
  SPX: "AM",
  SPXW: "PM",
  NDX: "AM",
  NDXP: "PM",
  RUT: "AM",
  RUTW: "PM",
  DJX: "AM",
  XSP: "PM",
};

const SERIES_MARK = "~";

export type OptionSettlement = "AM" | "PM";

/** OCC root from a Schwab option symbol. Unknown shapes return null. */
export function occRoot(symbol: string | null | undefined): string | null {
  if (!symbol) return null;
  let raw = symbol.trim();
  if (raw.startsWith(".")) raw = raw.slice(1);
  if (raw.length < 15) return null;
  const suffix = raw.slice(-15);
  if (!/^\d{6}[CP]\d{8}$/.test(suffix)) return null;
  const root = raw.slice(0, -15).trim();
  return root || null;
}

export function settlementForRoot(root: string | null | undefined): OptionSettlement | null {
  if (!root) return null;
  return SETTLEMENT_BY_ROOT[root.toUpperCase()] ?? null;
}

/** Date plus series, so SPX AM and SPXW PM on the same day stay different expirations. */
export function expirationSeriesKey(expiration: string, symbol?: string | null): string {
  const root = occRoot(symbol);
  if (!root || settlementForRoot(root) == null) return expiration;
  const ymd = expiration.slice(0, 10);
  return `${ymd}${SERIES_MARK}${root.toUpperCase()}`;
}

export function seriesRootFromExpiration(expiration: string): string | null {
  const mark = expiration.indexOf(SERIES_MARK);
  if (mark < 0) return null;
  const root = expiration.slice(mark + 1).trim();
  return root || null;
}

export function settlementFromExpiration(expiration: string): OptionSettlement | null {
  return settlementForRoot(seriesRootFromExpiration(expiration));
}
