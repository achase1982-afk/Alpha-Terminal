import { db, dividendsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const POLYGON_API = "https://api.polygon.io";

function polygonUrlHasApiKeyParam(url: string): boolean {
  return /[?&]apikey=/i.test(url);
}

function addUtcDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url: string, attempts = 4): Promise<Response | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(45_000) });
      if (r.status === 429) {
        await sleep(2000 * (i + 1));
        continue;
      }
      return r;
    } catch {
      if (i === attempts - 1) return null;
      await sleep(500 * (i + 1));
    }
  }
  return null;
}

function pickString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function pickNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export async function backfillDividendsForSymbol(symbol: string): Promise<{ rowsUpserted: number }> {
  const sym = symbol.toUpperCase().trim();
  const apiKey = (process.env["POLYGON_API_KEY"] ?? "").trim();
  if (!apiKey) throw new Error("POLYGON_API_KEY is required for tuning dividends backfill");

  const toYmd = new Date().toISOString().slice(0, 10);
  const fromYmd = addUtcDaysYmd(toYmd, -365 * 5 - 30);

  let rowsUpserted = 0;
  let url: string | null =
    `${POLYGON_API}/v3/reference/dividends?ticker=${encodeURIComponent(sym)}` +
    `&ex_dividend_date.gte=${fromYmd}&ex_dividend_date.lte=${toYmd}&limit=1000&sort=ex_dividend_date&order=asc&apiKey=${encodeURIComponent(apiKey)}`;

  while (url) {
    const r = await fetchWithRetry(url);
    if (!r?.ok) break;
    const json = (await r.json()) as {
      results?: Array<Record<string, unknown>>;
      next_url?: string;
    };
    for (const row of json.results ?? []) {
      const ex = pickString(row["ex_dividend_date"])?.slice(0, 10);
      if (!ex || !/^\d{4}-\d{2}-\d{2}$/.test(ex)) continue;
      const cash = pickNum(row["cash_amount"]) ?? pickNum(row["cash_amount_per_share"]);
      const record = pickString(row["record_date"])?.slice(0, 10) ?? null;
      const pay = pickString(row["pay_date"])?.slice(0, 10) ?? null;
      const decl = pickString(row["declaration_date"])?.slice(0, 10) ?? null;
      const currency = pickString(row["currency"]) ?? null;

      await db
        .insert(dividendsTable)
        .values({
          symbol: sym,
          exDate: ex,
          cashAmount: cash,
          recordDate: record,
          payDate: pay,
          declarationDate: decl,
          currency,
          fetchedAt: sql`now()`,
        })
        .onConflictDoUpdate({
          target: [dividendsTable.symbol, dividendsTable.exDate],
          set: {
            cashAmount: sql`excluded.cash_amount`,
            recordDate: sql`excluded.record_date`,
            payDate: sql`excluded.pay_date`,
            declarationDate: sql`excluded.declaration_date`,
            currency: sql`excluded.currency`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        });
      rowsUpserted++;
    }
    const next = json.next_url;
    url = next
      ? polygonUrlHasApiKeyParam(next)
        ? next
        : `${next}${next.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(apiKey)}`
      : null;
    await sleep(80);
  }

  return { rowsUpserted };
}
