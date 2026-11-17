import { computeOrderEconomics, type EconomicsLeg } from "./orderEconomics.js";

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

export function parseSchwabOptionSymbol(symbol: string): { strike: number; optionType: "CALL" | "PUT" } | null {
  const trimmed = symbol.trim();
  if (trimmed.length < 15) return null;
  const cpChar = trimmed.charAt(trimmed.length - 9);
  if (cpChar !== "C" && cpChar !== "P") return null;
  const strikeRaw = trimmed.slice(-8);
  if (!/^\d{8}$/.test(strikeRaw)) return null;
  const strike = parseInt(strikeRaw, 10) / 1000;
  if (!Number.isFinite(strike)) return null;
  return { strike, optionType: cpChar === "C" ? "CALL" : "PUT" };
}

export type OrderMaxRiskResult =
  | { kind: "known"; maxRisk: number }
  | { kind: "unknown" };

/** Max loss for server gate — mirrors ticket economics where possible. */
export function schwabOrderMaxRisk(order: SchwabOrderLike): OrderMaxRiskResult {
  const legs = order.orderLegCollection ?? [];
  const price = typeof order.price === "number" && order.price > 0 ? order.price : null;
  const qty = Math.max(1, ...legs.map((l) => l.quantity ?? 1));

  const assetTypes = legs.map((l) => (l.instrument?.assetType ?? "EQUITY").toUpperCase());
  const isOption = assetTypes.some((a) => a === "OPTION" || a === "COLLECTIVE_INVESTMENT");

  if (isOption) {
    const instructions = legs.map((l) => normalizeInstruction(l.instruction ?? ""));
    const isNakedShort = legs.length === 1 && instructions[0] === "SELL_TO_OPEN";
    if (isNakedShort) return { kind: "unknown" };

    const econLegs: EconomicsLeg[] = [];
    for (const leg of legs) {
      const sym = leg.instrument?.symbol ?? "";
      const parsed = parseSchwabOptionSymbol(sym);
      if (!parsed) return { kind: "unknown" };
      econLegs.push({
        strike: parsed.strike,
        optionType: parsed.optionType,
        instruction: normalizeInstruction(leg.instruction ?? "BUY_TO_OPEN"),
      });
    }

    const sellOpens = instructions.filter((i) => i === "SELL_TO_OPEN").length;
    const buyOpens = instructions.filter((i) => i === "BUY_TO_OPEN").length;
    const isCredit = sellOpens > buyOpens;

    if (price == null) return { kind: "unknown" };

    const econ = computeOrderEconomics({
      legs: econLegs,
      limitPrice: price,
      quantity: qty,
      isCredit,
      isOption: true,
      contractCount: legs.reduce((s, l) => s + (l.quantity ?? 1), 0) * qty,
    });
    if (!econ) return { kind: "unknown" };
    return { kind: "known", maxRisk: econ.maxRisk };
  }

  if (price == null) return { kind: "unknown" };
  const notional = price * qty;
  return { kind: "known", maxRisk: notional };
}
