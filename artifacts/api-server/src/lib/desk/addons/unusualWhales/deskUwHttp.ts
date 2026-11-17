import { getUwApiKey } from "./deskUnusualWhales.js";
import { withUwConcurrencySlot } from "./deskUnusualWhales.js";

const UW_BASE = "https://api.unusualwhales.com";

export type DeskUwGetResult = {
  ok: boolean;
  status: number;
  json: unknown;
  asOfMs: number;
  retryAfterSec?: number;
};

function parseRetryAfter(res: Response): number | undefined {
  const h = res.headers.get("Retry-After");
  if (!h) return undefined;
  const n = Number(h);
  if (Number.isFinite(n) && n >= 0) return Math.min(n, 120);
  const d = Date.parse(h);
  if (Number.isFinite(d)) return Math.max(0, Math.min(120, Math.ceil((d - Date.now()) / 1000)));
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function deskUwGet(
  path: string,
  opts?: { timeoutMs?: number; retry503?: boolean },
): Promise<DeskUwGetResult> {
  const key = getUwApiKey();
  if (!key) {
    return { ok: false, status: 0, json: null, asOfMs: Date.now() };
  }

  const doFetch = async (): Promise<DeskUwGetResult> => {
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
    const retryAfterSec = parseRetryAfter(res);
    const json = (await res.json().catch(() => null)) as unknown;
    return { ok: res.ok, status: res.status, json, asOfMs, retryAfterSec };
  };

  try {
    let res = await withUwConcurrencySlot(() => doFetch());
    const retry = opts?.retry503 !== false;
    if (retry && res.status === 503) {
      const waitSec = res.retryAfterSec ?? 1;
      await sleep(waitSec * 1000);
      res = await withUwConcurrencySlot(() => doFetch());
    }
    return res;
  } catch {
    return { ok: false, status: 0, json: null, asOfMs: Date.now() };
  }
}
