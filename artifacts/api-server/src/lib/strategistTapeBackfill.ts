import { db, optionsFlowRawTradesTable, optionsTapeBackfillOccCacheTable } from "@workspace/db";
import { logger } from "./logger.js";
import { logFlowPipelineWarn } from "./flowPipelineInstrumentation.js";
import { probePolygonRate } from "./polygonRateProbe.js";
import { classifyForFlowPersistence } from "./optionsTradeClassifier.js";
import { flushFlowPersistenceNow } from "./optionsFlowPersistence.js";
import { runRollupOnceForSymbol } from "./optionsFlowRollup.js";

const POLYGON_API = "https://api.polygon.io";
const MAX_OCC = 50;
const STRIKES_EACH_SIDE = 5;
const MAX_EXPIRIES = 3;
const QUOTE_WINDOW_MS = 120_000;
const QUOTE_PREPAD_MS = 5_000;
const TRADE_PAGE_LIMIT = 1000;
const QUOTE_PAGE_LIMIT = 1000;
const DEFAULT_BUDGET_MS = 25_000;

export type TapeBackfillStatusValue = "complete" | "partial" | "failed" | "skipped";

export interface TapeBackfillStatus {
  status: TapeBackfillStatusValue;
  reason: string | null;
  sessionDate: string;
  coverageEndMs: number;
  occRequested: number;
  occCompleted: number;
  tradesInserted: number;
}

interface ChainLike {
  strike: number;
  expiration: string;
  type: string;
  optionType?: string;
}

interface CuratedExp {
  expiration: string;
  dte: number;
}

export interface ChainSummaryLike {
  atmStrike: number;
  availableExpirations: string[];
  curatedExpirations: CuratedExp[];
}

function nyCalendarYmd(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function nyOffsetForYmd(ymd: string): "-04:00" | "-05:00" {
  const probe = new Date(`${ymd}T12:00:00Z`);
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  }).formatToParts(probe).find((p) => p.type === "timeZoneName")?.value ?? "";
  return part.includes("-4") || part.includes("EDT") ? "-04:00" : "-05:00";
}

function rthBoundsMs(sessionYmd: string): { openMs: number; closeMs: number } {
  const off = nyOffsetForYmd(sessionYmd);
  const openMs = new Date(`${sessionYmd}T09:30:00${off}`).getTime();
  const closeMs = new Date(`${sessionYmd}T16:00:00${off}`).getTime();
  return { openMs, closeMs };
}

function chainToOcc(underlying: string, expiration: string, strike: number, isCall: boolean): string {
  const root = underlying.toUpperCase().replace(/\s+/g, "");
  const [Y, M, D] = expiration.split("-");
  if (!Y || !M || !D) return "";
  const yymmdd = `${Y.slice(2)}${M.padStart(2, "0")}${D.padStart(2, "0")}`;
  const cp = isCall ? "C" : "P";
  const strike8 = String(Math.round(strike * 1000)).padStart(8, "0");
  return `O:${root}${yymmdd}${cp}${strike8}`;
}

function dteFromEtToday(expiration: string): number {
  const expMs = new Date(`${expiration}T20:00:00Z`).getTime();
  const ymd = nyCalendarYmd(new Date());
  const dayMs = new Date(`${ymd}T17:00:00`).getTime();
  return Math.max(0, Math.round((expMs - dayMs) / 86_400_000));
}

function pickExpiries(summary: ChainSummaryLike): string[] {
  const fromCurated = [...summary.curatedExpirations]
    .filter((e) => e.dte > 0 && e.dte <= 120)
    .sort((a, b) => a.dte - b.dte)
    .map((e) => e.expiration);
  const nearest = [...summary.availableExpirations]
    .map((exp) => ({ exp, dte: dteFromEtToday(exp) }))
    .filter((x) => x.dte > 0 && x.dte <= 45)
    .sort((a, b) => a.dte - b.dte)[0]?.exp;
  const ordered: string[] = [];
  if (nearest) ordered.push(nearest);
  for (const e of fromCurated) {
    if (!ordered.includes(e)) ordered.push(e);
    if (ordered.length >= MAX_EXPIRIES) break;
  }
  for (const e of fromCurated) {
    if (ordered.length >= MAX_EXPIRIES) break;
    if (!ordered.includes(e)) ordered.push(e);
  }
  return ordered.slice(0, MAX_EXPIRIES);
}

function strikesAroundAtm(atm: number, chain: ChainLike[], expiration: string): number[] {
  const strikes = new Set<number>();
  for (const c of chain) {
    if (c.expiration !== expiration) continue;
    strikes.add(c.strike);
  }
  return [...strikes].sort((a, b) => Math.abs(a - atm) - Math.abs(b - atm)).slice(0, STRIKES_EACH_SIDE * 2 + 1);
}

export function buildTapeOccList(
  underlying: string,
  chain: ChainLike[],
  summary: ChainSummaryLike,
): string[] {
  const u = underlying.toUpperCase();
  const exps = pickExpiries(summary);
  const atm = summary.atmStrike;
  const occs: string[] = [];
  const seen = new Set<string>();
  for (const exp of exps) {
    for (const strike of strikesAroundAtm(atm, chain, exp)) {
      const hasCall = chain.some(
        (c) =>
          c.expiration === exp &&
          c.strike === strike &&
          ((c.optionType ?? c.type).toUpperCase() === "CALL" || c.type === "call"),
      );
      const hasPut = chain.some(
        (c) =>
          c.expiration === exp &&
          c.strike === strike &&
          ((c.optionType ?? c.type).toUpperCase() === "PUT" || c.type === "put"),
      );
      if (hasCall) {
        const occ = chainToOcc(u, exp, strike, true);
        if (occ && !seen.has(occ)) {
          seen.add(occ);
          occs.push(occ);
        }
      }
      if (hasPut) {
        const occ = chainToOcc(u, exp, strike, false);
        if (occ && !seen.has(occ)) {
          seen.add(occ);
          occs.push(occ);
        }
      }
      if (occs.length >= MAX_OCC) return occs;
    }
  }
  return occs;
}

function tradeDedupId(occ: string, row: Record<string, unknown>): string {
  const sip = BigInt(String(row["sip_timestamp"] ?? row["participant_timestamp"] ?? 0));
  const part = BigInt(String(row["participant_timestamp"] ?? 0));
  const px = Number(row["price"] ?? 0);
  const sz = Number(row["size"] ?? 0);
  const ex = Number(row["exchange"] ?? 0);
  return `rest:${occ}:${sip}:${part}:${px}:${sz}:${ex}`;
}

function nsToMs(ns: bigint): number {
  return Number(ns / 1_000_000n);
}

interface ParsedTrade {
  tsMs: number;
  price: number;
  size: number;
  conditions: number[];
  dedupId: string;
}

function parseTrades(occ: string, results: unknown[]): ParsedTrade[] {
  const out: ParsedTrade[] = [];
  for (const raw of results) {
    const row = raw as Record<string, unknown>;
    const sip = BigInt(String(row["sip_timestamp"] ?? row["participant_timestamp"] ?? 0));
    if (sip <= 0n) continue;
    const tsMs = nsToMs(sip);
    const price = Number(row["price"] ?? 0);
    const size = Number(row["size"] ?? 0);
    const conditions = Array.isArray(row["conditions"]) ? (row["conditions"] as number[]) : [];
    out.push({ tsMs, price, size, conditions, dedupId: tradeDedupId(occ, row) });
  }
  return out;
}

interface QuotePoint {
  tsMs: number;
  bid: number;
  ask: number;
}

function parseQuotes(results: unknown[]): QuotePoint[] {
  const out: QuotePoint[] = [];
  for (const raw of results) {
    const row = raw as Record<string, unknown>;
    const sip = BigInt(String(row["sip_timestamp"] ?? 0));
    if (sip <= 0n) continue;
    const bid = Number(row["bid_price"] ?? row["bp"] ?? 0);
    const ask = Number(row["ask_price"] ?? row["ap"] ?? 0);
    if (bid <= 0 || ask <= 0 || ask < bid) continue;
    out.push({ tsMs: nsToMs(sip), bid, ask });
  }
  out.sort((a, b) => a.tsMs - b.tsMs);
  return out;
}

async function fetchPaged(firstUrl: string, apiKey: string, deadlineMs: number): Promise<{ rows: unknown[]; truncated: boolean }> {
  const rows: unknown[] = [];
  let url: string | null = firstUrl.includes("apiKey=")
    ? firstUrl
    : `${firstUrl}${firstUrl.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(apiKey)}`;
  let truncated = false;
  while (url && Date.now() < deadlineMs) {
    const r = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    if (r.status === 429) {
      truncated = true;
      break;
    }
    if (!r.ok) {
      truncated = true;
      break;
    }
    const j = (await r.json()) as { results?: unknown[]; next_url?: string };
    if (Array.isArray(j.results)) rows.push(...j.results);
    if (j.next_url) {
      url = j.next_url.includes("apiKey=") ? j.next_url : `${j.next_url}&apiKey=${encodeURIComponent(apiKey)}`;
    } else {
      url = null;
    }
  }
  if (Date.now() >= deadlineMs && url) truncated = true;
  return { rows, truncated };
}

function nbboAtOrBefore(quotes: QuotePoint[], tsMs: number): { bid: number; ask: number } | null {
  let lo = 0;
  let hi = quotes.length - 1;
  let best: QuotePoint | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const q = quotes[mid]!;
    if (q.tsMs <= tsMs) {
      best = q;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best ? { bid: best.bid, ask: best.ask } : null;
}

async function fetchQuotesWindowed(
  occ: string,
  apiKey: string,
  trades: ParsedTrade[],
  gteNs: bigint,
  lteNs: bigint,
  deadlineMs: number,
): Promise<{ quotes: QuotePoint[]; truncated: boolean }> {
  if (trades.length === 0) return { quotes: [], truncated: false };
  const all: QuotePoint[] = [];
  let truncated = false;
  const sorted = [...trades].sort((a, b) => a.tsMs - b.tsMs);
  let winStart = sorted[0]!.tsMs - QUOTE_PREPAD_MS;
  let winEnd = winStart + QUOTE_WINDOW_MS;
  for (const t of sorted) {
    if (t.tsMs > winEnd) {
      const g = BigInt(Math.max(Number(gteNs), (winStart - QUOTE_PREPAD_MS) * 1_000_000));
      const l = BigInt(Math.min(Number(lteNs), winEnd * 1_000_000));
      const base = `${POLYGON_API}/v3/quotes/${encodeURIComponent(occ)}?timestamp.gte=${g}&timestamp.lte=${l}&order=asc&limit=${QUOTE_PAGE_LIMIT}`;
      const { rows, truncated: tr } = await fetchPaged(base, apiKey, deadlineMs);
      if (tr) truncated = true;
      all.push(...parseQuotes(rows));
      winStart = t.tsMs - QUOTE_PREPAD_MS;
      winEnd = winStart + QUOTE_WINDOW_MS;
      if (Date.now() >= deadlineMs) {
        truncated = true;
        break;
      }
    }
  }
  {
    const g = BigInt(Math.max(Number(gteNs), (winStart - QUOTE_PREPAD_MS) * 1_000_000));
    const base = `${POLYGON_API}/v3/quotes/${encodeURIComponent(occ)}?timestamp.gte=${g}&timestamp.lte=${lteNs}&order=asc&limit=${QUOTE_PAGE_LIMIT}`;
    const { rows, truncated: tr } = await fetchPaged(base, apiKey, deadlineMs);
    if (tr) truncated = true;
    all.push(...parseQuotes(rows));
  }
  all.sort((a, b) => a.tsMs - b.tsMs);
  const dedup: QuotePoint[] = [];
  for (const q of all) {
    const prev = dedup[dedup.length - 1];
    if (prev && prev.tsMs === q.tsMs && prev.bid === q.bid && prev.ask === q.ask) continue;
    dedup.push(q);
  }
  return { quotes: dedup, truncated };
}

function parseOccMeta(occ: string): { expiration: string; strike: number; optionType: "call" | "put" } | null {
  const m = occ.match(/^O:([A-Z0-9.]+)(\d{6})([CP])(\d{8})$/);
  if (!m) return null;
  const [, , yymmdd, cp, strikeRaw] = m;
  const yy = 2000 + Number(yymmdd.slice(0, 2));
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  const expiration = `${yy}-${mm}-${dd}`;
  const strike = Number(strikeRaw) / 1000;
  const optionType = cp === "C" ? "call" : "put";
  return { expiration, strike, optionType };
}

export async function runStrategistTapeBackfill(args: {
  ticker: string;
  chain: ChainLike[];
  chainSummary: ChainSummaryLike;
  budgetMs?: number;
}): Promise<TapeBackfillStatus> {
  const ticker = args.ticker.toUpperCase();
  const budgetMs = args.budgetMs ?? DEFAULT_BUDGET_MS;
  const deadline = Date.now() + budgetMs;
  const sessionDate = nyCalendarYmd(new Date());
  const { openMs, closeMs } = rthBoundsMs(sessionDate);
  const nowMs = Date.now();
  const endMs = Math.min(nowMs, closeMs);
  const coverageEndMs = endMs;

  const apiKey = process.env["POLYGON_API_KEY"];
  if (!apiKey) {
    return {
      status: "skipped",
      reason: "no_api_key",
      sessionDate,
      coverageEndMs,
      occRequested: 0,
      occCompleted: 0,
      tradesInserted: 0,
    };
  }

  const probe = await probePolygonRate();
  if (probe.tier === "starter") {
    logger.warn({ ticker, msg: probe.message }, "strategistTapeBackfill: Polygon tier looks starter, skipping");
    return {
      status: "skipped",
      reason: "starter_tier",
      sessionDate,
      coverageEndMs,
      occRequested: 0,
      occCompleted: 0,
      tradesInserted: 0,
    };
  }

  if (nowMs < openMs || nowMs > closeMs + 60 * 60 * 1000) {
    logger.info({ ticker, sessionDate }, "strategistTapeBackfill: outside regular session window, skipping");
    return {
      status: "skipped",
      reason: "outside_rth",
      sessionDate,
      coverageEndMs,
      occRequested: 0,
      occCompleted: 0,
      tradesInserted: 0,
    };
  }

  const occList = buildTapeOccList(ticker, args.chain, args.chainSummary);
  if (occList.length === 0) {
    return {
      status: "skipped",
      reason: "no_contracts",
      sessionDate,
      coverageEndMs,
      occRequested: 0,
      occCompleted: 0,
      tradesInserted: 0,
    };
  }

  const startMs = openMs;
  const gteNs = BigInt(startMs) * 1_000_000n;
  const lteNs = BigInt(endMs) * 1_000_000n;
  let occCompleted = 0;
  let tradesInserted = 0;
  let anyTruncated = false;
  let anyError = false;

  for (const occ of occList) {
    if (Date.now() >= deadline) {
      anyTruncated = true;
      break;
    }
    const occDeadline = Math.min(deadline, Date.now() + Math.max(5_000, Math.floor(budgetMs / Math.max(1, occList.length))));

    const meta = parseOccMeta(occ);
    if (!meta) {
      anyError = true;
      continue;
    }

    const tradeUrl = `${POLYGON_API}/v3/trades/${encodeURIComponent(occ)}?timestamp.gte=${gteNs}&timestamp.lte=${lteNs}&order=asc&limit=${TRADE_PAGE_LIMIT}`;
    const { rows: tradeRows, truncated: trTr } = await fetchPaged(tradeUrl, apiKey, occDeadline);
    if (trTr) anyTruncated = true;
    const parsed = parseTrades(occ, tradeRows);
    const { quotes, truncated: trQ } = await fetchQuotesWindowed(occ, apiKey, parsed, gteNs, lteNs, occDeadline);
    if (trQ) anyTruncated = true;

    const rowsToInsert: Array<typeof optionsFlowRawTradesTable.$inferInsert> = [];
    for (const t of parsed) {
      const nb = nbboAtOrBefore(quotes, t.tsMs);
      const cl = classifyForFlowPersistence({
        price: t.price,
        size: t.size,
        conditions: t.conditions,
        nbbo: nb,
      });
      if (!cl.shouldPersist) continue;
      rowsToInsert.push({
        underlyingSymbol: ticker,
        date: sessionDate,
        timestamp: new Date(t.tsMs),
        optionSymbol: occ,
        optionType: meta.optionType,
        strike: meta.strike,
        expiration: meta.expiration,
        tradePrice: t.price,
        size: t.size,
        notional: cl.notional,
        side: cl.side,
        isBlock: cl.isBlockForDb,
        isSweep: cl.isSweep,
        sourceTradeId: t.dedupId,
      });
    }

    if (rowsToInsert.length > 0) {
      try {
        const ins = await db
          .insert(optionsFlowRawTradesTable)
          .values(rowsToInsert)
          .onConflictDoNothing({
            target: [
              optionsFlowRawTradesTable.underlyingSymbol,
              optionsFlowRawTradesTable.date,
              optionsFlowRawTradesTable.sourceTradeId,
            ],
          })
          .returning({ id: optionsFlowRawTradesTable.id });
        tradesInserted += ins.length;
      } catch (err) {
        logFlowPipelineWarn(
          "tape_backfill_insert",
          "strategistTapeBackfill: batch insert failed",
          { err, occ, ticker, rowCount: rowsToInsert.length },
        );
        anyError = true;
      }
    }

    try {
      await db
        .insert(optionsTapeBackfillOccCacheTable)
        .values({
          ticker,
          sessionDate,
          occ,
          lastCoverageEndNs: lteNs,
        })
        .onConflictDoUpdate({
          target: [
            optionsTapeBackfillOccCacheTable.ticker,
            optionsTapeBackfillOccCacheTable.sessionDate,
            optionsTapeBackfillOccCacheTable.occ,
          ],
          set: { lastCoverageEndNs: lteNs, updatedAt: new Date() },
        });
    } catch (err) {
      logFlowPipelineWarn(
        "tape_backfill_occ_cache",
        "strategistTapeBackfill: occ cache upsert skipped",
        { err, occ },
      );
    }

    occCompleted++;
  }

  await flushFlowPersistenceNow();
  try {
    await runRollupOnceForSymbol(ticker, sessionDate);
  } catch (err) {
    logFlowPipelineWarn(
      "tape_backfill_symbol_rollup",
      "strategistTapeBackfill: symbol rollup failed",
      { err, ticker },
    );
    anyError = true;
  }

  let status: TapeBackfillStatusValue = "complete";
  if (anyError && occCompleted === 0) status = "failed";
  else if (anyError || anyTruncated || occCompleted < occList.length) status = "partial";

  logger.info(
    { ticker, status, occCompleted, occRequested: occList.length, tradesInserted, anyTruncated },
    "strategistTapeBackfill: done",
  );

  return {
    status,
    reason: anyTruncated ? "timeout_or_pagination" : anyError ? "insert_or_rollups" : null,
    sessionDate,
    coverageEndMs,
    occRequested: occList.length,
    occCompleted,
    tradesInserted,
  };
}
