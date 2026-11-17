import { hash8 } from "./streamClientId";

/** Stable chain hold signature: viewId + sorted stream keys (immune to spot-only rerenders). */
export function buildChainHoldSignature(
  symbol: string,
  expirations: string[],
  streamKeys: string[],
): { viewId: string; holdSig: string; keys: string[] } {
  const exp = [...new Set(expirations)].sort().join(",");
  const viewId = `chain:${symbol}:${hash8(exp)}`;
  const keys = [...new Set(streamKeys)].sort();
  const holdSig = `${viewId}\0${keys.join("\n")}`;
  return { viewId, holdSig, keys };
}
