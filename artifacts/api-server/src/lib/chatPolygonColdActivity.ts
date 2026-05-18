/**
 * Tier A: Polygon REST options snapshot + server-side volume/OI rankings for chat
 * (works without options_chain_daily / flow backfill).
 *
 * Tier B: bounded on-demand flow capture (existing requestFlowCapture) when the
 * user asks tape-style questions or the snapshot shows concentrated volume.
 */
import type { PolygonChainResult, PolygonParsedContract } from "./polygonChain.js";
import { fetchPolygonChain } from "./polygonChain.js";
import { requestFlowCapture } from "./flowCaptureService.js";
import { getPolygonFlowHighlights, type PolygonFlowHighlights } from "./polygonFlowHighlights.js";
import { getQuoteBySymbol } from "./schwabStreamer.js";
import type { ChainSummaryLike } from "./strategistTapeBackfill.js";

type ColdPackLog = { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void };

/** Schwab-style OCC → Polygon `O:…` (same rules as polygonUnusualFlowScan). */
export function schwabStyleToPolygonOcc(schwabSym: string): string | null {
  const collapsed = schwabSym.replace(/\s+/g, "");
  if (!/^[A-Z./]{1,6}\d{6}[CP]\d{8}$/.test(collapsed)) return null;
  return `O:${collapsed}`;
}

export function userRequestsOptionsTapeDetail(message: string): boolean {
  const t = message.toLowerCase();
  return /\b(unusual|options?\s+flow|flow|sweep|sweeps|block\s*print|tape|prints|activity|crazy|heating|moving|going\s+on|what'?s\s+going)\b/.test(t);
}

interface ChainLikeRow {
  strike: number;
  expiration: string;
  type: string;
  optionType?: string;
  openInterest?: number;
  volume?: number;
}

function polygonChainToCaptureInputs(chain: PolygonChainResult): { rows: ChainLikeRow[]; summary: ChainSummaryLike } {
  const spot = chain.underlyingPrice ?? 0;
  const calls = chain.calls ?? [];
  const puts = chain.puts ?? [];
  const rows: ChainLikeRow[] = [];
  for (const c of calls) {
    rows.push({
      strike: c.strike,
      expiration: c.expiration,
      type: "call",
      optionType: "CALL",
      openInterest: c.openInterest,
      volume: c.volume,
    });
  }
  for (const p of puts) {
    rows.push({
      strike: p.strike,
      expiration: p.expiration,
      type: "put",
      optionType: "PUT",
      openInterest: p.openInterest,
      volume: p.volume,
    });
  }
  const atmStrike =
    spot > 0
      ? [...calls].sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0]?.strike ??
        calls[0]?.strike ??
        0
      : (calls[0]?.strike ?? puts[0]?.strike ?? 0);
  const availableExpirations = [...new Set([...calls.map((c) => c.expiration), ...puts.map((p) => p.expiration)])].sort();
  const curatedExpirations = availableExpirations.slice(0, 6).map((expiration) => ({
    expiration,
    dte: Math.max(
      0,
      Math.round((new Date(`${expiration}T20:00:00Z`).getTime() - Date.now()) / 86_400_000),
    ),
  }));
  return {
    rows,
    summary: { atmStrike, availableExpirations, curatedExpirations },
  };
}

function vol(c: PolygonParsedContract): number {
  const v = c.volume;
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0;
}

function oi(c: PolygonParsedContract): number {
  const x = c.openInterest;
  return typeof x === "number" && Number.isFinite(x) ? Math.max(0, x) : 0;
}

function notionalDayUsd(c: PolygonParsedContract): number {
  const px = c.last ?? (c.bid != null && c.ask != null ? (c.bid + c.ask) / 2 : undefined);
  if (px == null || !Number.isFinite(px)) return 0;
  return vol(c) * px * 100;
}

export function snapshotSuggestsElevatedActivity(chain: PolygonChainResult): boolean {
  const all = [...(chain.calls ?? []), ...(chain.puts ?? [])];
  if (all.length === 0) return false;
  let sum = 0;
  let maxV = 0;
  for (const c of all) {
    const v = vol(c);
    sum += v;
    if (v > maxV) maxV = v;
  }
  if (sum >= 8_000 && maxV >= 400) return true;
  if (maxV >= 1_200) return true;
  const sorted = [...all].sort((a, b) => vol(b) - vol(a));
  const top = sorted[0];
  if (!top) return false;
  const v0 = vol(top);
  if (sum > 0 && v0 / sum >= 0.35 && v0 >= 200) return true;
  const topOi = sorted.filter((x) => oi(x) > 0).sort((a, b) => vol(b) / Math.max(1, oi(b)) - vol(a) / Math.max(1, oi(a)))[0];
  if (topOi && oi(topOi) > 0 && vol(topOi) / oi(topOi) >= 4 && vol(topOi) >= 150) return true;
  return false;
}

function sideLabel(c: PolygonParsedContract, calls: PolygonParsedContract[]): "call" | "put" {
  return calls.includes(c) ? "call" : "put";
}

function rankForTierA(chain: PolygonChainResult, underlying: string): Record<string, unknown> {
  const calls = chain.calls ?? [];
  const puts = chain.puts ?? [];
  const all: PolygonParsedContract[] = [...calls, ...puts];
  const withVol = all.filter((c) => vol(c) > 0);
  const byVol = [...withVol].sort((a, b) => vol(b) - vol(a)).slice(0, 18);
  const byVolOi = [...all]
    .filter((c) => oi(c) >= 50 && vol(c) > 0)
    .sort((a, b) => vol(b) / oi(b) - vol(a) / oi(a))
    .slice(0, 12);
  let callVol = 0;
  let putVol = 0;
  let callNot = 0;
  let putNot = 0;
  for (const c of calls) {
    callVol += vol(c);
    callNot += notionalDayUsd(c);
  }
  for (const p of puts) {
    putVol += vol(p);
    putNot += notionalDayUsd(p);
  }
  const row = (c: PolygonParsedContract) => ({
    side: sideLabel(c, calls),
    strike: c.strike,
    expiration: c.expiration,
    dayVolume: vol(c),
    openInterest: oi(c),
    volOi: oi(c) > 0 ? Math.round((vol(c) / oi(c)) * 1000) / 1000 : null,
    approxDayNotionalUsd: Math.round(notionalDayUsd(c)),
    bid: c.bid ?? null,
    ask: c.ask ?? null,
    last: c.last ?? null,
    iv: c.iv ?? null,
    delta: c.delta ?? null,
    polygonOcc: c.schwabSymbol ? schwabStyleToPolygonOcc(c.schwabSymbol) : null,
  });
  return {
    underlying,
    underlyingPrice: chain.underlyingPrice ?? null,
    methodology: {
      tierA:
        "Snapshot from Polygon REST /v3/snapshot/options (same-day volume/OI in response). "
        + "This is not classified tape (no sweep/block tags). Use Tier B / flow JSON for tape when present.",
      tierB:
        "Short bounded WS/REST capture may populate classified prints below when triggered.",
    },
    dayVolumeTotals: { calls: callVol, puts: putVol, all: callVol + putVol },
    approxDayNotionalUsdTotals: { calls: Math.round(callNot), puts: Math.round(putNot), all: Math.round(callNot + putNot) },
    topByDayVolume: byVol.map(row),
    topByVolOverOi: byVolOi.map(row),
    elevatedVsQuietChainHeuristic: snapshotSuggestsElevatedActivity(chain),
  };
}

function pickOccsForCapture(chain: PolygonChainResult, maxOccs: number): string[] {
  const calls = chain.calls ?? [];
  const puts = chain.puts ?? [];
  const all = [...calls, ...puts];
  const scored = [...all]
    .map((c) => ({ c, v: vol(c), n: notionalDayUsd(c) }))
    .sort((a, b) => b.v - a.v || b.n - a.n);
  const out: string[] = [];
  for (const { c } of scored) {
    if (!c.schwabSymbol) continue;
    const occ = schwabStyleToPolygonOcc(c.schwabSymbol);
    if (!occ) continue;
    if (out.includes(occ)) continue;
    out.push(occ);
    if (out.length >= maxOccs) break;
  }
  return out;
}

function liveTapeAlreadyRich(h: PolygonFlowHighlights | null): boolean {
  if (!h?.sessionTape) return false;
  if (h.sessionTape.tapeKind !== "live") return false;
  const tp = h.sessionTape.topPrints?.length ?? 0;
  const tot = h.sessionTape.aggressorSessionTotals?.totalPrints ?? 0;
  return tp >= 3 || tot >= 8;
}

export interface ColdPolygonChatAugmentResult {
  section: string;
  /** True when this module invoked `requestFlowCapture` (avoid duplicate eod_fallback capture in chat pack). */
  tierBCaptureAttempted: boolean;
  /** When set, replace highlights with this (after Tier B refresh). */
  highlights?: PolygonFlowHighlights | null;
}

/**
 * Build Tier A (+ optional Tier B) markdown for the chat terminal pack.
 * Does not fetch Schwab chain; uses Polygon snapshot only.
 */
export async function augmentPolygonColdTickerForChat(args: {
  symbol: string;
  lastUserMessage: string;
  highlightsBefore: PolygonFlowHighlights | null;
  packLog: ColdPackLog;
}): Promise<ColdPolygonChatAugmentResult> {
  const sym = args.symbol.toUpperCase().trim();
  const apiKey = (process.env.POLYGON_API_KEY ?? "").trim();
  if (!apiKey) {
    return {
      tierBCaptureAttempted: false,
      section:
        "### On-demand Polygon options snapshot (cold path)\n"
        + `symbol=${sym}\n`
        + "- **Skipped:** `POLYGON_API_KEY` is not set on this API server — no Polygon REST snapshot can run. Set the key (or use an environment where it is configured) to populate chain rankings here.",
    };
  }

  let chain: PolygonChainResult | null;
  try {
    const q = getQuoteBySymbol(sym);
    const livePx =
      typeof q?.last === "number" && Number.isFinite(q.last)
        ? q.last
        : typeof q?.close === "number" && Number.isFinite(q.close)
          ? q.close
          : undefined;
    const strikeOpts =
      livePx != null && livePx > 0
        ? { strikeMin: Math.floor(livePx * 0.65), strikeMax: Math.ceil(livePx * 1.35) }
        : {};
    chain = await fetchPolygonChain(sym, apiKey, {
      maxDte: 60,
      maxPages: 12,
      ...strikeOpts,
      log: args.packLog,
    });
    const hadStrikeBand = strikeOpts.strikeMin != null && strikeOpts.strikeMax != null;
    if (chain == null && hadStrikeBand) {
      args.packLog.info({ sym }, "chatPolygonColdActivity: empty chain with strike band — retrying without strike filter");
      chain = await fetchPolygonChain(sym, apiKey, { maxDte: 60, maxPages: 12, log: args.packLog });
    }
  } catch (err) {
    args.packLog.warn({ err, sym }, "chatPolygonColdActivity: chain fetch threw");
    return {
      tierBCaptureAttempted: false,
      section:
        "### On-demand Polygon options snapshot (cold path)\n"
        + `symbol=${sym}\n`
        + `- **Error:** Polygon chain fetch threw before any rows were read: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!chain || ((chain.calls?.length ?? 0) === 0 && (chain.puts?.length ?? 0) === 0)) {
    const raw = chain?.rawContractsFetched;
    const detail =
      chain == null
        ? "(Polygon REST returned **zero** raw option rows after any strike-band retry — check `POLYGON_API_KEY`, **Options snapshot entitlements**, HTTP status in server logs, and that the symbol is a US equity option root. Snapshot expiration window uses **NYSE calendar dates**, not UTC midnight.)"
        : typeof raw === "number" && raw > 0
          ? `(Polygon returned **${raw}** raw contract rows but **0** contracts after parse — unexpected API shape; check server logs. After deploy, retry once.)`
        : "(Polygon REST returned no usable option contracts for this underlying.)";
    return {
      tierBCaptureAttempted: false,
      section:
        "### On-demand Polygon options snapshot (cold path)\n"
        + `symbol=${sym}\n`
        + detail,
    };
  }

  const tierAJson = rankForTierA(chain, sym);
  const wantTape = userRequestsOptionsTapeDetail(args.lastUserMessage);
  const hotSnap = snapshotSuggestsElevatedActivity(chain);
  const skipCapture = liveTapeAlreadyRich(args.highlightsBefore);
  const runTierB = (wantTape || hotSnap) && !skipCapture;

  const lines: string[] = [
    "### On-demand Polygon options snapshot (cold path)",
    `- symbol=${sym} underlyingPrice=${chain.underlyingPrice ?? "n/a"} (Polygon REST; no prior DB backfill required for this block)`,
    "- **Tier A** = ranked day volume / vol÷OI from snapshot fields only (not classified sweeps/blocks).",
    "- **Tier B** = short server capture into flow tables when triggered; then prefer **Polygon / DB flow highlights** below for tape-style facts.",
    "```json",
    JSON.stringify(tierAJson, null, 2),
    "```",
  ];

  if (!runTierB) {
    if (wantTape || hotSnap) {
      lines.push(
        "- **Tier B skipped:** session already has live classified tape in DB for this symbol, or capture not needed.",
      );
    } else {
      lines.push(
        "- **Tier B skipped:** question does not ask for tape-style detail and snapshot heuristics did not flag concentrated volume. "
        + "For sweep/block/time-of-sale style answers, ask explicitly about unusual flow, sweeps, tape, or activity.",
      );
    }
    return { section: lines.join("\n"), tierBCaptureAttempted: false };
  }

  const occs = pickOccsForCapture(chain, 14);
  if (occs.length === 0) {
    lines.push("- **Tier B skipped:** could not derive OCC symbols from snapshot rows.");
    return { section: lines.join("\n"), tierBCaptureAttempted: false };
  }

  const { rows: chainRows, summary } = polygonChainToCaptureInputs(chain);

  lines.push(`- **Tier B running:** bounded capture on ${occs.length} OCCs (max ~12s).`);

  try {
    const fc = await requestFlowCapture(sym, {
      occs,
      timeout: 12_000,
      minDurationMs: 1_600,
      chain: chainRows,
      chainSummary: summary,
    });
    const refreshed = await getPolygonFlowHighlights(sym, fc.tapeBackfill);
    lines.push("#### Tier B capture result");
    lines.push(
      `- sessionDate=${fc.sessionDate} source=${fc.source} durationMs=${fc.durationMs} rowsInserted=${fc.rowsInserted} occsSubscribed=${fc.occsSubscribed}`,
    );
    lines.push(`- errors: ${fc.errors.length ? fc.errors.join("; ") : "none"}`);
    lines.push(
      "- If **rowsInserted** is 0, tape may still be quiet for these strikes; rely on Tier A snapshot rankings unless flow JSON below populates.",
    );
    return {
      section: lines.join("\n"),
      tierBCaptureAttempted: true,
      highlights: refreshed ?? args.highlightsBefore,
    };
  } catch (err) {
    args.packLog.warn({ err, sym }, "chatPolygonColdActivity: Tier B capture failed");
    lines.push(`#### Tier B capture error\n- ${err instanceof Error ? err.message : String(err)}`);
    return { section: lines.join("\n"), tierBCaptureAttempted: true };
  }
}
