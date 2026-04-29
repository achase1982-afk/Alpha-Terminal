import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { createGunzip } from "zlib";
import { createInterface } from "readline";
import { Readable } from "stream";
import { db, polygonOptionsHistoryTable, polygonSyncLogTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

function createS3Client(): S3Client {
  return new S3Client({
    region: "us-east-1",
    endpoint: process.env.POLYGON_S3_ENDPOINT ?? "https://files.massive.com",
    credentials: {
      accessKeyId: process.env.POLYGON_S3_ACCESS_KEY ?? "",
      secretAccessKey: process.env.POLYGON_S3_SECRET_KEY ?? "",
    },
    forcePathStyle: true,
  });
}

export function parseOccSymbol(raw: string): {
  ticker: string; expiry: string; putCall: string; strike: number;
} | null {
  const sym = raw.startsWith("O:") ? raw.slice(2) : raw;
  if (sym.length < 16) return null;
  const suffix = sym.slice(-15);
  const ticker = sym.slice(0, sym.length - 15);
  if (!ticker || suffix.length !== 15) return null;
  const yy = suffix.slice(0, 2);
  const mm = suffix.slice(2, 4);
  const dd = suffix.slice(4, 6);
  const putCall = suffix[6].toUpperCase();
  const strikeStr = suffix.slice(7);
  if (!/^[CP]$/.test(putCall)) return null;
  const year = parseInt(yy) + 2000;
  const expiry = `${year}-${mm}-${dd}`;
  const strike = parseInt(strikeStr) / 1000;
  return { ticker, expiry, putCall, strike };
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateToMonthPrefix(date: Date): string {
  // Polygon/Massive flat-files now use a flat per-month layout:
  //   us_options_opra/day_aggs_v1/YYYY/MM/YYYY-MM-DD.csv.gz
  // (Older Hive-style year=YYYY/month=MM/day=DD/ paths were retired.)
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `us_options_opra/day_aggs_v1/${year}/${month}/`;
}

async function listFilesForDate(s3: S3Client, date: Date): Promise<string[]> {
  const bucket = process.env.POLYGON_S3_BUCKET ?? "flatfiles";
  const prefix = dateToMonthPrefix(date);
  const tradeDate = formatDate(date);
  // The month directory contains one file per trading day. We only want the
  // single file matching the requested date.
  const wanted = `${prefix}${tradeDate}.csv.gz`;
  try {
    const cmd = new ListObjectsV2Command({ Bucket: bucket, Prefix: wanted });
    const res = await s3.send(cmd);
    return (res.Contents ?? [])
      .map(obj => obj.Key ?? "")
      .filter(k => k === wanted || k === `${prefix}${tradeDate}.csv`);
  } catch (err) {
    // Surface the real error instead of silently returning [] which makes
    // S3 auth/DNS failures look like "no data for this date" (L2 fix).
    throw new Error(`S3 list failed for ${wanted}: ${await formatS3Error(err)}`);
  }
}

async function readErrorBody(err: unknown): Promise<string | null> {
  const body = (err as { $response?: { body?: AsyncIterable<Uint8Array> } })?.$response?.body;
  if (!body) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw || null;
}

async function formatS3Error(err: unknown): Promise<string> {
  const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const raw = await readErrorBody(err).catch(() => null);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { status?: string; message?: string; request_id?: string };
      const status = parsed.status ?? `HTTP_${e.$metadata?.httpStatusCode ?? "UNKNOWN"}`;
      const message = parsed.message ?? e.message ?? "unknown S3 error";
      const requestId = parsed.request_id ? ` request_id=${parsed.request_id}` : "";
      return `${status}: ${message}${requestId}`;
    } catch {
      return `${e.name ?? "S3Error"}: ${e.message ?? raw} raw=${raw.slice(0, 300)}`;
    }
  }
  return `${e.name ?? "S3Error"}: ${e.message ?? String(err)}${e.$metadata?.httpStatusCode ? ` status=${e.$metadata.httpStatusCode}` : ""}`;
}

interface DbRow {
  ticker: string;
  optionSymbol: string;
  tradeDate: string;
  volume: number;
  openInterest: number | null;
  closePrice: number | null;
  vwap: number | null;
  strike: number;
  expiry: string;
  putCall: string;
}

async function processFile(
  s3: S3Client,
  key: string,
  targetTickers: Set<string>,
  tradeDate: string,
  onRow: (row: DbRow) => void | Promise<void>
): Promise<number> {
  const bucket = process.env.POLYGON_S3_BUCKET ?? "flatfiles";
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  const res = await s3.send(cmd);
  if (!res.Body) return 0;

  const stream = res.Body as Readable;
  const isGzipped = key.endsWith(".gz");
  const input = isGzipped ? stream.pipe(createGunzip()) : stream;
  const rl = createInterface({ input, crlfDelay: Infinity });

  let headerParsed = false;
  let headers: string[] = [];
  let count = 0;

  for await (const line of rl) {
    if (!headerParsed) {
      headers = line.split(",").map(h => h.trim().toLowerCase().replace(/"/g, ""));
      headerParsed = true;
      continue;
    }
    if (!line.trim()) continue;

    const values = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (values[i] ?? "").trim().replace(/"/g, ""); });

    const rawTicker = row["ticker"] ?? row["symbol"] ?? "";
    if (!rawTicker) continue;

    const parsed = parseOccSymbol(rawTicker);
    if (!parsed) continue;

    if (targetTickers.size > 0 && !targetTickers.has(parsed.ticker.toUpperCase())) continue;

    const optionSymbol = rawTicker.startsWith("O:") ? rawTicker.slice(2) : rawTicker;
    const volume = parseInt(row["volume"] ?? "0") || 0;
    if (volume === 0) continue;

    await onRow({
      ticker: parsed.ticker.toUpperCase(),
      optionSymbol,
      tradeDate,
      volume,
      openInterest: parseInt(row["open_interest"] ?? "") || null,
      closePrice: parseFloat(row["close"] ?? "") || null,
      vwap: parseFloat(row["vwap"] ?? "") || null,
      strike: parsed.strike,
      expiry: parsed.expiry,
      putCall: parsed.putCall,
    });
    count++;
  }
  return count;
}

async function flushBatch(batch: DbRow[]): Promise<void> {
  if (batch.length === 0) return;
  await db.insert(polygonOptionsHistoryTable)
    .values(batch)
    .onConflictDoUpdate({
      target: [polygonOptionsHistoryTable.optionSymbol, polygonOptionsHistoryTable.tradeDate],
      set: {
        volume: sql`excluded.volume`,
        openInterest: sql`excluded.open_interest`,
        closePrice: sql`excluded.close_price`,
        vwap: sql`excluded.vwap`,
      },
    });
}

export async function syncDate(
  date: Date,
  tickers: string[],
  opts?: { maxS3Requests?: number; onS3Call?: () => void },
): Promise<{ date: string; rows: number; files: number; skipped: boolean; error?: string; s3Calls?: number }> {
  const tradeDate = formatDate(date);
  const s3 = createS3Client();
  const targetTickers = new Set(tickers.map(t => t.toUpperCase()));

  const existing = await db.query.polygonSyncLogTable.findFirst({
    where: eq(polygonSyncLogTable.tradeDate, tradeDate),
  });
  if (existing?.status === "synced") {
    return { date: tradeDate, rows: existing.rowsInserted ?? 0, files: 0, skipped: true, s3Calls: 0 };
  }

  // S3 request budget — first-run safeguard for a never-before-fired cron.
  // Harden env parsing so a malformed value (e.g. "1d") cannot become NaN
  // and silently disable the cap. Mirrors index.ts sanitization.
  function resolveMaxS3(): number {
    if (typeof opts?.maxS3Requests === "number" && Number.isFinite(opts.maxS3Requests) && opts.maxS3Requests > 0) {
      return Math.floor(opts.maxS3Requests);
    }
    const raw = process.env.POLYGON_FLATFILES_MAX_S3_REQUESTS;
    const parsed = raw == null ? NaN : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 200;
  }
  const maxS3 = resolveMaxS3();
  let s3Calls = 0;
  function bumpS3(): void {
    s3Calls++;
    opts?.onS3Call?.();
    if (s3Calls > maxS3) {
      throw new Error(`POLYGON_FLATFILES_MAX_S3_REQUESTS exceeded (cap=${maxS3}, calls=${s3Calls})`);
    }
  }

  try {
    bumpS3(); // ListObjectsV2
    const files = await listFilesForDate(s3, date);
    if (files.length === 0) {
      // Persist a sync_log row so "no data" days are observable. Without
      // this, a misconfigured prefix or a not-yet-published date looks
      // identical to a healthy success in /status, which previously hid a
      // path-format outage for weeks.
      await db.insert(polygonSyncLogTable)
        .values({ tradeDate, status: "no_data", rowsInserted: 0, errorMsg: "No files found", tickers })
        .onConflictDoUpdate({
          target: polygonSyncLogTable.tradeDate,
          set: { status: "no_data", rowsInserted: 0, errorMsg: "No files found", syncedAt: new Date() },
        });
      return { date: tradeDate, rows: 0, files: 0, skipped: false, error: "No files found", s3Calls };
    }

    const batch: DbRow[] = [];
    let totalRows = 0;

    for (const file of files) {
      bumpS3(); // GetObject
      await processFile(s3, file, targetTickers, tradeDate, async (row) => {
        batch.push(row);
        if (batch.length >= 500) {
          await flushBatch([...batch]);
          totalRows += batch.length;
          batch.length = 0;
        }
      });
      if (batch.length > 0) {
        await flushBatch([...batch]);
        totalRows += batch.length;
        batch.length = 0;
      }
    }

    await db.insert(polygonSyncLogTable)
      .values({ tradeDate, status: "synced", rowsInserted: totalRows, errorMsg: null, tickers })
      .onConflictDoUpdate({
        target: polygonSyncLogTable.tradeDate,
        set: { status: "synced", rowsInserted: totalRows, errorMsg: null, syncedAt: new Date() },
      });

    return { date: tradeDate, rows: totalRows, files: files.length, skipped: false };
  } catch (err: any) {
    await db.insert(polygonSyncLogTable)
      .values({ tradeDate, status: "failed", errorMsg: err.message, tickers })
      .onConflictDoUpdate({
        target: polygonSyncLogTable.tradeDate,
        set: { status: "failed", errorMsg: err.message, syncedAt: new Date() },
      });
    return { date: tradeDate, rows: 0, files: 0, skipped: false, error: err.message };
  }
}

export async function syncDateRange(
  startDate: Date,
  endDate: Date,
  tickers: string[]
): Promise<Array<{ date: string; rows: number; files: number; skipped: boolean; error?: string }>> {
  const results = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      results.push(await syncDate(new Date(cursor), tickers));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return results;
}

export async function getSyncStatus(): Promise<{
  totalRows: number;
  recentLogs: Array<{ tradeDate: string; status: string; rowsInserted: number | null; errorMsg: string | null }>;
  configured: boolean;
}> {
  const configured = !!(process.env.POLYGON_S3_ACCESS_KEY && process.env.POLYGON_S3_SECRET_KEY);
  try {
    const rowCount = await db.select({ count: sql<number>`COUNT(*)` }).from(polygonOptionsHistoryTable);
    const logs = await db.query.polygonSyncLogTable.findMany({
      orderBy: (t, { desc }) => desc(t.tradeDate),
      limit: 10,
    });
    return {
      totalRows: Number(rowCount[0]?.count ?? 0),
      recentLogs: logs.map(l => ({
        tradeDate: l.tradeDate,
        status: l.status,
        rowsInserted: l.rowsInserted,
        errorMsg: l.errorMsg,
      })),
      configured,
    };
  } catch {
    return { totalRows: 0, recentLogs: [], configured };
  }
}
