/** Call vs put from Schwab OCC key (SPXW  261117C05000000). */
export function deskLiveFlowOptionSide(key: string): "call" | "put" | null {
  const u = key.trim().toUpperCase();
  const m = u.match(/\d{6}([CP])\d/i);
  if (!m?.[1]) return null;
  return m[1] === "C" ? "call" : "put";
}

export function deskLiveFlowIsSpxOptionKey(key: string): boolean {
  const u = key.trim().toUpperCase();
  return u.startsWith("SPXW") || (u.startsWith("SPX") && !u.startsWith("SPXW"));
}