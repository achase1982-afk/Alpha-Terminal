import { getOptionTick, getQuoteBySymbol, normalizeEquityKey } from "./schwabStreamer.js";

/** Matches `mapSchwabSecuritiesAccount` position rows from schwabPortfolioAccounts.ts */
export type PortfolioPositionRow = {
  symbol?: string;
  underlyingSymbol?: string;
  assetType?: string;
  longQuantity?: number;
  shortQuantity?: number;
  averagePrice?: number;
  marketValue?: number;
  currentDayProfitLoss?: number;
  currentDayProfitLossPercentage?: number;
  longOpenProfitLoss?: number;
  previousSessionLongQuantity?: number;
  previousSessionShortQuantity?: number;
  closePrice?: number | null;
  streamMark?: number | null;
  streamMarkTs?: number | null;
};

export type PortfolioMappedAccount = {
  positions?: PortfolioPositionRow[];
  balances?: {
    liquidationValue?: number;
    longMarketValue?: number;
    shortMarketValue?: number;
    longOptionMarketValue?: number;
    shortOptionMarketValue?: number;
    [key: string]: unknown;
  };
  initialBalances?: { liquidationValue?: number; accountValue?: number };
  dayPL?: number;
  totalPL?: number;
};

function isOptionLike(assetType: string | undefined): boolean {
  return assetType === "OPTION" || assetType === "INDEX_OPTION" || assetType === "FUTURE_OPTION";
}

function positionContractMultiplier(assetType: string | undefined): number {
  if (!isOptionLike(assetType)) return 1;
  if (assetType === "FUTURE_OPTION") return 1;
  return 100;
}

function applyMarkToPosition(p: PortfolioPositionRow, mark: number, now: number): boolean {
  const longQty = p.longQuantity ?? 0;
  const shortQty = p.shortQuantity ?? 0;
  const avg = p.averagePrice ?? 0;
  const mult = positionContractMultiplier(p.assetType);
  const prevMv = p.marketValue ?? 0;
  const prevOpen = p.longOpenProfitLoss ?? 0;

  let openPl = 0;
  if (longQty > 0) openPl += (mark - avg) * longQty * mult;
  if (shortQty > 0) openPl += (avg - mark) * shortQty * mult;

  const marketValue = mark * (longQty - shortQty) * mult;

  let dayPl = p.currentDayProfitLoss ?? 0;
  const close = p.closePrice;
  const prevLong = p.previousSessionLongQuantity ?? 0;
  const prevShort = p.previousSessionShortQuantity ?? 0;
  const openedLongToday = longQty > 0 && prevLong === 0;
  const openedShortToday = shortQty > 0 && prevShort === 0;
  const dayBasis =
    openedLongToday || openedShortToday
      ? avg
      : close != null && Number.isFinite(close)
        ? close
        : null;
  if (dayBasis != null && Number.isFinite(dayBasis)) {
    dayPl = (mark - dayBasis) * (longQty - shortQty) * mult;
  }

  p.streamMark = mark;
  p.streamMarkTs = now;
  p.marketValue = marketValue;
  p.longOpenProfitLoss = openPl;
  p.currentDayProfitLoss = dayPl;
  const cost =
    longQty > 0
      ? avg * longQty * mult
      : shortQty > 0
        ? avg * shortQty * mult
        : 0;
  p.currentDayProfitLossPercentage =
    dayBasis != null && dayBasis > 0
      ? ((mark - dayBasis) / dayBasis) * 100 * (longQty > 0 ? 1 : -1)
      : cost > 0.01
        ? (dayPl / cost) * 100
        : p.currentDayProfitLossPercentage ?? 0;

  return (
    Math.abs((prevMv ?? 0) - marketValue) > 0.0001 ||
    Math.abs(prevOpen - openPl) > 0.0001
  );
}

/** Overlay stream L1 marks onto Schwab REST position rows. Returns true if any mark moved. */
export function overlayPortfolioMarksFromStream(mapped: PortfolioMappedAccount[]): boolean {
  const now = Date.now();
  let anyChanged = false;
  for (const acct of mapped) {
    let mvDelta = 0;
    let openPlTotal = 0;
    let longEq = 0;
    let shortEq = 0;
    let longOpt = 0;
    let shortOpt = 0;

    for (const p of acct.positions ?? []) {
      if (!p.symbol) continue;
      let mark: number | null = null;
      if (isOptionLike(p.assetType)) {
        const tick = getOptionTick(p.symbol);
        mark =
          tick?.mark ??
          tick?.last ??
          (tick?.bid != null && tick?.ask != null ? (tick.bid + tick.ask) / 2 : null);
      } else {
        const sym = normalizeEquityKey(p.symbol);
        const snap = getQuoteBySymbol(sym);
        if (
          snap?.quoteSource === "SCHWAB" ||
          snap?.quoteSource === "WEBULL" ||
          snap?.quoteSource === undefined
        ) {
          mark = snap?.last ?? null;
        }
      }
      if (mark == null || !Number.isFinite(mark)) {
        openPlTotal += p.longOpenProfitLoss ?? 0;
        const mv = p.marketValue ?? 0;
        if (isOptionLike(p.assetType)) {
          if (mv >= 0) longOpt += mv;
          else shortOpt += mv;
        } else if (mv >= 0) longEq += mv;
        else shortEq += mv;
        continue;
      }
      const prevMv = p.marketValue ?? 0;
      if (applyMarkToPosition(p, mark, now)) anyChanged = true;
      mvDelta += (p.marketValue ?? 0) - prevMv;
      openPlTotal += p.longOpenProfitLoss ?? 0;
      const mv = p.marketValue ?? 0;
      if (isOptionLike(p.assetType)) {
        if (mv >= 0) longOpt += mv;
        else shortOpt += mv;
      } else if (mv >= 0) longEq += mv;
      else shortEq += mv;
    }

    if (acct.balances) {
      acct.balances.longMarketValue = longEq;
      acct.balances.shortMarketValue = shortEq;
      acct.balances.longOptionMarketValue = longOpt;
      acct.balances.shortOptionMarketValue = shortOpt;
      if (typeof acct.balances.liquidationValue === "number") {
        acct.balances.liquidationValue = acct.balances.liquidationValue + mvDelta;
      }
    }
    acct.totalPL = openPlTotal;
    const initLiq = acct.initialBalances?.liquidationValue ?? acct.initialBalances?.accountValue ?? 0;
    if (typeof acct.balances?.liquidationValue === "number" && initLiq > 0) {
      acct.dayPL = acct.balances.liquidationValue - initLiq;
    }
  }
  return anyChanged;
}

export function collectPortfolioStreamSymbols(mapped: PortfolioMappedAccount[]): Set<string> {
  const out = new Set<string>();
  for (const acct of mapped) {
    for (const p of acct.positions ?? []) {
      if (!p.symbol) continue;
      out.add(p.symbol.toUpperCase());
      if (p.underlyingSymbol) out.add(p.underlyingSymbol.toUpperCase());
      if (isOptionLike(p.assetType)) out.add(p.symbol);
      else out.add(normalizeEquityKey(p.symbol));
    }
  }
  return out;
}
