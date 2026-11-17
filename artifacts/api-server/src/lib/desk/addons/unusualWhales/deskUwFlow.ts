export function deskUwFlowTickerQuery(symbol: string | undefined): string | undefined {
  if (!symbol?.trim()) return undefined;
  const s = symbol.trim().toUpperCase().replace(/^\$/, "");
  if (s === "SPX") return "SPX,SPXW";
  return s;
}

export function deskFilterUwFlowAlerts(alerts: unknown[], symbol: string | undefined): unknown[] {
  if (!symbol?.trim()) return alerts;
  const want = new Set(
    deskUwFlowTickerQuery(symbol)!
      .split(",")
      .map((t) => t.trim().toUpperCase()),
  );
  return alerts.filter((row) => {
    if (!row || typeof row !== "object") return false;
    const o = row as Record<string, unknown>;
    const candidates = [
      o["ticker"],
      o["ticker_symbol"],
      o["underlying_symbol"],
      o["underlying"],
      o["symbol"],
      o["root_symbol"],
    ];
    for (const c of candidates) {
      if (typeof c !== "string") continue;
      const t = c.toUpperCase().replace(/^\$/, "");
      if (want.has(t)) return true;
    }
    return false;
  });
}
