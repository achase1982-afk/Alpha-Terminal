import type { EconomicsLeg } from "./orderEconomics.js";

export function normalizeLegExpiration(exp?: string | null): string {
  if (!exp?.trim()) return "";
  return exp.split(":")[0].trim();
}

/** True when every leg shares one expiration (or legs omit expiry — treated as single). */
export function isSingleExpiryStrategy(legs: EconomicsLeg[]): boolean {
  const keys = new Set(
    legs.map((l) => normalizeLegExpiration(l.expiration)).filter((k) => k.length > 0),
  );
  return keys.size <= 1;
}