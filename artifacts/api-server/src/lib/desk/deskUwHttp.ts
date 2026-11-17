import { getUwApiKey } from "./deskUnusualWhales.js";
import { withUwConcurrencySlot } from "./deskUnusualWhales.js";

const UW_BASE = "https://api.unusualwhales.com";

export async function deskUwGet(
  path: string,
  opts?: { timeoutMs?: number },
): Promise<{ ok: boolean; status: number; json: unknown; asOfMs: number }> {
  const key = getUwApiKey();
  if (!key) {
    return { ok: false, status: 0, json: null, asOfMs: Date.now() };
  }

  return withUwConcurrencySlot(async () => {
    const asOfMs = Date.now();
    const url = path.startsWith("http") ? path : `${UW_BASE}${path.startsWith("/") ? path : `/${path}`}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "UW-CLIENT-API-ID": "100001",
      },
      signal: AbortSignal.timeout(opts?.timeoutMs ?? 15_000),
    });
    const json = (await res.json().catch(() => null)) as unknown;
    return { ok: res.ok, status: res.status, json, asOfMs };
  });
}