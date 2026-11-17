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

/** Infer credit vs debit for a 2-leg vertical from short/long strikes (same option type). */
export function inferNetCreditFromLegStructure(legs: EconomicsLeg[]): boolean | null {
  if (legs.length !== 2) return null;
  const allCalls = legs.every((l) => l.optionType === "CALL");
  const allPuts = legs.every((l) => l.optionType === "PUT");
  if (!allCalls && !allPuts) return null;
  const sell = legs.find((l) => l.instruction.startsWith("SELL"));
  const buy = legs.find((l) => l.instruction.startsWith("BUY"));
  if (!sell || !buy) return null;
  if (allCalls) return sell.strike < buy.strike;
  if (allPuts) return sell.strike > buy.strike;
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

  const qty = Math.max(1, ...legs.map((l) => l.quantity ?? 1));
  const isOption = legs.some((l) => isOptionAsset(l.instrument?.assetType));

  if (!isOption) {
    return {
      legs: [],
      limitPrice: price,
      quantity: qty,
      isCredit: false,
      isOption: false,
      contractCount: qty,
    };
  }

  const econLegs: EconomicsLeg[] = [];
  for (const leg of legs) {
    if (!isOptionAsset(leg.instrument?.assetType)) continue;
    const sym = leg.instrument?.symbol ?? "";
    const parsed = parseSchwabOptionSymbol(sym);
    if (!parsed) return null;
    econLegs.push({
      strike: parsed.strike,
      optionType: parsed.optionType,
      instruction: normalizeInstruction(leg.instruction ?? "BUY_TO_OPEN"),
      expiration: parsed.expiration,
    });
  }

  let isCredit = schwabOrderIsCredit(order);
  if (isCredit == null && econLegs.length >= 2) {
    isCredit = inferNetCreditFromLegStructure(econLegs);
  }
  if (isCredit == null) {
    const sellCount = econLegs.filter((l) => l.instruction.startsWith("SELL")).length;
    const buyCount = econLegs.filter((l) => l.instruction.startsWith("BUY")).length;
    if (sellCount !== buyCount) return null;
    isCredit = false;
  }

  const contractCount = legs.reduce((s, l) => s + (l.quantity ?? 1), 0) * qty;

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
  if (!econ) return { kind: "unknown" };
  return { kind: "known", maxRisk: econ.maxRisk };
}
