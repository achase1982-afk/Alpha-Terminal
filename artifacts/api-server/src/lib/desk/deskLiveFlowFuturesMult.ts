/** Notional $/point for root futures symbols (display form, e.g. /ES). */
const ROOT_MULTIPLIER: Record<string, number> = {
  "/ES": 50,
  "/NQ": 20,
  "/MES": 5,
  "/MNQ": 2,
  "/RTY": 50,
  "/YM": 5,
};

export function deskLiveFlowFuturesRoot(displaySym: string): string {
  const u = displaySym.trim().toUpperCase();
  const withSlash = u.startsWith("/") ? u : `/${u}`;
  const root = withSlash.match(/^\/[A-Z]+/)?.[0];
  return root ?? withSlash;
}

export function deskLiveFlowFuturesContractMultiplier(displaySym: string): number | null {
  const root = deskLiveFlowFuturesRoot(displaySym);
  return ROOT_MULTIPLIER[root] ?? null;
}

export function deskLiveFlowFuturesNotionalDollars(
  displaySym: string,
  price: number,
  contracts: number,
): number | null {
  const mult = deskLiveFlowFuturesContractMultiplier(displaySym);
  if (mult == null) return null;
  return price * contracts * mult;
}