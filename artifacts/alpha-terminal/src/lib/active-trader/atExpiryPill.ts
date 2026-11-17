const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function parseExpDate(expStr: string): Date | null {
  if (!expStr) return null;
  const clean = expStr.split(":")[0].trim();
  const iso = clean.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]), 12, 0, 0);
  const d = new Date(clean);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Expiry pill copy for Active Trader header, e.g. `17 NOV · 0DTE PM`. */
export function formatAtExpiryPill(expiration: string, dte: number, underlying: string): string {
  const d = parseExpDate(expiration);
  const root = underlying.replace(/^\$/, "").toUpperCase();
  const dayMonth = d ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : expiration.slice(0, 8);
  const dtePart = dte === 0 ? "0DTE" : `${Math.round(dte)}D`;
  const pmSettle = root === "SPX" || root === "XSP" || root === "NDX" || root === "RUT";
  return pmSettle ? `${dayMonth} · ${dtePart} PM` : `${dayMonth} · ${dtePart}`;
}

export function formatStrikeLevel(n: number | null): string {
  if (n == null) return "\u2014";
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}