import { logger } from "./logger.js";

const PAUSE_MS = 6 * 60 * 60 * 1000;

const pausedUntil = new Map<string, number>();
const logged = new Set<string>();

/** Pathname only, so the api key never becomes part of the pause key. */
export function fmpEndpointKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith("financialmodelingprep.com")) return null;
    return parsed.pathname;
  } catch {
    return null;
  }
}

export function isFmpPaidDenial(status: number, body: string): boolean {
  if (status === 401 || status === 402 || status === 403) return true;
  const text = body.toLowerCase();
  return (
    text.includes("legacy endpoint") ||
    text.includes("exclusive endpoint") ||
    text.includes("premium") ||
    text.includes("upgrade")
  );
}

export function fmpEndpointPaused(url: string, now = Date.now()): boolean {
  const key = fmpEndpointKey(url);
  if (!key) return false;
  const until = pausedUntil.get(key) ?? 0;
  if (until === 0) return false;
  if (now >= until) {
    pausedUntil.delete(key);
    logged.delete(key);
    return false;
  }
  return true;
}

export function noteFmpPaidDenial(url: string, status: number, now = Date.now()): void {
  const key = fmpEndpointKey(url) ?? url.split("?")[0];
  pausedUntil.set(key, now + PAUSE_MS);
  if (logged.has(key)) return;
  logged.add(key);
  logger.warn(
    { endpoint: key, status, pauseHours: 6 },
    "FMP endpoint unavailable on the current plan — pausing calls for 6h and returning empty",
  );
}

export function emptyFmpResponse(): Response {
  return new Response("[]", {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Same URLs as before. A paid-plan denial pauses that pathname and returns []. */
export async function fetchFmp(url: string, init?: RequestInit): Promise<Response> {
  if (fmpEndpointPaused(url)) return emptyFmpResponse();
  const res = await fetch(url, init);
  const text = await res.text();
  if (isFmpPaidDenial(res.status, text)) {
    noteFmpPaidDenial(url, res.status);
    return emptyFmpResponse();
  }
  return new Response(text, { status: res.status, statusText: res.statusText });
}

export function resetFmpPaidPlanGuardForTests(): void {
  pausedUntil.clear();
  logged.clear();
}
