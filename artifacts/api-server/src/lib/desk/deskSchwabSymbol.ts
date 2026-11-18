import { classShareSchwabStreamKey, isClassShareSymbol } from "../classShareSymbology.js";
import { schwabFuturesKey } from "../schwabStreamer.js";

const INDEX_SYMBOL_MAP: Record<string, string> = {
  VIX: "$VIX",
  $VIX: "$VIX",
  SPX: "$SPX",
  $SPX: "$SPX",
  NDX: "$NDX",
  $NDX: "$NDX",
  RUT: "$RUT",
  $RUT: "$RUT",
};

export function deskFormatSchwabSymbol(symbol: string): string {
  let upper = symbol.toUpperCase().trim();
  if (upper.startsWith("/")) {
    return schwabFuturesKey(upper);
  }
  if (upper.endsWith(".X") && upper.startsWith("$")) {
    upper = upper.slice(0, -2);
  }
  const mapped = INDEX_SYMBOL_MAP[upper] ?? upper;
  if (isClassShareSymbol(mapped)) return classShareSchwabStreamKey(mapped);
  return mapped;
}

export function deskIsIndex(symbol: string): boolean {
  const upper = symbol.toUpperCase().trim();
  const bare = upper.endsWith(".X") && upper.startsWith("$") ? upper.slice(0, -2) : upper;
  return bare in INDEX_SYMBOL_MAP;
}