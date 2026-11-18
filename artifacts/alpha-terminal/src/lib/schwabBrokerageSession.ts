import { isAuthDisabled } from "@/lib/authMode";

/** Non-secret client placeholder: server holds the real Schwab tokens when auth is disabled. */
export const SERVER_BROKERAGE_SENTINEL = "server" as const;

export type ServerTokensSlot =
  | { accessToken: string; refreshToken?: string }
  | { connected: true; expiresAt?: number | string }
  | null
  | undefined;

export type ServerTokensPayload = {
  market?: ServerTokensSlot;
  trader?: ServerTokensSlot;
};

export function isServerBrokerageSentinel(token: string | null | undefined): boolean {
  return token === SERVER_BROKERAGE_SENTINEL;
}

/** True when the UI should treat Schwab market/trader APIs as available (real token or server-held). */
export function hasSchwabBrokerageLinked(
  accessToken: string | null | undefined,
  traderAccessToken?: string | null | undefined,
): boolean {
  return !!(accessToken || traderAccessToken);
}

function slotConnected(slot: ServerTokensSlot): boolean {
  if (!slot) return false;
  if ("accessToken" in slot && slot.accessToken) return true;
  if ("connected" in slot && slot.connected) return true;
  return false;
}

/** In reviewer mode, hydrate store from `connected` flags without exposing raw tokens. */
export function shouldApplyServerBrokerageSentinel(data: ServerTokensPayload): boolean {
  if (!isAuthDisabled()) return false;
  return slotConnected(data.trader) || slotConnected(data.market);
}

export function serverBrokerageSentinelPair(): { access: string; refresh: string } {
  return { access: SERVER_BROKERAGE_SENTINEL, refresh: "" };
}

/** Omit sentinel from Schwab query params / request bodies — the API uses server tokens. */
export function schwabAccessTokenForRequest(token: string | null | undefined): string | undefined {
  if (!token || isServerBrokerageSentinel(token)) return undefined;
  return token;
}

export function isServerHeldBrokerageSession(
  accessToken: string | null | undefined,
  traderAccessToken?: string | null | undefined,
): boolean {
  return isServerBrokerageSentinel(accessToken) || isServerBrokerageSentinel(traderAccessToken);
}