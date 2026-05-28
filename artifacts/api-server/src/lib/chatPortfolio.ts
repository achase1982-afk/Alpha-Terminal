/**
 * Portfolio snapshot for chat — same Schwab accounts payload as GET /api/portfolio/accounts.
 */
const SCHWAB_TRADER = "https://api.schwabapi.com/trader/v1";

export type ChatPortfolioPosition = {
  symbol: string;
  underlyingSymbol: string;
  description: string;
  assetType: string;
  netQuantity: number;
  averagePrice: number;
  marketValue: number;
  dayPL: number;
  openPL: number;
};

export type ChatPortfolioSnapshot = {
  available: boolean;
  error?: string;
  accountMasked?: string;
  dayPL?: number;
  totalPL?: number;
  liquidationValue?: number;
  buyingPower?: number;
  equity?: number;
  positionCount?: number;
  positions: ChatPortfolioPosition[];
};

function mapPositions(raw: unknown): ChatPortfolioPosition[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatPortfolioPosition[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const row = p as Record<string, unknown>;
    const inst = (row.instrument ?? {}) as Record<string, unknown>;
    const longQ = Number(row.longQuantity ?? 0);
    const shortQ = Number(row.shortQuantity ?? 0);
    const net = longQ - shortQ;
    if (net === 0 && !row.marketValue) continue;
    out.push({
      symbol: String(inst.symbol ?? ""),
      underlyingSymbol: String(inst.underlyingSymbol ?? inst.symbol ?? ""),
      description: String(inst.description ?? inst.symbol ?? ""),
      assetType: String(inst.assetType ?? ""),
      netQuantity: net,
      averagePrice: Number(row.averagePrice ?? 0),
      marketValue: Number(row.marketValue ?? 0),
      dayPL: Number(row.currentDayProfitLoss ?? 0),
      openPL: Number(row.longOpenProfitLoss ?? 0),
    });
  }
  out.sort((a, b) => Math.abs(b.marketValue) - Math.abs(a.marketValue));
  return out;
}

export async function fetchChatPortfolioSnapshot(
  traderAccessToken: string | null | undefined,
  positionLimit = 25,
): Promise<ChatPortfolioSnapshot> {
  const token = traderAccessToken?.trim();
  if (!token) {
    return { available: false, error: "no_trader_token", positions: [] };
  }
  try {
    const res = await fetch(`${SCHWAB_TRADER}/accounts?fields=positions`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return { available: false, error: `schwab_${res.status}`, positions: [] };
    }
    const accounts = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(accounts) || accounts.length === 0) {
      return { available: true, positions: [], positionCount: 0 };
    }

    const sa = accounts[0]?.securitiesAccount as Record<string, unknown> | undefined;
    if (!sa) return { available: false, error: "no_account", positions: [] };

    const proj = (sa.projectedBalances ?? sa.currentBalances) as Record<string, unknown> | undefined;
    const cur = (sa.currentBalances ?? {}) as Record<string, unknown>;
    const initBal = (sa.initialBalances ?? {}) as Record<string, unknown>;
    const bal = { ...cur, ...(proj ?? {}) };

    const curLiq = Number(proj?.liquidationValue ?? cur.liquidationValue ?? 0);
    const initLiq = Number(initBal.liquidationValue ?? initBal.accountValue ?? 0);
    const positions = mapPositions(sa.positions).slice(0, positionLimit);
    const totalPL = positions.reduce((s, p) => s + p.openPL, 0);

    const acctNum = String(sa.accountNumber ?? "");
    return {
      available: true,
      accountMasked: acctNum.length > 4 ? `****${acctNum.slice(-4)}` : acctNum,
      dayPL: curLiq - initLiq,
      totalPL,
      liquidationValue: Number(bal.liquidationValue ?? curLiq),
      buyingPower: Number(bal.buyingPower ?? 0),
      equity: Number(bal.equity ?? 0),
      positionCount: mapPositions(sa.positions).length,
      positions,
    };
  } catch {
    return { available: false, error: "fetch_failed", positions: [] };
  }
}

/** Internal ambient block — no account numbers beyond masked suffix. */
export function formatChatPortfolioAmbientBlock(snapshot: ChatPortfolioSnapshot): string {
  if (!snapshot.available) {
    return "Portfolio (internal): unavailable — Schwab trader session not connected.";
  }
  if (snapshot.positions.length === 0) {
    return "Portfolio (internal): connected, no open positions.";
  }
  const lines = [
    "Portfolio (internal):",
    `Account ${snapshot.accountMasked ?? "—"} | equity $${Math.round(snapshot.equity ?? 0).toLocaleString()} | day P/L $${Math.round(snapshot.dayPL ?? 0).toLocaleString()} | open P/L $${Math.round(snapshot.totalPL ?? 0).toLocaleString()}`,
    `Holdings (${snapshot.positionCount ?? snapshot.positions.length} total, top ${snapshot.positions.length} by size):`,
  ];
  for (const p of snapshot.positions.slice(0, 12)) {
    const qty = p.netQuantity;
    const side = qty > 0 ? "long" : qty < 0 ? "short" : "flat";
    lines.push(
      `- ${p.underlyingSymbol || p.symbol}: ${side} ${Math.abs(qty)} @ avg ${p.averagePrice.toFixed(2)}, mkt $${Math.round(p.marketValue).toLocaleString()}, day P/L $${Math.round(p.dayPL).toLocaleString()}`,
    );
  }
  return lines.join("\n");
}
