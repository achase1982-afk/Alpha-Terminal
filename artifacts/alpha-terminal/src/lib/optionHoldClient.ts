import { buildStreamHolderId } from "./streamClientId";

export type OptionHoldPostOpts = {
  purpose?: string;
  viewId?: string;
  holderId?: string;
  underlyingPrice?: number;
  isAborted?: () => boolean;
};

/** True when a completed POST should be tracked as an active hold. */
export function shouldTrackOptionHold(isMounted: boolean, isAborted: () => boolean | undefined): boolean {
  if (!isMounted) return false;
  if (isAborted?.()) return false;
  return true;
}

/** Build holder id for a stream client option hold. */
export function resolveOptionStreamHolderId(
  clientId: string,
  purpose: string,
  viewId: string,
  explicitHolderId?: string,
): string {
  return explicitHolderId ?? buildStreamHolderId(clientId, purpose, viewId);
}

export function sortedSymbolSig(symbols: string[]): string {
  return [...new Set(symbols)].sort().join("\n");
}

export function payloadsEqual(a: string[], b: string[]): boolean {
  return sortedSymbolSig(a) === sortedSymbolSig(b);
}
