/** Notional $/point for root futures symbols (display form, e.g. /ES). */
const ROOT_MULTIPLIER: Record<string, number> = {
  "/ES": 50,
  "/NQ": 20,
  "/MES": 5,
  "/MNQ": 2,
  "/RTY": 50,
  "/YM": 5,
};

export const DESK_LIVE_FLOW_FUTURES_ROOTS = new Set(Object.keys(ROOT_MULTIPLIER));

const FUTURES_CONTRACT_RE = /^\/[A-Z]{2,4}[FGHJKMNQUVXZ]\d{2}$/;

export function deskLiveFlowFuturesRoot(displaySym: string): string {
  const u = displaySym.trim().toUpperCase();
  const withSlash = u.startsWith("/") ? u : `/${u}`;
  const root = withSlash.match(/^\/[A-Z]+/)?.[0];
  return root ?? withSlash;
}

export function deskLiveFlowFuturesContractMultiplier(displaySym: string): number | null {
  const root = deskLiveFlowFuturesRoot(displaySym);
  if (ROOT_MULTIPLIER[root] != null) return ROOT_MULTIPLIER[root]!;
  const m = displaySym.trim().toUpperCase().match(FUTURES_CONTRACT_RE);
  if (!m) return null;
  const contractRoot = deskLiveFlowFuturesRoot(m[0] ?? displaySym);
  return ROOT_MULTIPLIER[contractRoot] ?? null;
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