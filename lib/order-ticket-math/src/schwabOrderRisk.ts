import {
  computeOrderEconomics,
  type EconomicsLeg,
  type OrderEconomicsInput,
} from "./orderEconomics.js";

export interface SchwabOrderLegLike {
  instruction?: string;
  quantity?: number;
  instrument?: { symbol?: string; assetType?: string };
}

export interface SchwabOrderLike {
  orderType?: string;
  price?: number;
  orderLegCollection?: SchwabOrderLegLike[];
}

function normalizeInstruction(instruction: string): string {
  return instruction.trim().toUpperCase().replace(/\s+/g, "_");
}

/** True when every leg is a closing instruction (stock SELL / BUY_TO_COVER, options *_TO_CLOSE). */
export function isClosingSchwabOrder(order: SchwabOrderLike): boolean {
  const legs = order.orderLegCollection ?? [];
  if (legs.length === 0) return false;
  return legs.every((leg) => {
    const ins = normalizeInstruction(leg.instruction ?? "");
    const asset = (leg.instrument?.assetType ?? "EQUITY").toUpperCase();
    const isOption = asset === "OPTION" || asset === "COLLECTIVE_INVESTMENT";
    if (isOption) return ins.includes("TO_CLOSE");
    return ins === "SELL" || ins === "BUY_TO_COVER";
  });
}

export function parseSchwabOptionSymbol(
  symbol: string,
): { strike: number; optionType: "CALL" | "PUT"; expiration?: string } | null {
  const trimmed = symbol.trim();
  if (trimmed.length < 15) return null;
  const cpChar = trimmed.charAt(trimmed.length - 9);
  if (cpChar !== "C" && cpChar !== "P") return null;
  const strikeRaw = trimmed.slice(-8);
  if (!/^\d{8}$/.test(strikeRaw)) return null;
  const strike = parseInt(strikeRaw, 10) / 1000;
  if (!Number.isFinite(strike)) return null;
  const yymmdd = trimmed.slice(-15, -9);
  const expiration =
    /^\d{6}$/.test(yymmdd)
      ? `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`
      : undefined;
  return { strike, optionType: cpChar === "C" ? "CALL" : "PUT", expiration };
}

function isOptionAsset(asset?: string): boolean {
  const a = (asset ?? "EQUITY").toUpperCase();
  return a === "OPTION" || a === "COLLECTIVE_INVESTMENT";
}

function gcdPair(a: number, b: number): number {
  let x = Math.abs(Math.floor(a) || 0);
  let y = Math.abs(Math.floor(b) || 0);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function spreadUnitQty(qtys: number[]): number {
  if (qtys.length === 0) return 1;
  return qtys.reduce((g, q) => gcdPair(g, q || 1), qtys[0] || 1);
}

/** Infer credit vs debit for verticals, iron condors, and butterflies (LIMIT with no NET type). */
export function inferNetCreditFromLegStructure(legs: EconomicsLeg[]): boolean | null {
  if (legs.length === 3) {
    const allCalls = legs.every((l) => l.optionType === "CALL");
    const allPuts = legs.every((l) => l.optionType === "PUT");
    if (!allCalls && !allPuts) return null;
    const sorted = [...legs].sort((a, b) => a.strike - b.strike);
    const [lo, mid, hi] = sorted;
    const q = (l: EconomicsLeg) => l.quantity ?? 1;
    if (q(lo) !== 1 || q(mid) !== 2 || q(hi) !== 1) return null;
    if (lo.instruction.startsWith("BUY") && mid.instruction.startsWith("SELL") && hi.instruction.startsWith("BUY")) {
      return false;
    }
    if (lo.instruction.startsWith("SELL") && mid.instruction.startsWith("BUY") && hi.instruction.startsWith("SELL")) {
      return true;
    }
    return null;
  }
  if (legs.length === 4) {
    const sells = legs.filter((l) => l.instruction.startsWith("SELL"));
    const buys = legs.filter((l) => l.instruction.startsWith("BUY"));
    if (sells.length !== 2 || buys.length !== 2) return null;
    const puts = legs.filter((l) => l.optionType === "PUT");
    const calls = legs.filter((l) => l.optionType === "CALL");
    if (puts.length === 2 && calls.length === 2) {
      const shortPut = puts.find((l) => l.instruction.startsWith("SELL"));
      const longPut = puts.find((l) => l.instruction.startsWith("BUY"));
      const shortCall = calls.find((l) => l.instruction.startsWith("SELL"));
      const longCall = calls.find((l) => l.instruction.startsWith("BUY"));
      if (!shortPut || !longPut || !shortCall || !longCall) return null;
      if (shortPut.strike === shortCall.strike) {
        return shortPut.instruction.startsWith("SELL") ? true : false;
      }
      if (longPut.strike < shortPut.strike && shortCall.strike < longCall.strike) return true;
      if (longPut.strike > shortPut.strike && longCall.strike > shortCall.strike) return false;
      return null;
    }
    if (puts.length === 4) {
      const sorted = [...puts].sort((a, b) => a.strike - b.strike);
      const [k0, k1, k2, k3] = sorted;
      const sell = (l: EconomicsLeg) => l.instruction.startsWith("SELL");
      if (sell(k1) && sell(k2) && !sell(k0) && !sell(k3)) return false;
      if (sell(k0) && sell(k3) && !sell(k1) && !sell(k2)) return true;
      return null;
    }
    if (calls.length === 4) {
      const sorted = [...calls].sort((a, b) => a.strike - b.strike);
      const [k0, k1, k2, k3] = sorted;
      const s = (l: EconomicsLeg) => l.instruction.startsWith("SELL");
      if (s(k0) && s(k3) && !s(k1) && !s(k2)) return true;
      if (s(k1) && s(k2) && !s(k0) && !s(k3)) return false;
      return null;
    }
    return null;
  }
  if (legs.length !== 2) return null;
  const allCalls = legs.every((l) => l.optionType === "CALL");
  const allPuts = legs.every((l) => l.optionType === "PUT");
  if (!allCalls && !allPuts) {
    const buyCount = legs.filter((l) => l.instruction.startsWith("BUY")).length;
    if (buyCount === 2) return false;
    return null;
  }
  const sell = legs.find((l) => l.instruction.startsWith("SELL"));
  const buy = legs.find((l) => l.instruction.startsWith("BUY"));
  if (!sell || !buy) return null;
  const lowStrike = Math.min(sell.strike, buy.strike);
  const highStrike = Math.max(sell.strike, buy.strike);
  const lowLeg = legs.find((l) => l.strike === lowStrike)!;
  const highLeg = legs.find((l) => l.strike === highStrike)!;
  if (allCalls) {
    if (lowLeg.instruction.startsWith("SELL") && highLeg.instruction.startsWith("BUY")) return true;
    if (lowLeg.instruction.startsWith("BUY") && highLeg.instruction.startsWith("SELL")) return false;
    return null;
  }
  if (lowLeg.instruction.startsWith("BUY") && highLeg.instruction.startsWith("SELL")) return true;
  if (lowLeg.instruction.startsWith("SELL") && highLeg.instruction.startsWith("BUY")) return false;
  return null;
}

function maxRiskForInput(input: OrderEconomicsInput): number | null {
  const econ = computeOrderEconomics(input);
  return econ?.maxRisk ?? null;
}

function resolveLimitCreditDebit(
  order: SchwabOrderLike,
  econLegs: EconomicsLeg[],
  price: number,
  qty: number,
  contractCount: number,
): boolean | null {
  if (schwabOrderIsCredit(order) != null) return schwabOrderIsCredit(order);
  const fromStructure = inferNetCreditFromLegStructure(econLegs);
  if (fromStructure != null) return fromStructure;
  const base = {
    legs: econLegs,
    limitPrice: price,
    quantity: qty,
    isOption: true as const,
    contractCount,
  };
  const asDebit = maxRiskForInput({ ...base, isCredit: false });
  const asCredit = maxRiskForInput({ ...base, isCredit: true });
  if (asDebit == null && asCredit == null) return null;
  if (asDebit != null && asCredit == null) return false;
  if (asDebit == null && asCredit != null) return true;
  if (asDebit != null && asCredit != null) {
    if (asDebit === 0 && asCredit === 0) return null;
    return asDebit >= asCredit ? false : true;
  }
  return null;
}

/** Credit/debit from Schwab NET order type — not leg counts. */
export function schwabOrderIsCredit(order: SchwabOrderLike): boolean | null {
  const t = (order.orderType ?? "").trim().toUpperCase();
  if (t === "NET_CREDIT") return true;
  if (t === "NET_DEBIT" || t === "NET_ZERO") return false;
  if (t.includes("CREDIT")) return true;
  if (t.includes("DEBIT")) return false;
  return null;
}

/** Naked shorts, strangles, straddles, ratio spreads — undefined max loss. */
export function schwabOrderHasUncoveredShortRisk(order: SchwabOrderLike): boolean {
  const legs = order.orderLegCollection ?? [];
  const optionLegs = legs.filter((l) => isOptionAsset(l.instrument?.assetType));
  if (optionLegs.length === 0) return false;

  if (optionLegs.length === 2) {
    const assets = optionLegs.map((l) => isOptionAsset(l.instrument?.assetType));
    const types = new Set(
      optionLegs.map((l) => parseSchwabOptionSymbol(l.instrument?.symbol ?? "")?.optionType),
    );
    if (assets.every(Boolean) && types.size === 2) {
      const sells = optionLegs.filter((l) => normalizeInstruction(l.instruction ?? "").startsWith("SELL"));
      const buys = optionLegs.filter((l) => normalizeInstruction(l.instruction ?? "").startsWith("BUY"));
      if (sells.length === 1 && buys.length === 1) return true;
    }
  }

  const instructions = optionLegs.map((l) => normalizeInstruction(l.instruction ?? ""));
  const sellOpens = optionLegs.filter((_, i) => instructions[i] === "SELL_TO_OPEN");
  const buyOpens = optionLegs.filter((_, i) => instructions[i] === "BUY_TO_OPEN");

  if (sellOpens.length === 1 && buyOpens.length === 0) return true;
  if (sellOpens.length >= 2 && buyOpens.length === 0) return true;

  const sellQty = sellOpens.reduce((s, l) => s + (l.quantity ?? 1), 0);
  const buyQty = buyOpens.reduce((s, l) => s + (l.quantity ?? 1), 0);
  if (sellQty > buyQty) return true;

  return false;
}

export function schwabOrderToEconomicsInput(order: SchwabOrderLike): OrderEconomicsInput | null {
  const legs = order.orderLegCollection ?? [];
  const price = typeof order.price === "number" && order.price > 0 ? order.price : null;
  if (price == null) return null;

  const optionLegs = legs.filter((l) => isOptionAsset(l.instrument?.assetType));
  const isOption = optionLegs.length > 0;

  if (!isOption) {
    const equityQty = Math.max(1, ...legs.map((l) => Math.floor(l.quantity ?? 1)));
    const ins = normalizeInstruction(legs[0]?.instruction ?? "BUY");
    const isCredit = ins === "SELL" || ins === "SELL_SHORT";
    return {
      legs: [],
      limitPrice: price,
      quantity: equityQty,
      isCredit,
      isOption: false,
      contractCount: equityQty,
    };
  }

  const legQtys = optionLegs.map((l) => l.quantity ?? 1);
  const qty = spreadUnitQty(legQtys);

  const econLegs: EconomicsLeg[] = [];
  for (const leg of optionLegs) {
    const sym = leg.instrument?.symbol ?? "";
    const parsed = parseSchwabOptionSymbol(sym);
    if (!parsed) return null;
    const legQty = leg.quantity ?? 1;
    econLegs.push({
      strike: parsed.strike,
      optionType: parsed.optionType,
      instruction: normalizeInstruction(leg.instruction ?? "BUY_TO_OPEN"),
      expiration: parsed.expiration,
      quantity: legQty / qty,
    });
  }

  let isCredit = schwabOrderIsCredit(order);
  if (isCredit == null && econLegs.length === 1) {
    if (econLegs[0].instruction.startsWith("BUY")) {
      isCredit = false;
    } else {
      return null;
    }
  } else if (isCredit == null && econLegs.length >= 2) {
    isCredit = resolveLimitCreditDebit(order, econLegs, price, qty, legQtys.reduce((s, n) => s + n, 0));
  }
  if (isCredit == null) return null;

  const contractCount = legQtys.reduce((s, n) => s + n, 0);

  return {
    legs: econLegs,
    limitPrice: price,
    quantity: qty,
    isCredit,
    isOption: true,
    contractCount,
  };
}

export type OrderMaxRiskResult =
  | { kind: "known"; maxRisk: number }
  | { kind: "unknown" };

/** Max loss for server gate — uses the same `computeOrderEconomics` as the ticket. */
export function schwabOrderMaxRisk(order: SchwabOrderLike): OrderMaxRiskResult {
  if (schwabOrderHasUncoveredShortRisk(order)) {
    return { kind: "unknown" };
  }
  const input = schwabOrderToEconomicsInput(order);
  if (!input) return { kind: "unknown" };
  const econ = computeOrderEconomics(input);
  if (!econ || econ.maxRisk == null) return { kind: "unknown" };
  return { kind: "known", maxRisk: econ.maxRisk };
}
