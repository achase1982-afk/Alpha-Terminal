/** Tabular display helpers. Prices stay on nickel ticks. */

export function roundNickel(n: number): number {
  return Number((Math.round(n * 20) / 20).toFixed(2));
}

export function formatSpot(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatStrike(n: number): string {
  const digits = Number.isInteger(n) ? 0 : Math.abs(n * 2 - Math.round(n * 2)) < 1e-6 ? 1 : 2;
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 2) });
}

export function formatSignedPts(n: number, digits = 2): string {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  const body = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${sign}${body}`;
}

export function formatChange(pts: number, pct: number): string {
  return `${formatSignedPts(pts)} (${formatSignedPts(pct)}%)`;
}

/** Compact premium. 880_000 → $880K, 1_360_000 → $1.36M, signed when asked. */
export function formatPremium(n: number, signed = false): string {
  const abs = Math.abs(n);
  let body: string;
  if (abs >= 1_000_000) body = `$${trimCompact(abs / 1_000_000)}M`;
  else if (abs >= 1_000) body = `$${trimCompact(abs / 1_000)}K`;
  else body = `$${Math.round(abs)}`;
  if (!signed) return n < 0 ? `-${body}` : body;
  if (n > 0) return `+${body}`;
  if (n < 0) return `-${body}`;
  return body;
}

function trimCompact(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return String(Math.round(rounded));
  return rounded.toFixed(2).replace(/0$/, "");
}

export function formatOptionPx(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function formatDollars(n: number): string {
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return `${sign}$${Math.abs(rounded).toLocaleString("en-US")}`;
}

export function formatPnl(n: number): string {
  const rounded = Math.round(n);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  return `${sign}$${Math.abs(rounded).toLocaleString("en-US")}`;
}

export function formatDist(strike: number, spot: number): string {
  const delta = strike - spot;
  const abs = Math.abs(delta).toFixed(2);
  return delta >= 0 ? `${abs} above` : `${abs} below`;
}

export function formatShift(prev: number, strike: number): string {
  const delta = strike - prev;
  const arrow = delta > 0 ? "▲" : "▼";
  const pts = Math.abs(delta).toLocaleString("en-US", { maximumFractionDigits: 0 });
  return `was ${formatStrike(prev)} ${arrow}${pts}`;
}

export function pressurePercents(buy: number, sell: number): { buyPct: number; sellPct: number } {
  const gross = buy + sell;
  if (gross <= 0) return { buyPct: 0, sellPct: 0 };
  const buyPct = Math.round((buy / gross) * 100);
  return { buyPct, sellPct: 100 - buyPct };
}

export function toneForSigned(n: number): string {
  if (n > 0) return "var(--bull-green)";
  if (n < 0) return "var(--bear-red)";
  return "var(--text-primary)";
}
