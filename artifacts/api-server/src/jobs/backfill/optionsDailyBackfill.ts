import { db, equityDailyTable, optionsDailyTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

const POLYGON_API = "https://api.polygon.io";

/** Polygon next_url may use `apiKey` or `apikey`; treat either as present. */
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
      const r = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      if (r.status === 429) {
        await sleep(2500 * (i + 1));
        continue;
      }
      return r;
    } catch {
      if (i === attempts - 1) return null;
      await sleep(800 * (i + 1));
    }
  }
  return null;
}

function isMonWedOrFriExpirationYmd(ymd: string): boolean {
  const d = new Date(`${ymd}T12:00:00Z`);
  const day = d.getUTCDay();
  return day === 1 || day === 3 || day === 5;
}

function dteCalendar(asOf: string, exp: string): number {
  const a = new Date(`${asOf}T12:00:00Z`).getTime();
  const b = new Date(`${exp}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

async function loadCloseMap(symbol: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ date: equityDailyTable.date, close: equityDailyTable.close })
    .from(equityDailyTable)
    .where(eq(equityDailyTable.symbol, symbol.toUpperCase()))
    .orderBy(asc(equityDailyTable.date));
  const m = new Map<string, number>();
  for (const r of rows) {
    const d = typeof r.date === "string" ? r.date.slice(0, 10) : String(r.date).slice(0, 10);
    const c = Number(r.close);
    if (Number.isFinite(c) && c > 0) m.set(d, c);
  }
  return m;
}

function spotOnOrBefore(closeByDate: Map<string, number>, asOf: string): number | null {
  if (closeByDate.has(asOf)) return closeByDate.get(asOf)!;
  let best: string | null = null;
  for (const d of closeByDate.keys()) {
    if (d <= asOf && (!best || d > best)) best = d;
  }
  return best != null ? closeByDate.get(best)! : null;
}

async function listContractsForAsOf(
  symbol: string,
  asOf: string,
  apiKey: string,
): Promise<Array<{ occ: string; strike: number; expiration: string; listDate: string }>> {
  const out: Array<{ occ: string; strike: number; expiration: string; listDate: string }> = [];
  let url: string | null =
    `${POLYGON_API}/v3/reference/options/contracts` +
    `?underlying_ticker=${encodeURIComponent(symbol)}` +
    `&as_of=${encodeURIComponent(asOf)}` +
    `&expired=true&limit=1000&sort=expiration_date&order=asc&apiKey=${encodeURIComponent(apiKey)}`;

  let pages = 0;
  while (url && pages < 120) {
    const r = await fetchWithRetry(url);
    if (!r) {
      if (pages === 0) {
        throw new Error(`Polygon options contracts: no HTTP response for ${symbol} as_of=${asOf}`);
      }
      break;
    }
    if (!r.ok) {
      const errBody = await r.text().catch(() => "");
      if (pages === 0) {
        throw new Error(
          `Polygon options contracts failed for ${symbol} as_of=${asOf}: HTTP ${r.status} ${errBody.slice(0, 240)}`,
        );
      }
      break;
    }
    const json = (await r.json()) as { results?: Array<Record<string, unknown>>; next_url?: string };
    for (const c of json.results ?? []) {
      const ctype = (c["contract_type"] as string | undefined)?.toLowerCase();
      if (ctype && ctype !== "call" && ctype !== "put") continue;
      const occ = c["ticker"] as string | undefined;
      const strikeRaw = c["strike_price"];
      const strike = typeof strikeRaw === "number" ? strikeRaw : Number(strikeRaw);
      const exp = (c["expiration_date"] as string | undefined)?.slice(0, 10);
      const listRaw = c["list_date"] as string | undefined;
      const listFromApi =
        typeof listRaw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(listRaw.slice(0, 10)) ? listRaw.slice(0, 10) : null;
      /** Polygon contract index often omits list_date; as_of is a safe lower bound for first-seen contracts. */
      const listDate = listFromApi ?? asOf;
      if (!occ || !Number.isFinite(strike) || strike <= 0 || !exp) continue;
      if (!occ.startsWith("O:")) continue;
      out.push({ occ, strike, expiration: exp, listDate });
    }
    const next = json.next_url;
    url = next
      ? polygonUrlHasApiKeyParam(next)
        ? next
        : `${next}${next.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(apiKey)}`
      : null;
    pages++;
    await sleep(60);
  }
  return out;
}

async function fetchOptionAggs(
  occ: string,
  fromYmd: string,
  toYmd: string,
  apiKey: string,
): Promise<
  Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    vwap: number | null;
    transactions: number | null;
  }>
> {
  const out: Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    vwap: number | null;
    transactions: number | null;
  }> = [];

  let url: string | null =
    `${POLYGON_API}/v2/aggs/ticker/${encodeURIComponent(occ)}/range/1/day/${fromYmd}/${toYmd}` +
    `?adjusted=true&sort=asc&limit=50000&apiKey=${encodeURIComponent(apiKey)}`;

  while (url) {
    const r = await fetchWithRetry(url);
    if (!r?.ok) break;
    const json = (await r.json()) as { results?: Array<Record<string, unknown>>; next_url?: string };
    for (const bar of json.results ?? []) {
      const ts = bar["t"] as number | undefined;
      const c = bar["c"] as number | undefined;
      if (!ts || c == null || !Number.isFinite(c) || c <= 0) continue;
      const o = bar["o"] as number | undefined;
      const h = bar["h"] as number | undefined;
      const l = bar["l"] as number | undefined;
      const v = (bar["v"] ?? 0) as number;
      const vw = bar["vw"] as number | undefined;
      const n = bar["n"] as number | undefined;
      const open = o != null && Number.isFinite(o) && o > 0 ? o : c;
      const high = h != null && Number.isFinite(h) && h > 0 ? h : c;
      const low = l != null && Number.isFinite(l) && l > 0 ? l : c;
      out.push({
        date: new Date(ts).toISOString().slice(0, 10),
        open,
        high,
        low,
        close: c,
        volume: Math.round(v),
        vwap: vw != null && Number.isFinite(vw) ? vw : null,
        transactions: n != null && Number.isFinite(n) ? Math.round(n) : null,
      });
    }
    const next = json.next_url;
    url = next
      ? polygonUrlHasApiKeyParam(next)
        ? next
        : `${next}${next.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(apiKey)}`
      : null;
    await sleep(40);
  }
  return out;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function backfillOptionsDailyForSymbol(symbol: string): Promise<{
  rowsUpserted: number;
  contractsProcessed: number;
}> {
  const sym = symbol.toUpperCase().trim();
  const apiKey = (process.env["POLYGON_API_KEY"] ?? "").trim();
  if (!apiKey) throw new Error("POLYGON_API_KEY is required for tuning options_daily backfill");

  const toYmd = new Date().toISOString().slice(0, 10);
  const fromYmd = addUtcDaysYmd(toYmd, -365 * 5 - 10);

  const closeByDate = await loadCloseMap(sym);

  const asOfSet = new Set<string>();
  for (let cur = fromYmd; cur <= toYmd; cur = addUtcDaysYmd(cur, 28)) {
    asOfSet.add(cur);
  }
  asOfSet.add(toYmd);

  const contractKeys = new Map<string, { occ: string; listDate: string; expiration: string }>();

  for (const asOf of [...asOfSet].sort()) {
    const spot = spotOnOrBefore(closeByDate, asOf);
    if (spot == null || spot <= 0) continue;
    const lo = spot * 0.7;
    const hi = spot * 1.3;
    const raw = await listContractsForAsOf(sym, asOf, apiKey);
    for (const c of raw) {
      if (c.strike < lo || c.strike > hi) continue;
      if (!isMonWedOrFriExpirationYmd(c.expiration)) continue;
      const dte = dteCalendar(asOf, c.expiration);
      if (dte < 7 || dte > 550) continue;
      const prev = contractKeys.get(c.occ);
      if (!prev || c.listDate < prev.listDate) {
        contractKeys.set(c.occ, { occ: c.occ, listDate: c.listDate, expiration: c.expiration });
      }
    }
    await sleep(40);
  }

  const contracts = [...contractKeys.values()];
  if (contracts.length === 0) {
    throw new Error(
      `tuning options_daily: no contracts in scope for ${sym} (spot series ${closeByDate.size} days; check Polygon options access / filters)`,
    );
  }
  let rowsUpserted = 0;
  let contractsProcessed = 0;

  for (const c of contracts) {
    const expOrToday = c.expiration < toYmd ? c.expiration : toYmd;
    const start = c.listDate > fromYmd ? c.listDate : fromYmd;
    if (start > expOrToday) {
      contractsProcessed++;
      continue;
    }
    const bars = await fetchOptionAggs(c.occ, start, expOrToday, apiKey);
    const batches = chunkArray(bars, 150);
    for (const batch of batches) {
      if (batch.length === 0) continue;
      const values = batch.map((b) => ({
        occ: c.occ,
        underlyingSymbol: sym,
        date: b.date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
        vwap: b.vwap,
        transactions: b.transactions,
      }));
      await db
        .insert(optionsDailyTable)
        .values(values)
        .onConflictDoUpdate({
          target: [optionsDailyTable.occ, optionsDailyTable.date],
          set: {
            underlyingSymbol: sql`excluded.underlying_symbol`,
            open: sql`excluded.open`,
            high: sql`excluded.high`,
            low: sql`excluded.low`,
            close: sql`excluded.close`,
            volume: sql`excluded.volume`,
            vwap: sql`excluded.vwap`,
            transactions: sql`excluded.transactions`,
          },
        });
      rowsUpserted += batch.length;
    }
    contractsProcessed++;
    if (contractsProcessed % 100 === 0) {
      console.log(
        JSON.stringify({
          msg: "tuning_backfill options_daily progress",
          symbol: sym,
          contractsProcessed,
          totalContracts: contracts.length,
        }),
      );
    }
    await sleep(50);
  }

  return { rowsUpserted, contractsProcessed };
}
