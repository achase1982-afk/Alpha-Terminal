import { db, equityDailyTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { computeHV20, computeHV30, computeHV60 } from "../../lib/dailySnapshot.js";

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

export interface PolygonDailyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

async function fetchAllPolygonDailyAggs(symbol: string, fromYmd: string, toYmd: string, apiKey: string): Promise<PolygonDailyBar[]> {
  const out: PolygonDailyBar[] = [];
  let url: string | null =
    `${POLYGON_API}/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/day/${fromYmd}/${toYmd}` +
    `?adjusted=true&sort=asc&limit=50000&apiKey=${encodeURIComponent(apiKey)}`;

  while (url) {
    const r = await fetchWithRetry(url);
    if (!r?.ok) {
      const detail = r ? await r.text().catch(() => "") : "no response";
      throw new Error(
        `Polygon equity daily aggs failed for ${symbol}: HTTP ${r?.status ?? "none"} ${detail.slice(0, 280)}`,
      );
    }
    const json = (await r.json()) as {
      results?: Array<Record<string, unknown>>;
      next_url?: string;
    };
    for (const bar of json.results ?? []) {
      const ts = bar["t"] as number | undefined;
      const c = bar["c"] as number | undefined;
      if (!ts || c == null || !Number.isFinite(c) || c <= 0) continue;
      const o = bar["o"] as number | undefined;
      const h = bar["h"] as number | undefined;
      const l = bar["l"] as number | undefined;
      const v = bar["v"] as number | undefined;
      const open = o != null && Number.isFinite(o) && o > 0 ? o : c;
      const high = h != null && Number.isFinite(h) && h > 0 ? h : c;
      const low = l != null && Number.isFinite(l) && l > 0 ? l : c;
      const vol = v != null && Number.isFinite(v) ? Math.round(v) : null;
      out.push({
        date: new Date(ts).toISOString().slice(0, 10),
        open,
        high,
        low,
        close: c,
        volume: vol,
      });
    }
    const next = json.next_url;
    url = next
      ? polygonUrlHasApiKeyParam(next)
        ? next
        : `${next}${next.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(apiKey)}`
      : null;
    await sleep(80);
  }
  return out;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function backfillEquityDailyForSymbol(symbol: string): Promise<{ rowsUpserted: number }> {
  const sym = symbol.toUpperCase().trim();
  const apiKey = (process.env["POLYGON_API_KEY"] ?? "").trim();
  if (!apiKey) throw new Error("POLYGON_API_KEY is required for tuning equity_daily backfill");

  const toYmd = new Date().toISOString().slice(0, 10);
  const fromYmd = addUtcDaysYmd(toYmd, -365 * 5 - 10);

  const bars = await fetchAllPolygonDailyAggs(sym, fromYmd, toYmd, apiKey);
  bars.sort((a, b) => a.date.localeCompare(b.date));
  const closes = bars.map((b) => b.close);

  const rows: Array<typeof equityDailyTable.$inferInsert> = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    const slice = closes.slice(0, i + 1);
    rows.push({
      symbol: sym,
      date: b.date,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      adjustedClose: b.close,
      volume: b.volume,
      hv20d: computeHV20(slice),
      hv30d: computeHV30(slice),
      hv60d: computeHV60(slice),
    });
  }

  let rowsUpserted = 0;
  for (const batch of chunkArray(rows, 250)) {
    if (batch.length === 0) continue;
    await db
      .insert(equityDailyTable)
      .values(batch)
      .onConflictDoUpdate({
        target: [equityDailyTable.symbol, equityDailyTable.date],
        set: {
          open: sql`excluded.open`,
          high: sql`excluded.high`,
          low: sql`excluded.low`,
          close: sql`excluded.close`,
          adjustedClose: sql`excluded.adjusted_close`,
          volume: sql`excluded.volume`,
          hv20d: sql`excluded.hv_20d`,
          hv30d: sql`excluded.hv_30d`,
          hv60d: sql`excluded.hv_60d`,
        },
      });
    rowsUpserted += batch.length;
  }

  if (rowsUpserted > 0 && rowsUpserted < 800) {
    console.warn(
      JSON.stringify({
        msg: "tuning_backfill equity_daily short history",
        symbol: sym,
        bars: rowsUpserted,
        hint: "Polygon plan may cap history depth; expect ~1260 for five years on full access",
      }),
    );
  }

  return { rowsUpserted };
}
