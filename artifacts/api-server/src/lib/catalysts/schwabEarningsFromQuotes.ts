import { getBestAccessToken } from "../tokenStore.js";
import { SCHWAB_MARKETDATA, SCHWAB_QUOTES_BATCH_SIZE } from "../schwabBatchQuotes.js";

export type SchwabHarvestedEarnings = {
  nextEarningsDate: string | null;
  /** True/false when Schwab exposes a signal; null when unknown. */
  earningsConfirmed: boolean | null;
  name: string | null;
};

function parseNextEarningsDate(fundamental: Record<string, unknown> | undefined): string | null {
  if (!fundamental) return null;
  const raw =
    fundamental["nextEarningsDate"] ??
    fundamental["nextEarning"] ??
    fundamental["earningsDate"];
  if (typeof raw !== "string" || !raw.trim()) return null;
  const ymd = raw.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

function parseEarningsConfirmed(fundamental: Record<string, unknown> | undefined): boolean | null {
  if (!fundamental) return null;
  const candidates = [
    fundamental["isNextEarningsDateConfirmed"],
    fundamental["nextEarningsDateConfirmed"],
    fundamental["earningsDateConfirmed"],
  ];
  for (const v of candidates) {
    if (typeof v === "boolean") return v;
    if (v === 1 || v === "1" || v === "true" || v === "Y") return true;
    if (v === 0 || v === "0" || v === "false" || v === "N") return false;
  }
  const qual = fundamental["nextEarningsDateQualifier"] ?? fundamental["earningsDateType"];
  if (typeof qual === "string") {
    const u = qual.toUpperCase();
    if (u.includes("CONFIRM") || u === "C") return true;
    if (u.includes("ESTIM") || u === "E") return false;
  }
  return null;
}

function parseName(entry: Record<string, unknown> | undefined): string | null {
  const ref = entry?.["reference"] as Record<string, unknown> | undefined;
  const q = entry?.["quote"] as Record<string, unknown> | undefined;
  const raw =
    (typeof ref?.["description"] === "string" && ref["description"].trim()) ||
    (typeof ref?.["companyName"] === "string" && ref["companyName"].trim()) ||
    (typeof q?.["description"] === "string" && q["description"].trim()) ||
    (typeof q?.["companyName"] === "string" && q["companyName"].trim()) ||
    null;
  return raw;
}

/**
 * Batched Schwab `/quotes` harvest for `nextEarningsDate` (fundamental payload).
 * Reuses the same batch size and fields as {@link ../schwabBatchQuotes.ts}.
 */
export async function fetchSchwabEarningsDatesForSymbols(
  symbols: string[],
  accessToken: string | null,
  opts?: { delayBetweenBatchesMs?: number },
): Promise<Map<string, SchwabHarvestedEarnings>> {
  const out = new Map<string, SchwabHarvestedEarnings>();
  if (!accessToken || symbols.length === 0) return out;

  const delayMs = opts?.delayBetweenBatchesMs ?? 0;
  const orderedUnique: string[] = [];
  const seen = new Set<string>();
  for (const raw of symbols) {
    const s = raw.trim();
    if (!s) continue;
    const key = s.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    orderedUnique.push(s);
  }

  for (let i = 0; i < orderedUnique.length; i += SCHWAB_QUOTES_BATCH_SIZE) {
    if (i > 0 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    const batch = orderedUnique.slice(i, i + SCHWAB_QUOTES_BATCH_SIZE);
    try {
      const res = await fetch(
        `${SCHWAB_MARKETDATA}/quotes?symbols=${encodeURIComponent(batch.join(","))}&fields=quote,fundamental,reference`,
        { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000) },
      );
      if (!res.ok) continue;
      const json = (await res.json()) as Record<string, unknown>;
      for (const sym of batch) {
        const upper = sym.toUpperCase();
        const entry = (json[sym] ?? json[upper]) as Record<string, unknown> | undefined;
        const f = entry?.["fundamental"] as Record<string, unknown> | undefined;
        out.set(upper, {
          nextEarningsDate: parseNextEarningsDate(f),
          earningsConfirmed: parseEarningsConfirmed(f),
          name: parseName(entry),
        });
      }
    } catch {
      continue;
    }
  }

  return out;
}

export async function fetchSchwabEarningsDatesBestToken(
  symbols: string[],
  opts?: { delayBetweenBatchesMs?: number },
): Promise<Map<string, SchwabHarvestedEarnings>> {
  return fetchSchwabEarningsDatesForSymbols(symbols, getBestAccessToken(), opts);
}
