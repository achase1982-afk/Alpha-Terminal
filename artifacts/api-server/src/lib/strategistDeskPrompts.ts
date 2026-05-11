/**
 * Prompt templates for Strategist Desk mode (multi-section analysis).
 * Single-voice framing: one analyst, topic sections for navigation, no separate desk personas.
 */

import { buildScannerContextPromptBlock, type ScannerStrategistContext } from "./scannerStrategistContext.js";
import {
  CONVICTION_DESK_ADDITIONS_INSTRUCTIONS,
  CONVICTION_DESK_FULL_JSON_SKELETON,
  CONVICTION_DESK_FINAL_SHAPE_GUARD,
} from "./convictionDeskSoloSupersetPrompt.js";
/** Single-voice rule injected into each section prompt. */
const SINGLE_VOICE_FRAMING = `You are writing one analysis broken into clearly labeled sections. There is one voice and one analyst. Section headers exist to help the reader navigate the analysis, not to attribute authorship to different roles. Do not write as a separate team, desk, or role. Use plain topic labels in prose only when helpful: Volatility, Flow, Catalyst, Decision.`;

/** Injected after the market snapshot; keeps LLM output client-safe (no vendor / pipeline narration). */
export const OUTPUT_NO_SOURCE_RULES = `

OUTPUT STYLE (strict):
- Do not name data vendors, brokers, news brands, or third-party feeds (e.g. no Polygon, Schwab, IBKR, Yahoo, etc.).
- Do not refer to "the payload", "the data package", "the feed", "the API", "the file", or similar ingestion or plumbing language.
- Write as if you are reading the chain and the surface directly: "the tape", "the chain", "listed expiries", "the vol surface", "flow on screen".
- If something looks like a known market artifact (e.g. front-week IV clamping, stale prints), describe the artifact plainly without attributing it to a system or vendor name.`;

/** When intraday / stream enrichments are present in the data package JSON. */
export const CONVICTION_DESK_INTRADAY_DATA_GUIDANCE = `

## INTRADAY AND LIVE EQUITY CONTEXT (data dictionary)
When any field in these sections is **null** or a parent object such as **intraday** is **null**, the live source was unavailable on this run; do not interpret **null** as bearish or bullish, and fall back to the existing pre-computed snapshot fields for that dimension (**price**, chain marks, **polygonFlowHighlights**, **scannerContext**, **dataQualitySummary**, etc.).
In prose, use full phrases (**Volume Weighted Average Price**, **Relative Strength Index**) instead of abbreviations alone. Resting chain rows remain the authority when stream-backed marks are **null** or stale; **options_data_freshness** summarizes how much of the active watchlist had fresh stream ticks versus REST-only reads.

**Session-date attribution (intraday.vwap / intraday.rsi / intraday.equity_block_tape):** Each block may include **vwap_as_of_session_date**, **rsi_as_of_session_date**, and **equity_block_tape_as_of_session_date** (ISO **YYYY-MM-DD**, US equity **session** date in America/New_York). When these match **today's** session date, the metrics are anchored to the **current** regular session when tape or minute data exists. When they show an **earlier** calendar date, the **current** session had **no usable stream-backed tape or chart minute history** for that metric and the value was **filled from the most recent prior session** using **only** the packaged broker stream caches for tape and one-minute bars (no cross-vendor fallbacks). When **Volume Weighted Average Price** or **Relative Strength Index** is null, treat that as **no usable minute or tape history** in the current or recent sessions—down-weight intraday conviction accordingly. For **Relative Strength Index**, minute closes merge tape prints (last trade per ET minute) with one-minute bar closes when needed, walking backward across session boundaries until fifteen closes exist. Treat earlier dates as **stale relative to a live intraday tape**—down-weight conviction from those fields versus fresh session activity. Order book and streamed equity quotes do not use this fallback and may remain null when stale.

### Live Intraday Equity Context (**intraday.vwap**, **intraday.rsi**)
- Volume Weighted Average Price (session) (**intraday.vwap.vwap_session**): Session cumulative VWAP from tape prints (volume-weighted in the packaged regular-session window); **null** when tape lacks sufficient prints. No non-packaged equity vendor fills this field.
- Volume Weighted Average Price delta percent (current price vs session VWAP) (**intraday.vwap.vwap_delta_pct**): Spot versus session VWAP in percent (positive means spot above session VWAP, negative below, near zero at VWAP) when both numbers exist; **null** when session VWAP or spot is unavailable.
- Relative Strength Index 14 (**intraday.rsi.rsi_14**): Wilder RSI on **1-minute closes**: primary series is **last trade per ET minute** from tape; if fewer than fifteen minute closes exist, the merge adds **one-minute bar closes** from the subscribed chart stream; **null** when neither path yields enough bars.

### Equity Block Tape Activity (rolling 30 minute window) (**intraday.equity_block_tape**)
- Block count (**intraday.equity_block_tape.block_count_30min**): Count of large prints in the last thirty minutes by share-count or notional threshold.
- Block notional in dollars (**intraday.equity_block_tape.block_notional_30min**): Sum notional of those prints over the same window.
- Block side imbalance (**intraday.equity_block_tape.block_side_imbalance**): Signed imbalance of block notional versus session VWAP (positive leans buy-heavy above VWAP, negative sell-heavy below, near zero balanced) when both sides have mass; **null** when classification lacks supporting notionals.
- Last block age in seconds (**intraday.equity_block_tape.last_block_age_seconds**): Seconds since the newest qualifying block print, or **null** when no block fired in the window.

### Live Order Book State (**intraday.order_book**)
- Top of book bid size (**intraday.order_book.top_of_book_bid_size**): Displayed size at the best bid when the venue book snapshot is fresh.
- Top of book ask size (**intraday.order_book.top_of_book_ask_size**): Displayed size at the best ask when the venue book snapshot is fresh.
- Book imbalance percent (**intraday.order_book.book_imbalance_pct**): Top-of-book size imbalance in percent (positive means bid-heavy, negative ask-heavy) when both sides are present.
- Depth within 1 percent of mid, bid side (**intraday.order_book.depth_within_1pct_bid**): Resting bid depth within one percent of mid when computable.
- Depth within 1 percent of mid, ask side (**intraday.order_book.depth_within_1pct_ask**): Resting ask depth within one percent of mid when computable.
- Book age in milliseconds (**intraday.order_book.book_age_ms**): Age of the venue book snapshot; stale ages may accompany **null** depth fields.
- Listing venue for the book row (**intraday.order_book.venue**): Which listing feed supplied the row when resolved.

### Quote Source Comparison (top-level snapshot fields)
- Primary REST quote (**price**, **dailyChangePct**, and related header equity fields): Packaged cash equity mark and day change from the REST snapshot that anchors chain marks and desk context.
- Stream quote enrichment (**schwab_stream_bid**, **schwab_stream_ask**, **schwab_stream_last**, **schwab_stream_age_ms**): Parallel streamed National Best Bid and Offer style updates when fresh; **null** fields mean no qualifying stream quote on this run.
- Alternate venue Level 1 (**ibkr_l1_bid**, **ibkr_l1_ask**, **ibkr_l1_last**, **ibkr_l1_age_ms**): Cross-check quote path when the tuning gateway stream is live; wide **ibkr_l1_age_ms** with **null** bid or ask means stale or unavailable.
- Quote delta in basis points (**ibkr_schwab_quote_delta_bps**): Mid versus mid gap in basis points when both stream and fresh alternate two-sided quotes exist; **null** when either side is missing.

### Live Options Data Freshness (**options_data_freshness**)
- Source (**options_data_freshness.source**): **schwab_rest_chain_only** means REST pull only, **mixed_stream_and_rest** is hybrid stream plus REST, **schwab_levelone_options_stream** means live stream backed the sampled contracts, **enrichment_error** means the enrichment pass failed.
- Maximum quote age in milliseconds across active watchlist contracts (**options_data_freshness.max_quote_age_ms**): Oldest observed quote age among contracts sampled for freshness on this run.
- Count of contracts backed by live stream (**options_data_freshness.contracts_live_stream_backed**): Contracts whose latest tick was inside the fresh stream window.
- Count of contracts using REST fallback only (**options_data_freshness.contracts_rest_only**): Contracts without a fresh stream tick at snapshot time.

### Ticker Signal Snapshot (**intraday.signal_snapshot**)
- Snapshot age in seconds (**intraday.signal_snapshot.snapshot_age_seconds**): Time since the scanner worker row was written when a row exists.
- Pass-through computed signal columns from snapshot worker output (**intraday.signal_snapshot** fields such as **composite_score**, **component_scores**, **flow_summary**, **sector**, **market_cap_tier**, **spot**, **daily_change_pct**, **snapshot_at**, **ticker**): Latest persisted scanner snapshot slice joined for context; interpret jointly with **scannerContext** when both appear.
`;

/** Solo Desk + Conviction Desk: force cash-equity session facts into JSON strings, not options-only narrative. */
export const STRATEGIST_EQUITY_MOVES_OUTPUT_RULES = `

## EQUITY SESSION MOVES (integrate into JSON prose when snapshot fields exist)
The report must reflect **underlying cash action**, not options marks alone. When **price**, **dailyChangePct**, **intraday**, **signal_snapshot**, or top-level equity enrichment fields (stream ages, quote cross-check deltas) are present in the snapshot, cite them in the output: at minimum session percent change from **dailyChangePct** when available, spot level from **price** when useful, and how spot relates to session **Volume Weighted Average Price** plus **Relative Strength Index** tone when **intraday.vwap** / **intraday.rsi** carry numbers. When **intraday.equity_block_tape** or **intraday.order_book** are populated, say whether large prints or displayed liquidity skew confirms or fights the listed-options flow read.

Route these facts into the sections they inform: **flow** (**dominant_flow**, **institutional_signal**, **read**), **pm** (**thesis**, **edge_check**, **watch_for**), **vol** (**implied_vs_realized**, **read**) when spot versus implied move matters, **catalyst** (**read**) only when price action clearly ties to the event story. On Conviction Desk, also **family_hypotheses**, **regime_synthesis**, **positioning_context**, **risk_of_ruin**, and **self_check** when cash positioning informs regime, crowding, or structure choice.

When **intraday** is **null** or nested fields are mostly **null**, note briefly that live equity enrichments were thin on this run and lean on chain plus session tape; still surface **price** and **dailyChangePct** when present. Use full phrases (**Volume Weighted Average Price**, **Relative Strength Index**) and honor OUTPUT STYLE vendor rules.
`;

/**
 * Conviction Desk only: **tapeKind** is pipeline capture state, not a trade thesis input outside Flow attribution.
 * Placed before per-section instructions in **buildConvictionDeskUserPrompt**.
 */
export const CONVICTION_DESK_TAPE_AVAILABILITY_SCOPE = `

## TAPE AVAILABILITY VS MARKET SIGNAL (Conviction Desk)

Tape availability is a data-pipeline state, not a market signal. The session tape's **tapeKind** (**live** versus **eod_fallback**) describes what the system was able to capture for classified options prints, not what the market is doing.

Tape availability **may** be cited in the **Flow** section's institutional versus retail attribution language (including the existing rule that when **tapeKind** is **eod_fallback**, you do not infer institutional versus retail from that synthesis).

Tape availability **must not** be cited as a load-bearing reason in:
- **pm.thesis** (the pass or structure rationale)
- **pm.edge_check** (what would change the read)
- **pm.biggest_risk** (the central risk to the position or the pass itself)
- **family_hypotheses** scoring fields (**reason_for_score**, **what_would_make_it_unfit**)
- **exit_plan** targets, stops, or time stops, or any blanket pass versus trade rule framed as "wait until classified tape returns" except inside **pm.watch_for** as a monitoring hook (see below)

In those restricted fields, lean on the surface (volatility, term structure, skew, implied versus cleanly adjusted realized), the catalyst landscape (earnings, macro, legal), the positioning context (sell-side, crowded long or short, fade risk), and the regime read. If classified options tape is unavailable, drop the institutional-sponsorship sub-thesis and grade the remaining edges on their own merits.

**pm.watch_for** may reference classified session tape returning as a **forward-looking data event** to monitor; that is allowed.
`;

/** Conviction Desk only: one-line reinforcement after Decision section strip (see **CONVICTION_DESK_TAPE_AVAILABILITY_SCOPE**). */
const CONVICTION_DESK_TAPE_FIELD_REMINDERS = `

### Tape availability reminders (restricted Decision and Conviction fields)
- **pm.thesis**: Do not cite tape availability or **sessionTape.tapeKind** here; lean on surface, catalyst, and positioning evidence.
- **pm.edge_check**: Do not cite tape availability or **sessionTape.tapeKind** here; falsify with real market conditions (surface dislocation, IV move, skew shift, catalyst resolution).
- **pm.biggest_risk**: Do not cite tape or data-availability risk here; state a market risk (gap, IV crush, catalyst miss, regime flip).
- **pm.exit_plan**: Anchor profit target, stop, and time stop to price, vol, or catalyst dates, not to waiting for classified tape.
- **family_hypotheses.reason_for_score**: Do not mark a family unfit solely because options **tapeKind** was **eod_fallback**; compare families on vol surface, fundamentals, and positioning fit.
`;

/** Catalyst / event narrative: sell-side firms may be named as catalyst actors; retrieval plumbing and outlet attribution may not. */
export const CATALYST_OUTPUT_ATTRIBUTION_RULES = `

OUTPUT STYLE (strict, catalyst and event narrative):
- You MAY name sell-side research firms and their actions when those actions ARE the catalyst (e.g. "Goldman cut PT from $19 to $17 on execution risk", "DA Davidson upgraded from Underperform to Neutral", "Baird raised PT to $25"). The firm and the call are part of the event landscape, not a citation of where you read it.
- Do NOT name websites, data vendors, aggregators, or news outlets as the source of information (no "per Yahoo Finance", "according to vendor headlines", "Fintel reports", "from the company's IR page", "per CNBC", "according to Reuters", etc.). If you mention a sell-side shop, do so only as market actor, never tied to "where we saw it."
- For news-driven catalysts, state the fact or event plainly (e.g. "tornado damage at the Illinois plant"); do not attribute how you learned it to a named outlet or site.
- Do not name data vendors, brokers, or third-party market-data or news-distribution feeds (Polygon, IBKR, etc.) and do not use pipeline narration ("the data package", "the feed", "our flow data", "the API", "the file").
- Write as if you are reading the calendar and name-specific developments directly; omit retrieval mechanics entirely.`;

/**
 * Machine prefix for Item 17 skew25DeltaReason when true 25Δ legs hit the IV ceiling
 * (see strategistV2 computeSkew25DeltaForChain). Kept as a normal string constant so
 * prompt text never nests backticks inside large template literals (esbuild-safe).
 */
const SKEW_25D_IV_CEILING_REASON_PREFIX = "skew_25d_iv_ceiling" as const;

/** Skew bullet for Volatility section (built outside template literals — esbuild parses nested `). */
const VOL_SKEW_BULLET =
  "The skew profile and what it tells you about positioning (cite **skew25Delta** when non-null; if **skew25DeltaReason** is set, interpret it literally: strings starting with **skew_fallback_** mean delta targets were stepped (25Δ→20Δ→15Δ) or a later listed expiry was used after the anchor expiry had no usable IV on one side; strings starting with **skew_iv_filtered_** mean the 25Δ (or stepped-delta) leg had IV removed by the pre-clean filter — do not impute skew from other expiries; legacy reasons starting with " +
  SKEW_25D_IV_CEILING_REASON_PREFIX +
  " refer to older IV-ceiling proxy behavior when present; if **skew25Delta** is null, read **skew25DeltaReason** and say skew is indeterminate from chain for that reason)";

const VOL_CLOSED_SESSION_CONTEXT = `

CLOSED-MARKET VOL CONTEXT (read **dataQualitySummary.marketSession** and **dataQualitySummary.flags**):
- When **marketSession** is **closed** and **iv_contamination_elevated** is **not** listed in **flags**: note that the market is closed; wing-vol confidence is reduced due to weekend illiquidity, not surface contamination.
- When **marketSession** is **closed** and **iv_contamination_elevated** **is** listed in **flags**: note that the market is closed and surface contamination is present beyond expected weekend illiquidity; treat IV reads with caution.
- When **marketSession** is **unknown**: session could not be resolved; do not assume weekend illiquidity or closed-market relief for the IV contamination threshold — use **ivClampedReasons** and **flags** as-is.`;

/** Item 20: literal data-state vocabulary aligned with dataQualitySummary / schemaVersion. */
const DATA_STATE_LANGUAGE_RULES = `

DATA STATE (literal labels only):
- Describe inputs using the **states** and **flags** in **dataQualitySummary** at the top of the JSON (e.g. present, absent, usable, degraded, missing_or_indeterminate, regression_fit, fallback_defaults, iv_contamination_elevated). Read **dataQualitySummary.marketSession** (open, closed, premarket, afterhours, or unknown) and **dataQualitySummary.marketSessionAsOf** for equity session context. Read **dataQualitySummary.impliedMove** for ATM implied-move availability (available, reason, fallbackExpiryUsed). Read **ivClampedCount**, **ivClampedReasons**, **ivCleanedRatio**, and **termStructureExpiries** for deterministic IV hygiene on the chain snapshot. Do not substitute colloquial words like "the feed" or "full data" for those labels.
- Do not claim the tape is "complete" unless **dataQualitySummary.flow.tapeBackfillStatus** is literally **complete** (or the field explicitly documents otherwise).
- If **dataQualitySummary.flags** is non-empty, mention the relevant flag(s) when they affect your conclusion.
- **schemaVersion** is for client compatibility only; do not discuss schema or versioning in prose.`;

function formatScannerContextDeskSection(dataPackage: string): string {
  try {
    const pkg = JSON.parse(dataPackage) as { scannerContext?: ScannerStrategistContext };
    return buildScannerContextPromptBlock(pkg.scannerContext);
  } catch {
    return "";
  }
}

function formatMicrostructureDeskLines(dataPackage: string): string {
  try {
    const pkg = JSON.parse(dataPackage) as {
      nasdaqDepth?: { bidDepth5pct: number; askDepth5pct: number; bookImbalanceRatio: number };
      esContext?: { bidDepth5ticks: number; askDepth5ticks: number; bookImbalanceRatio: number; midPrice: number };
    };
    const parts: string[] = [];
    if (pkg.nasdaqDepth) {
      const d = pkg.nasdaqDepth;
      parts.push(
        `NASDAQ depth (last 1 min): bid ${d.bidDepth5pct} vs ask ${d.askDepth5pct} within 5%, imbalance ${d.bookImbalanceRatio}.`,
      );
    }
    if (pkg.esContext) {
      const e = pkg.esContext;
      parts.push(
        `ES depth (last 1 min): bid ${e.bidDepth5ticks} vs ask ${e.askDepth5ticks} within 5 ticks, imbalance ${e.bookImbalanceRatio}, mid ${e.midPrice}.`,
      );
    }
    if (parts.length === 0) return "";
    return "\n\n" + parts.join("\n");
  } catch {
    return "";
  }
}

function formatClosingImbalanceDeskLine(dataPackage: string): string {
  try {
    const pkg = JSON.parse(dataPackage) as {
      closingImbalance?: {
        side: string;
        notionalUsd: number;
        indicativePrice: number;
        indicativePriceVsLast: number;
      };
    };
    const c = pkg.closingImbalance;
    if (!c) return "";
    const notionalM = Math.abs(c.notionalUsd) / 1_000_000;
    return `

Closing imbalance (last 5 min): ${c.side} $${notionalM.toFixed(2)}M at ${c.indicativePrice}, ${c.indicativePriceVsLast.toFixed(2)}% vs last.`;
  } catch {
    return "";
  }
}

export function snapshotBlock(dataPackage: string): string {
  const imb = formatClosingImbalanceDeskLine(dataPackage);
  const scanner = formatScannerContextDeskSection(dataPackage);
  return `Market snapshot for this name (facts below only; use what is present and do not invent):
${scanner}
${dataPackage}${DATA_STATE_LANGUAGE_RULES}${imb}${formatMicrostructureDeskLines(dataPackage)}`;
}

/** Volatility topic: surface-only voice (no vendor / pipeline attribution). */
export const VOL_OUTPUT_ATTRIBUTION_RULES = `

OUTPUT STYLE (strict, Volatility topic):
- Do not name data vendors, brokers, news brands, or third-party feeds.
- Do not refer to "the payload", "the data package", "the feed", "the API", or similar plumbing language.
- Write as if you are reading the vol surface and chain directly.
- Use **optionsChainSummary.impliedMove** when available. When **dataQualitySummary.impliedMove.available** is false, do not fabricate an implied move; explicitly note the gap reason (for example, the chain did not provide a two-sided ATM pair) and continue the rest of the volatility analysis with the signals that are present. When available is true, use the snapshot fields **termStructure5pt**, **skew25Delta** (25Δ put IV minus 25Δ call IV when present), **realizedVol** (HV20/HV30 when present), **impliedMove** (ATM straddle for the expiry in the object, which may be the first listed expiry with positive DTE if the sort order front was 0DTE), and **ivrContext** in your **iv_state**, **term_structure**, **skew**, **implied_vs_realized**, and **read** strings with explicit numbers when those objects are non-null.`;

export function buildVolAnalystPrompt(dataPackage: string): string {
  return `${SINGLE_VOICE_FRAMING}

This turn produces the **Volatility** section only (JSON fields below). Focus on the volatility surface: IV state, term structure, skew, IV vs realized, and where the surface is rich or cheap relative to your fair value. Identify both where the surface is rich relative to your fair value (short-vol fits: condors, credit spreads, calendars sold from the front, butterflies) and where the surface is cheap relative to your fair value (long-vol fits: long calendars from the back leg, long straddles into macro stacks, backspreads, long single-strike options when skew is flat). Skew interpretation must specifically address directional vol asymmetry — flat-to-bid call skew on a recent upside mover is cheap upside vol, not retail confirmation.

Your output is read at institutional review meetings. Every IV number you quote, every vol point you cite, every term structure observation must be defensible. **termStructure5pt** ATM IVs and **skew25Delta** are assembled from chain IVs that already passed deterministic microstructure, liquidity-floor, and surface-consistency hygiene (see **dataQualitySummary.ivClampedCount** and **ivClampedReasons**); null ATM or null skew on a specific expiry means no trustworthy surviving contracts there — skip that expiry in the vol read rather than inferring from neighbors. If **dataQualitySummary.flags** includes **iv_contamination_elevated**, call that out: more than 30% of strikes had IV removed by reasons that count toward the contamination threshold (spread-wide and zero-liquidity microstructure removals may be excluded from that threshold only when **dataQualitySummary.marketSession** is **closed**; when **unknown**, the full threshold applies — see **ivClampedReasons** for the full breakdown). Math is checked before publication. If you state a number, you can defend it.${VOL_CLOSED_SESSION_CONTEXT}

You are not providing liquidity to smarter money. If the surface shows neither a sell-able dislocation nor a buy-able opportunity, your read is no actionable vol edge here and you say so. Do not equate vol edge with vol surface richness — long-vol setups are vol edge too. Do not invent edge to fill space.

For each ticker, produce structured output identifying:
- Where IV percentile sits and what regime that implies (use **ivr** with **ivrContext** when present)
- The shape of the term structure and any dislocations (cite **termStructure5pt** expiries and ATM IVs when the array is present, not only front vs back month)
- ${VOL_SKEW_BULLET}
- The implied vs realized comparison concretely (cite **realizedVol** HV20/HV30 when present; reference **impliedMove** vs spot when present)
- A read that names specific structures that capture your view, with specific DTE windows and approximate strike placement

Be concrete. "Vol is elevated" is bad. Two contrasting examples of good reads: SHORT-VOL: "IVR 76, back-month 80% vs realized 55%, 25 vol-point premium concentrated in the May 29 earnings expiry, prefer May 15 credit structures or short-front calendars." LONG-VOL: "IVR 42, term structure flat at 65% with seven macro prints inside the position window, 25Δ skew flat-to-bid on a recent +90% mover, prefer 8/21 backspreads or long straddles capturing the macro stack."

This section does not finalize a trade. It states the surface read. A later **Decision** section may propose structure.

${snapshotBlock(dataPackage)}${OUTPUT_NO_SOURCE_RULES}${VOL_OUTPUT_ATTRIBUTION_RULES}

Respond with ONLY a JSON object (no markdown fences, no extra prose):
{
  "iv_state": "<string>",
  "term_structure": "<string>",
  "skew": "<string>",
  "implied_vs_realized": "<string>",
  "read": "<string>"
}`;
}

export function buildFlowAnalystPrompt(dataPackage: string): string {
  return `${SINGLE_VOICE_FRAMING}

This turn produces the **Flow** section only (JSON fields below). Focus on positioning: where real size is being worked, where retail noise sits, what the aggressor profile shows, and what block and sweep tape attributes to institutional versus retail flow.

Your output is read at institutional review meetings. Every claim of institutional buying or retail noise must be supported by specific evidence: aggressor mix, block size, sweep classification, vol over open interest ratios, or absence of confirming tape. When session tape is missing or limited, say so explicitly and adjust conviction accordingly. Do not extrapolate institutional positioning from headline volume alone.

You are not providing liquidity to smarter money. If the tape does not show clean institutional sponsorship in either direction, your read is tape is mixed or no institutional conviction visible and you say so. Retail upside lottery is retail upside lottery, not institutional accumulation.

The snapshot includes **polygonFlowHighlights** with:
- The usual per-strike EOD snapshot (volume, OI, vol/OI, top lists), baseline positioning.
- **sessionTape** when present. Check **sessionTape.tapeKind**: "live" — **execPerStrike** (sweep/block/regular counts and notionals per strike for the session), **topPrints** (largest session prints with sweep/block flags and **side** ask/bid/mid when available), **aggressorByStrike**, **aggressorSessionTotals**. "eod_fallback" — same object shape but synthesized from EOD volume only: **sweepCount**/**blockCount** are zero, **side** is null, aggressor mix is unknown; use it to rank where volume concentrated, not for sweep/block or buyer/seller lean.

When **tapeBackfill** is present in the snapshot, read **tapeBackfill.status**. If it is **complete**, treat session tape as full coverage through **tapeBackfill.coverageEndMs** for that session. If **partial** or **failed**, you must state in **read** (and where relevant in flow fields) that session tape coverage is incomplete: cite **tapeBackfill.occCompleted** vs **tapeBackfill.occRequested** and **tapeBackfill.reason** in plain language (no vendor names). Do not imply full-session coverage. If **skipped**, say tape backfill did not run and why only if **tapeBackfill.reason** helps the trader (otherwise keep brief).

When **sessionTape.tapeKind** is "live", anchor **dominant_flow**, **institutional_signal**, **retail_signal**, **key_strikes**, and **read** in concrete tape facts: sweeps, blocks, ask/bid lean, largest prints. When "eod_fallback", describe flow from volume concentration and unusual vol/OI only; do not claim sweeps, blocks, or aggressor. If **sessionTape** is null, lean on the EOD per-strike snapshot and chain unusual activity only. Do not invent sweep counts.

OPTIONS AGGRESSOR VERSUS EQUITY CASH SESSION CONTEXT
- Classified options prints and aggressor mix come from **polygonFlowHighlights.sessionTape** (see **tapeKind**). Equity cash-session context (Volume Weighted Average Price, equity block tape, Relative Strength Index, streamed quotes, order book) comes from **intraday** and related top-level snapshot fields. When options aggressor data is unavailable because **tapeKind** is **eod_fallback**, say so once in institutional-attribution language (**institutional_signal**, **read**). When equity intraday fields are **null** or thin, that is a **separate** condition; do not bundle both into one vague "no live tape" read.

Example quality bar (adapt numbers to the snapshot): "Smart money accumulating 460 calls via sweeps (12 sweep prints totaling $850k notional, 78% ask-side). Retail chasing 490 lottos (small prints, mid-price executions, few sweeps)."

This section maps the tape. It does not finalize a trade.

${snapshotBlock(dataPackage)}${OUTPUT_NO_SOURCE_RULES}

Respond with ONLY a JSON object (no markdown fences, no extra prose):
{
  "dominant_flow": "<string>",
  "institutional_signal": "<string>",
  "retail_signal": "<string>",
  "key_strikes": [
    {"strike": <number>, "expiry": "<YYYY-MM-DD>", "type": "<call|put>", "observation": "<string>"}
  ],
  "read": "<string>"
}`;
}

export function buildCatalystAnalystPrompt(
  dataPackage: string,
  structuredResearchBriefing?: string,
  options?: { catalystSlotNativeWebSearch?: boolean },
): string {
  const nativeWeb = options?.catalystSlotNativeWebSearch
    ? `

## WEB SEARCH (your turn, native tools)
Your provider supports web search **on this JSON turn**. Use the built-in web search tool as needed before answering. Run focused searches aligned with: IR / company events, analyst actions (last ~60 days), earnings reaction history, sector ETF and peers, and (if the catalyst window warrants it) recent news. Prefer primary sources and major financial press; skip content farms.
If a theme has no support after searching, write **data not surfaced** for that slice instead of inventing. Do not paste URLs or name outlets or vendors in the output.
`
    : "";

  const researchBlock = structuredResearchBriefing
    ? `

## STRUCTURED RESEARCH (pre-run for you)
Focused web research was already run; facts below are for synthesis only (do not cite URLs or outlets).

${structuredResearchBriefing}
`
    : "";

  return `${SINGLE_VOICE_FRAMING}

This turn produces the **Catalyst** section only (JSON fields below). Map events: identify the primary catalyst, define the bar to clear in concrete terms, identify which expiry cleanly captures the catalyst, and read directional asymmetry into and out of the event.

Your output is read at institutional review meetings. Every fundamental claim must be sourced and current. Every consensus number must be cited or labeled as estimate. Every historical reaction must be specific (date, magnitude, surrounding context). When data is not surfaced, you say data not surfaced rather than guessing. The bar to clear must be falsifiable: state what the company has to deliver, in numbers where possible.

You are not providing liquidity to smarter money. If the catalyst window is contaminated by macro overlap, you flag it. If consensus has moved sharply (sell-side cuts or raises), you cite the moves and infer what they tell you about the bar. Vague directional reads are not acceptable. Either the asymmetry is identifiable and specific, or you say it is not.

The snapshot includes **catalyst.earnings_history** (up to 16 past prints), **catalyst.forward_estimates** (next scheduled print when present), and **dataQualitySummary.data_source_gaps** when earnings enrichment ran (Strategist modes 3 and 4). Use **earnings_history[].price_reaction** for gap percent, close-to-close percent, five-day percent, and twenty-day drift percent when narrating "the bar to clear" and "historical pattern" (nulls mean equity history did not cover that window; this is normal for older quarters). Use **earnings_history[].iv_reaction.iv_crush_pct** when discussing whether selling premium into earnings has historically worked for this name. Use **forward_estimates.eps_consensus** and **forward_estimates.revenue_consensus** for the forward bar when non-null. Acknowledge **data_source_gaps** explicitly when present (subscription placeholders for high/low and analyst count are expected until RESC is wired). The most recent four quarters typically have fuller reaction fields; older quarters often show Polygon fiscal fields with null reactions. That pattern is expected, not a bug.

The JSON snapshot may include catalystEvaluation (scheduledEvents with types and sources, scope, alignment, residual) and macroEventsInPositionWindow (FOMC, CPI, PPI, NFP, GDP, PCE-style items through userPreferences.deskCatalystPositionWindowExpirationISO). Treat scheduled macro and earnings as authoritative when present. Combine with the structured research block for IR events, sell-side actions, earnings reaction history, sector/peer context, and conditional news themes.

For each ticker, produce structured output identifying:
- The primary catalyst in the position window (or no catalyst, with macro/technical context as substitute)
- The bar to clear in concrete terms (specific metrics, specific guidance, specific commentary)
- The asymmetry direction with reasoning (overpriced, underpriced, symmetric)
- The historical reaction pattern with specific data when available
- A read that names which expirations capture the catalyst cleanly and which expirations are noisy

If a theme has no support in the snapshot or structured research, write **data not surfaced** for that slice instead of inventing.

Be concrete with data. "Earnings asymmetry is bearish" is bad. "Last quarter rallied 26% on R2 commentary, this quarter front-week implies 10% which underprices the upside tail given Q1 deliveries already pre-released and call narrative-dependent" is good.

This section maps the event landscape. It does not finalize a trade.

${snapshotBlock(dataPackage)}${nativeWeb}${researchBlock}${CATALYST_OUTPUT_ATTRIBUTION_RULES}

Respond with ONLY a JSON object (no markdown fences, no extra prose):
{
  "primary_catalyst": "<string>",
  "bar_to_clear": "<string>",
  "asymmetry": "<string>",
  "historical_pattern": "<string>",
  "read": "<string>"
}`;
}

export function buildPmPrompt(
  dataPackage: string,
  volRead: string,
  flowRead: string,
  catalystRead: string,
): string {
  return `${SINGLE_VOICE_FRAMING}

This turn produces the **Decision** section only (same JSON schema as before: top-level key remains **pm** in machine output for compatibility). Integrate the Volatility, Flow, and Catalyst material below with the full snapshot. You are one analyst concluding the write-up: trade or pass, structure, thesis, and risk. The **decision** field is your conclusion, not a separate persona.

Your output is read at institutional review meetings. Every trade must clear a quality bar: vol math must match the Volatility section, strike selection must reconcile with Flow positioning, directional tilt must align with the Catalyst asymmetry read or be explicitly justified as a deviation. If **edge_check** contradicts the Volatility or Flow numbers you already stated, the section fails before it ships.

You are not providing liquidity to smarter money. You are not paid to take trades for activity's sake. You are paid to be right. If the sections below do not converge into a clear structure with quantifiable edge, **decision** is **pass**. There is always another setup. PASS is correct when the data does not support a trade you would defend in front of the room.

When you trade, structures are clean: math defensible, strikes reconciled with flow, breakevens robust to noise, exit plan tied to thesis invalidation rather than arbitrary calendar dates.

The standard is precision over volume. Better to publish two A-grade trades a week than ten B-grade trades. Better to publish a clean PASS than a sloppy trade.

You already produced Volatility, Flow, and Catalyst sections (provided below as text). Stress-test them like an editor: find the weakest claim in each slice and pressure-test it. When sections agree, ask whether they reflect the same fact or the same surface read repeated.

FIND WHERE THE MARKET IS WRONG

Edge exists where price disagrees with reality and you have a specific reason to know which side is right. Without that, you are not trading edge.

Be concrete about mispricing. Name what would need to be true for the trade to work.

NAME WHAT KILLS YOU

Every position has a failure mode. Name the specific scenario, not generic risks.

SIZE FOR CONVICTION

Most runs should pass on most names. Size enum:
Small: thin edge, testing the thesis
Medium: clear edge, sections align with what you see
Large: rare. Mispricing is meaningful, sections converge, structure captures it cleanly

THE THESIS PARAGRAPH

Compressed. Opinionated. If you trade, **thesis** answers: what is mispriced, why you believe it, what kills you, why this size matches conviction. If you pass: what is missing, what would change your mind.

OUTPUT SCHEMA

Same JSON field names as today. **deviation_from_analysts** remains the key name for compatibility; in prose it means deviation from the Volatility section's structural recommendation when you chose a different structure (or the single word **none**).

Volatility section:
${volRead}

Flow section:
${flowRead}

Catalyst section:
${catalystRead}

Data package:
${dataPackage}${formatClosingImbalanceDeskLine(dataPackage)}${formatMicrostructureDeskLines(dataPackage)}
${DATA_STATE_LANGUAGE_RULES}

${OUTPUT_NO_SOURCE_RULES}

Respond with ONLY a JSON object matching the existing schema (top-level **pm** shape in consolidated runs). No markdown, no commentary, just the JSON:
{
  "decision": "trade" | "pass",
  "structure": null | {
    "type": "<strategy name: bull_call_spread, iron_condor, etc.>",
    "legs": [{"type": "call"|"put", "strike": <number>, "action": "buy"|"sell", "expiration": "<YYYY-MM-DD>", "quantity": <optional number>}],
    "expiry": "<YYYY-MM-DD>",
    "credit_or_debit": <number, positive=debit negative=credit>
  },
  "thesis": "<paragraph: your call and the why>",
  "edge_check": "<paragraph: EV math and conviction level, break-even win rate vs realistic win rate, why the trade pencils or why you passed>",
  "deviation_from_analysts": "<paragraph explaining deviation from the Volatility section structural view, or the single word none if you did not deviate>",
  "size": "small" | "medium" | "large",
  "whose_side": "institutional_alignment" | "retail_fade" | "neither",
  "biggest_risk": "<string>",
  "exit_plan": {
    "profit_target": <number, per-share option price target>,
    "stop_loss": <number, per-share option price stop>,
    "time_stop": "<YYYY-MM-DD or empty string>"
  },
  "watch_for": "<if decision is pass, what would change your answer; if trade, can be empty string>"
}`;
}

/**
 * PM turn for **order-ticket review** (trader already built a ticket; no new structure).
 * Same JSON output shape as the trade validator's solo pass (finalVerdict, cases, confidences).
 */
export function buildPmOrderTicketDeskValidationPrompt(
  dataPackage: string,
  volRead: string,
  flowRead: string,
  catalystRead: string,
  orderTicketMarkdown: string,
): string {
  const isClosing = /Intent:\s*CLOSE/i.test(orderTicketMarkdown) || /CLOSE existing position/i.test(orderTicketMarkdown);
  const bullLabel = isClosing
    ? "the strongest honest case to **STAY IN** (thesis still intact, do not clip a winner early, do not panic-sell a paper loss)"
    : "the strongest honest case **FOR** entering this exact trade as built";
  const bearLabel = isClosing
    ? "the strongest honest case to **CLOSE** (thesis broken, take it off, redeploy capital)"
    : "the strongest honest case **AGAINST** entering this exact trade as built";
  return `${SINGLE_VOICE_FRAMING}

This turn is **order-ticket validation**, not a new trade idea. A trader has already constructed a specific broker order and is asking the desk to review **that exact ticket** before send. The Volatility, Flow, and Catalyst sections below are your colleagues' reads on the name. You must ground your verdict in those sections **and** the order ticket (mandatory — do not ignore the ticket or substitute a different structure).

You are not paid to design a better spread for this session. You are paid to call whether **this** ticket is defensible right now. If the sections do not support the ticket, **DO_NOT_PROCEED** is a correct answer.

## ORDER TICKET (authoritative — cite exact strikes, expiries, limits, quantities from here)
${orderTicketMarkdown}

## Analyst sections (synthesis context)

Volatility section:
${volRead}

Flow section:
${flowRead}

Catalyst section:
${catalystRead}

## Full data snapshot (JSON; read null-safe; use labels in dataQualitySummary when present)
${dataPackage}${formatClosingImbalanceDeskLine(dataPackage)}${formatMicrostructureDeskLines(dataPackage)}
${DATA_STATE_LANGUAGE_RULES}
${OUTPUT_NO_SOURCE_RULES}

## OUTPUT (mandatory JSON — same schema as the trade ticket solo validator)
Run web search when you need to confirm a same-day catalyst, earnings window, or analyst action; honor the web-search discipline from the trade validator. Then output **only** this JSON object — no markdown fences, no commentary:
{
  "bullCase": "<3-5 sentences: ${bullLabel}>",
  "bearCase": "<3-5 sentences: ${bearLabel}>",
  "bullConfidence": <integer 0-100>,
  "bearConfidence": <integer 0-100>,
  "finalVerdict": "PROCEED" | "PROCEED_WITH_CAUTION" | "DO_NOT_PROCEED",
  "finalConfidence": <integer 0-100>,
  "reasoningBullets": ["<bullet>", "<bullet>", "<2-4 concise bullets>"],
  "topRisks": ["<bullet>", "<1-3 risks>"],
  "improvements": ["<bullet>", "<0-3 improvements — empty array if finalVerdict is PROCEED>"]
}

Calibration: bullConfidence and bearConfidence are independent. finalConfidence is your confidence in **finalVerdict** on **this ticket**.`;
}

/** Model system line for Solo Desk (user prompt carries process and schema). */
export const SOLO_DESK_MODEL_SYSTEM_PROMPT =
  "You are one analyst writing a single desk report. Respond only with JSON as instructed.";

export const SOLO_DESK_USER_INSTRUCTIONS = `${SINGLE_VOICE_FRAMING}

You are one analyst producing one report. You cover Volatility, Flow, Catalyst, and Decision as separate topics in one JSON object. The metrics that define your work are Sharpe ratio, alpha, and maximum drawdown. You are not paid on trade count.

Every IV number you quote must be defensible. Every claim of institutional positioning must be supported by specific tape evidence. Every fundamental claim must be sourced and current. Math is checked before publication.

You are not providing liquidity to smarter money.

PROCESS

Work through four topics in sequence inside one response. Each topic matches the depth of a focused section.

VOLATILITY

Read the volatility surface: IV state, term structure, skew, IV vs realized. Identify both where the surface is rich relative to your fair value (short-vol fits: condors, credit spreads, calendars sold from the front, butterflies) and where the surface is cheap relative to your fair value (long-vol fits: long calendars from the back leg, long straddles into macro stacks, backspreads, long single-strike options when skew is flat). Skew interpretation must specifically address directional vol asymmetry — flat-to-bid call skew on a recent upside mover is cheap upside vol, not retail confirmation. Term-structure ATM IVs and 25Δ skew are pre-cleaned using bid-ask microstructure (including spread vs mid), hard IV ceilings, a liquidity floor, and local surface outlier checks; use **dataQualitySummary.ivClampedCount** / **ivCleanedRatio** and null entries in **termStructure5pt** or **skew25Delta** to see where the surface is incomplete.

FLOW

Read positioning: where real size is worked, where retail noise sits. Use aggressor mix, block size, sweep classification, and vol-over-OI ratios as evidence. When session tape is missing or limited, say so. Relate listed flow to **underlying cash session moves** when **price**, **dailyChangePct**, or **intraday** appear in the snapshot (see **EQUITY SESSION MOVES** after the JSON block).

CATALYST

Read the event landscape: primary catalyst, bar to clear in concrete numbers, which expiry captures the catalyst, directional asymmetry.

DECISION

Integrate the three topics and conclude trade or pass. Identify a clean structure with quantifiable edge when you trade.

DECISION RULES

If you want to pass, state concretely what dislocation or evidence would have made the setup tradable but is absent.

When you trade, structures are clean: math defensible, strikes reconciled with flow, breakevens robust to noise, exit plan tied to thesis invalidation.

Better to return a clean trade than a sloppy one. Better a strong pass than a weak trade.

OUTPUT FORMAT

Single JSON object with the same schema as multi-section desk mode.

Use the JSON snapshot fields below when present (same keys as multi-section desk analysts receive):
- **price**, **dailyChangePct**, **intraday** (Volume Weighted Average Price, Relative Strength Index, equity block tape, order book, **signal_snapshot**), and top-level equity enrichment fields when present: follow **EQUITY SESSION MOVES** after the snapshot so cash session context appears in the JSON strings, not only listed options flow.
- **dataQualitySummary**, including **data_source_gaps** when set, **flags**, **ivClampedCount** (deterministic IV removals: see **ivClampedReasons** for sentinel, ceiling, one-sided market, penny premium, invalid mid, spread vs mid, liquidity floor, surface outlier), **ivClampedReasons**, **ivCleanedRatio**, **bsmRecomputeStats** (vendor IV vs BSM-from-mid disagreement telemetry only), **termStructureExpiries** (how many curated expiries have a clean ATM IV vs total in the strip), **flow.tapeBackfillReason**, **flow.tapeBackfillReasonLegacy**, **flow.tapeBackfillStatus**, **flow.tapeBackfillTotalTradesFromPolygon**, **flow.tapeBackfillPersistRejected**, **flow.tapeBackfillTruncated**, **flow.tapeBackfillHttpError**, **sessionTapeKind**, and other degraded-state labels (never invent full tape when flags say otherwise). You should not need to manually strip clamped front-week IVs for term structure or skew — that is already done — but if **ivClampedCount** exceeds ~30% of listed contracts (**iv_contamination_elevated** in **flags**), say so and down-weight vol conclusions.
- **tapeBackfill** (REST tape coverage: status, **tapeBackfillReason**, occ counts, trades inserted, truncation and Polygon HTTP flags when present).
- **polygonFlowHighlights.sessionTape** (**tapeKind**, **tapeBackfillReason**, sweeps, blocks, aggressor totals, top prints).
- **catalyst.earnings_history** and **catalyst.forward_estimates** when the snapshot includes them, plus **nextEarnings** (EPS and revenue estimates vs prior quarter, period labels), **earningsDate**, **lastEarningsDate**, **daysSinceEarnings**.
- **macroEventsInPositionWindow** and **catalystEvaluation** when included in the snapshot.
- **userPreferences.deskCatalystPositionWindowExpirationISO** when present for catalyst window alignment.

vol: iv_state, term_structure, skew, implied_vs_realized, read.

flow: dominant_flow, institutional_signal, retail_signal, key_strikes, read.

catalyst: primary_catalyst, bar_to_clear, asymmetry, historical_pattern, read.

pm: decision, structure (legs, expiry, credit_or_debit), thesis, edge_check, deviation_from_analysts, size, whose_side, biggest_risk, exit_plan (profit_target, stop_loss, time_stop).`;

function stripVolPromptBeforeSnapshot(dataPackage: string): string {
  const full = buildVolAnalystPrompt(dataPackage);
  const marker = snapshotBlock(dataPackage);
  const i = full.indexOf(marker);
  return (i >= 0 ? full.slice(0, i) : full).trim();
}

function stripFlowPromptBeforeSnapshot(dataPackage: string): string {
  const full = buildFlowAnalystPrompt(dataPackage);
  const marker = snapshotBlock(dataPackage);
  const i = full.indexOf(marker);
  return (i >= 0 ? full.slice(0, i) : full).trim();
}

function stripCatalystPromptBeforeSnapshot(
  dataPackage: string,
  structuredResearchBriefing?: string,
  options?: { catalystSlotNativeWebSearch?: boolean },
): string {
  const full = buildCatalystAnalystPrompt(dataPackage, structuredResearchBriefing, options);
  const marker = snapshotBlock(dataPackage);
  const i = full.indexOf(marker);
  return (i >= 0 ? full.slice(0, i) : full).trim();
}

function stripPmPromptBeforeAnalystReads(dataPackage: string): string {
  const full = buildPmPrompt(dataPackage, "{}", "{}", "{}");
  const needle = "\n\nVolatility section:\n";
  const i = full.indexOf(needle);
  return (i >= 0 ? full.slice(0, i) : full).trim();
}

/**
 * Solo Desk: one user message with shared data package and the same per-topic instructions
 * as multi-turn desk (deduplicated: snapshot and style rules once at the end).
 */
export function buildSoloDeskUserPrompt(
  dataPackage: string,
  structuredResearchBriefing?: string,
  options?: { catalystSlotNativeWebSearch?: boolean },
): string {
  const nativeWeb = options?.catalystSlotNativeWebSearch
    ? `

## WEB SEARCH (your turn, native tools)
Your provider supports web search **on this JSON turn**. Use the built-in web search tool as needed before answering. Run focused searches aligned with: IR / company events, analyst actions (last ~60 days), earnings reaction history, sector ETF and peers, and (if the catalyst window warrants it) recent news. Prefer primary sources and major financial press; skip content farms.
If a theme has no support after searching, write **data not surfaced** for that slice instead of inventing. Do not paste URLs or name outlets or vendors in the output.
`
    : "";

  const researchBlock = structuredResearchBriefing
    ? `

## STRUCTURED RESEARCH (pre-run for you)
Focused web research was already run; facts below are for synthesis only (do not cite URLs or outlets).

${structuredResearchBriefing}
`
    : "";

  const volBlock = stripVolPromptBeforeSnapshot(dataPackage);
  const flowBlock = stripFlowPromptBeforeSnapshot(dataPackage);
  const catalystBlock = stripCatalystPromptBeforeSnapshot(
    dataPackage,
    structuredResearchBriefing,
    options,
  );
  const pmBlock = stripPmPromptBeforeAnalystReads(dataPackage);

  return `${SOLO_DESK_USER_INSTRUCTIONS}

## SECTION INSTRUCTIONS (same topics as multi-turn desk; one data package below)

### Volatility
${volBlock}

### Flow
${flowBlock}

### Catalyst
${catalystBlock}
${nativeWeb}${researchBlock}

### Decision
${pmBlock}

---

## DATA PACKAGE (single JSON snapshot)

${snapshotBlock(dataPackage)}${STRATEGIST_EQUITY_MOVES_OUTPUT_RULES}${OUTPUT_NO_SOURCE_RULES}${VOL_OUTPUT_ATTRIBUTION_RULES}${CATALYST_OUTPUT_ATTRIBUTION_RULES}

Respond with ONLY a JSON object (no markdown fences, no extra prose). Top-level keys: vol, flow, catalyst, pm. Shapes must match desk mode exactly.

{
  "vol": {
    "iv_state": "<string>",
    "term_structure": "<string>",
    "skew": "<string>",
    "implied_vs_realized": "<string>",
    "read": "<string>"
  },
  "flow": {
    "dominant_flow": "<string>",
    "institutional_signal": "<string>",
    "retail_signal": "<string>",
    "key_strikes": [
      {"strike": <number>, "expiry": "<YYYY-MM-DD>", "type": "<call|put>", "observation": "<string>"}
    ],
    "read": "<string>"
  },
  "catalyst": {
    "primary_catalyst": "<string>",
    "bar_to_clear": "<string>",
    "asymmetry": "<string>",
    "historical_pattern": "<string>",
    "read": "<string>"
  },
  "pm": {
    "decision": "trade" | "pass",
    "structure": null | {
      "type": "<strategy name: bull_call_spread, iron_condor, etc.>",
      "legs": [{"type": "call"|"put", "strike": <number>, "action": "buy"|"sell", "expiration": "<YYYY-MM-DD>", "quantity": <optional number>}],
      "expiry": "<YYYY-MM-DD>",
      "credit_or_debit": <number, positive=debit negative=credit>
    },
    "thesis": "<string>",
    "edge_check": "<string>",
    "deviation_from_analysts": "<string or the single word none>",
    "size": "small" | "medium" | "large",
    "whose_side": "institutional_alignment" | "retail_fade" | "neither",
    "biggest_risk": "<string>",
    "exit_plan": {
      "profit_target": <number>,
      "stop_loss": <number>,
      "time_stop": "<YYYY-MM-DD or empty string>"
    },
    "watch_for": "<string>"
  }
}`;
}

/**
 * Conviction Desk: identical section instructions and data package as Solo Desk, plus four synthesis fields.
 */
export type ConvictionDeskPromptProvider = "anthropic" | "google" | "openai" | "xai";

function convictionDeskProviderAppend(provider?: ConvictionDeskPromptProvider): string {
  if (!provider) return "";
  switch (provider) {
    case "google":
      return `

## YOUR PROVIDER (Google Gemini — JSON MIME turn)
Web search is **not** attached to this JSON call (Gemini constraint). Use the DATA PACKAGE and any STRUCTURED RESEARCH block. Your final JSON must use top-level keys vol, flow, catalyst, family_hypotheses, regime_synthesis, pm, risk_of_ruin, positioning_context, self_check only.`;
    case "openai":
      return `

## YOUR PROVIDER (OpenAI — Responses API + web search)
After tool calls complete, your **final** output must be **only** one JSON object with top-level keys vol, flow, catalyst, family_hypotheses, regime_synthesis, pm, risk_of_ruin, positioning_context, self_check. Do not emit the legacy memo-only Conviction shape.`;
    case "anthropic":
      return `

## YOUR PROVIDER (Anthropic — Messages + web search)
The **final** assistant message must be **only** that JSON object. No preamble, no prose before the opening brace.`;
    case "xai":
      return `

## YOUR PROVIDER (xAI — Grok + web search)
Return **only** one JSON object matching the Conviction Desk skeleton (Solo Desk sections plus family_hypotheses, regime_synthesis, pm, risk_of_ruin, positioning_context, self_check).`;
    default:
      return "";
  }
}

export function buildConvictionDeskUserPrompt(
  dataPackage: string,
  structuredResearchBriefing?: string,
  options?: { catalystSlotNativeWebSearch?: boolean; provider?: ConvictionDeskPromptProvider },
): string {
  const nativeWeb = options?.catalystSlotNativeWebSearch
    ? `

## WEB SEARCH (your turn, native tools)
Your provider supports web search **on this JSON turn**. Use the built-in web search tool as needed before answering. Run focused searches aligned with: IR / company events, analyst actions (last ~60 days), earnings reaction history, sector ETF and peers, and (if the catalyst window warrants it) recent news. Prefer primary sources and major financial press; skip content farms.
If a theme has no support after searching, write **data not surfaced** for that slice instead of inventing. Do not paste URLs or name outlets or vendors in the output.
`
    : "";

  const researchBlock = structuredResearchBriefing
    ? `

## STRUCTURED RESEARCH (pre-run for you)
Focused web research was already run; facts below are for synthesis only (do not cite URLs or outlets).

${structuredResearchBriefing}
`
    : "";

  const volBlock = stripVolPromptBeforeSnapshot(dataPackage);
  const flowBlock = stripFlowPromptBeforeSnapshot(dataPackage);
  const catalystBlock = stripCatalystPromptBeforeSnapshot(
    dataPackage,
    structuredResearchBriefing,
    options,
  );
  const pmBlock = stripPmPromptBeforeAnalystReads(dataPackage);

  return `${SOLO_DESK_USER_INSTRUCTIONS}
${CONVICTION_DESK_TAPE_AVAILABILITY_SCOPE}

## SECTION INSTRUCTIONS (same topics as multi-turn desk; one data package below)

### Volatility
${volBlock}

### Flow
${flowBlock}

### Catalyst
${catalystBlock}
${nativeWeb}${researchBlock}

### Decision
${pmBlock}
${CONVICTION_DESK_TAPE_FIELD_REMINDERS}
${CONVICTION_DESK_ADDITIONS_INSTRUCTIONS}

---

## DATA PACKAGE (single JSON snapshot)

${snapshotBlock(dataPackage)}${CONVICTION_DESK_INTRADAY_DATA_GUIDANCE}${STRATEGIST_EQUITY_MOVES_OUTPUT_RULES}${OUTPUT_NO_SOURCE_RULES}${VOL_OUTPUT_ATTRIBUTION_RULES}${CATALYST_OUTPUT_ATTRIBUTION_RULES}

Respond with ONLY one JSON object (no markdown fences, no extra prose). Top-level keys in this exact order: vol, flow, catalyst, family_hypotheses, regime_synthesis, pm, risk_of_ruin, positioning_context, self_check. Field order matters — family_hypotheses must be generated before regime_synthesis, which must be generated before pm. Shapes must match the skeleton below exactly.

${CONVICTION_DESK_FULL_JSON_SKELETON}
${CONVICTION_DESK_FINAL_SHAPE_GUARD}${convictionDeskProviderAppend(options?.provider)}`;
}
