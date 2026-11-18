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

const FUTURES_DISPLAY_RE = /^\/([A-Z0-9]{1,4}?)([FGHJKMNQUVXZ]\d{2})?$/;

export function deskLiveFlowFuturesRoot(displaySym: string): string {
  const u = displaySym.trim().toUpperCase();
  if (!u.startsWith("/")) return `/${u}`;
  const m = u.match(FUTURES_DISPLAY_RE);
  if (!m?.[1]) return u;
  const root = `/${m[1]}`;
  if (ROOT_MULTIPLIER[root] != null) return root;
  return u;
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

export function deskLiveFlowFuturesSupportedRoots(): string[] {
  return [...DESK_LIVE_FLOW_FUTURES_ROOTS].sort();
}