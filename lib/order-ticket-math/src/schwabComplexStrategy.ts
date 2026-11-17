import type { EconomicsLeg } from "./orderEconomics.js";

export type SchwabComplexStrategyType =
  | "NONE"
  | "VERTICAL"
  | "CALENDAR"
  | "DIAGONAL"
  | "STRANGLE"
  | "STRADDLE"
  | "BUTTERFLY"
  | "IRON_CONDOR"
  | "IRON_BUTTERFLY"
  | "CUSTOM";

export interface SchwabComplexLeg extends EconomicsLeg {
  schwabSymbol?: string;
}

function symExpiry(sym: string): string {
  return sym.length >= 12 ? sym.substring(6, 12) : "";
}

function symCp(sym: string): "C" | "P" | "" {
  if (sym.length < 13) return "";
  const c = sym.charAt(12);
  return c === "C" || c === "P" ? c : "";
}

function normType(t: string): "CALL" | "PUT" | "" {
  const u = t.toUpperCase();
  if (u === "CALL" || u === "C") return "CALL";
  if (u === "PUT" || u === "P") return "PUT";
  return "";
}

function isIronCondorShape(legs: SchwabComplexLeg[]): boolean {
  if (legs.length !== 4) return false;
  const exps = new Set(legs.map((l) => l.expiration ?? symExpiry(l.schwabSymbol ?? "")));
  if (exps.size !== 1) return false;
  const puts = legs.filter((l) => normType(l.optionType) === "PUT");
  const calls = legs.filter((l) => normType(l.optionType) === "CALL");
  if (puts.length !== 2 || calls.length !== 2) return false;
  const shortPut = puts.find((l) => l.instruction.startsWith("SELL"));
  const longPut = puts.find((l) => l.instruction.startsWith("BUY"));
  const shortCall = calls.find((l) => l.instruction.startsWith("SELL"));
  const longCall = calls.find((l) => l.instruction.startsWith("BUY"));
  if (!shortPut || !longPut || !shortCall || !longCall) return false;
  if (!(shortPut.strike > longPut.strike && longCall.strike > shortCall.strike)) return false;
  if (!(shortPut.strike < shortCall.strike)) return false;
  const putWing = shortPut.strike - longPut.strike;
  const callWing = longCall.strike - shortCall.strike;
  if (putWing !== callWing) return false;
  return true;
}

function isIronButterfly(legs: SchwabComplexLeg[]): boolean {
  if (legs.length !== 4) return false;
  const exps = new Set(legs.map((l) => l.expiration ?? symExpiry(l.schwabSymbol ?? "")));
  if (exps.size !== 1) return false;
  const puts = legs.filter((l) => normType(l.optionType) === "PUT");
  const calls = legs.filter((l) => normType(l.optionType) === "CALL");
  if (puts.length !== 2 || calls.length !== 2) return false;
  const shortPut = puts.find((l) => l.instruction.startsWith("SELL"));
  const longPut = puts.find((l) => l.instruction.startsWith("BUY"));
  const shortCall = calls.find((l) => l.instruction.startsWith("SELL"));
  const longCall = calls.find((l) => l.instruction.startsWith("BUY"));
  if (!shortPut || !longPut || !shortCall || !longCall) return false;
  if (shortPut.strike !== shortCall.strike) return false;
  if (longPut.strike >= shortPut.strike || longCall.strike <= shortCall.strike) return false;
  const wing = shortPut.strike - longPut.strike;
  if (longCall.strike - shortCall.strike !== wing) return false;
  return true;
}

function isButterfly(legs: SchwabComplexLeg[]): boolean {
  if (legs.length !== 3) return false;
  const exps = new Set(legs.map((l) => l.expiration ?? symExpiry(l.schwabSymbol ?? "")));
  if (exps.size !== 1) return false;
  const types = new Set(legs.map((l) => normType(l.optionType)).filter(Boolean));
  if (types.size !== 1) return false;
  const strikes = [...new Set(legs.map((l) => l.strike))].sort((a, b) => a - b);
  if (strikes.length !== 3) return false;
  const qty: Record<number, number> = {};
  for (const l of legs) {
    const sign = l.instruction.startsWith("BUY") ? 1 : -1;
    qty[l.strike] = (qty[l.strike] ?? 0) + sign * (l.quantity ?? 1);
  }
  const [lo, mid, hi] = strikes;
  return qty[lo] === 1 && qty[mid] === -2 && qty[hi] === 1;
}

export function inferSchwabComplexOrderStrategyType(legs: SchwabComplexLeg[]): SchwabComplexStrategyType {
  if (legs.length <= 1) return "NONE";

  const exp = (l: SchwabComplexLeg) => l.expiration ?? symExpiry(l.schwabSymbol ?? "");

  if (legs.length === 2) {
    const e0 = exp(legs[0]);
    const e1 = exp(legs[1]);
    const t0 = normType(legs[0].optionType) || symCp(legs[0].schwabSymbol ?? "");
    const t1 = normType(legs[1].optionType) || symCp(legs[1].schwabSymbol ?? "");
    if (e0 === e1 && t0 && t1 && t0 === t1) return "VERTICAL";
    if (e0 === e1 && t0 && t1 && t0 !== t1) {
      if (legs[0].strike === legs[1].strike) return "STRADDLE";
      return "STRANGLE";
    }
    if (e0 !== e1 && t0 && t1 && t0 === t1 && legs[0].strike === legs[1].strike) return "CALENDAR";
    if (e0 !== e1 && t0 && t1 && t0 === t1) return "DIAGONAL";
    return "CUSTOM";
  }

  if (legs.length === 3 && isButterfly(legs)) return "BUTTERFLY";

  if (legs.length === 4) {
    if (isIronButterfly(legs)) return "IRON_BUTTERFLY";
    if (isIronCondorShape(legs)) return "IRON_CONDOR";
    return "CUSTOM";
  }

  return "CUSTOM";
}