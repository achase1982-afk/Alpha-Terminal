import { hash8 } from "@/lib/streamClientId";

/** Active Trader ladder hold: separate viewId so chain and AT don't fight the same holder. */
export function buildAtHoldSignature(
  symbol: string,
  expiration: string,
  streamKeys: string[],
): { viewId: string; holdSig: string; keys: string[] } {
  const viewId = `chain:${symbol}:${hash8(expiration)}:at`;
  const keys = [...new Set(streamKeys)].sort();
  const holdSig = `${viewId}\0${keys.join("\n")}`;
  return { viewId, holdSig, keys };
}