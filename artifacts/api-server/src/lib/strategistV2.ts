import { logger } from "./logger.js";
import { getCachedRegime, buildFallbackRegime, type StructuredRegime } from "./regimePostProcessor.js";
import { computeIOScore, type IOScoreResult } from "./ioScoreEngine.js";
import { getSettings, type StrategistConfig } from "./strategistSettings.js";
import { db, strategistTelemetryTable } from "@workspace/db";
import { desc, eq, sql, and } from "drizzle-orm";
import { getBestAccessToken } from "./tokenStore.js";
import { fetchPolygonChain } from "./polygonChain.js";
import { checkEventConflicts, getUpcomingEvents } from "./calendarEventChecker.js";
import { computeIVR, type OptionContract } from "./optionsStrategist.js";
import { getAiLabStrategistConfig } from "./aiLabConfig.js";
import {
  callAnthropicWithSystemAndWebSearch,
  callGeminiWithSystemAndWebSearch,
  streamCallAnthropicWithSystemAndWebSearch,
  streamCallGeminiWithSystemAndWebSearch,
  extractJson,
  type WebSearchTrace,
} from "./aiLabAnalystClient.js";

const SCHWAB_API = "https://api.schwabapi.com/marketdata/v1";

export interface StrategistV2Result {
  status: "recommendation" | "no_viable_setup" | "toxic_block";
  ticker: string;
  recommendation?: {
    strategyLine: string;
    companyContext: string;
    thesis: string;
    rationale: string;
    edgeAttribution: string;
    idioStrengthPct: number;
    macroPct: number;
    strategyType: string;
    direction: string;
    legs: CandidateLeg[];
    credit?: number;
    debit?: number;
    entryRangeMin: number;
    entryRangeMax: number;
    maxProfit: number;
    maxLoss: number;
    breakeven: number;
    riskReward: number;
    dte: number;
    expiration: string;
    exitTargets: {
      profitTarget: number;
      profitTargetUnderlying: number;
      stopLoss: number;
      stopLossUnderlying: number;
      timeStop: string;
    };
    bullInvalidation: string;
    bearInvalidation: string;
    riskOfRuin: string;
    confidence: number;
    warnings: string | null;
    contextSources?: ContextSourcesPayload;
  };
  blockReason?: string;
  contextSources?: ContextSourcesPayload;
  regime: StructuredRegime;
  ioScore?: IOScoreResult;
  systemicRiskElevated: boolean;
  telemetryId?: number;
}

interface CandidateLeg {
  type: "call" | "put";
  side: "buy" | "sell";
  strike: number;
  expiration: string;
  bid: number;
  ask: number;
  mid: number;
  delta: number;
  openInterest: number;
}

interface TickerData {
  price: number;
  dailyChangePct: number;
  ivr: number | null;
  avgVolume20d: number;
  currentVolume: number;
  relativeVolume: number;
  sector: string;
  earningsWithin48h: boolean;
  earningsDaysAway: number | null;
  analystActions48h: string[];
  halted: boolean;
}

interface ChainContract {
  strike: number;
  expiration: string;
  type: string;
  optionType?: string;
  bid: number;
  ask: number;
  mid: number;
  delta: number;
  openInterest: number;
  volume: number;
  impliedVolatility: number;
  dte: number;
}

export interface ContextSourcesPayload {
  webSearchUsed: boolean;
  queryCount: number;
  queries: string[];
  sources: Array<{ title: string; url: string; date?: string }>;
  sameDayCatalyst: boolean;
  catalystSummary?: string;
  catalystAlignment?: "ALIGNED" | "CONTRADICTS" | "NEUTRAL" | "NONE";
}

interface AiTradeResponse {
  strategy: string;
  legs: Array<{
    type: "call" | "put";
    strike: number;
    action: "buy" | "sell";
    expiration: string;
  }>;
  entryPrice: number;
  entryRangeMin: number;
  entryRangeMax: number;
  maxRisk: number;
  maxProfit: number | string;
  breakeven: number[];
  companyContext: string;
  thesis: string;
  exitTargets: {
    profitTarget: number;
    profitTargetUnderlying: number;
    stopLoss: number;
    stopLossUnderlying: number;
    timeStop: string;
  };
  bullInvalidation: string;
  bearInvalidation: string;
  riskOfRuin: string;
  confidence: number;
  warnings: string | null;
  // Self-reported by the model after running its own web searches.
  // The server merges this with the actual tool-trace before returning.
  sameDayCatalyst?: boolean;
  catalystSummary?: string;
  catalystAlignment?: "ALIGNED" | "CONTRADICTS" | "NEUTRAL" | "NONE";
  citedHeadlines?: Array<{ title: string; url?: string; date?: string }>;
}

interface CuratedStrike {
  strike: number;
  call?: { bid: number; ask: number; iv: number; delta: number; volume: number; oi: number };
  put?: { bid: number; ask: number; iv: number; delta: number; volume: number; oi: number };
  unusualCall?: true;
  unusualPut?: true;
}

interface CuratedExpiration {
  expiration: string;
  dte: number;
  bucket: "near_0_7d" | "mid_7_30d" | "far_30_60d";
  strikes: CuratedStrike[];
}

interface ChainSummary {
  atmStrike: number;
  atmCallBid: number;
  atmCallAsk: number;
  atmCallIV: number;
  atmCallOI: number;
  atmPutBid: number;
  atmPutAsk: number;
  atmPutIV: number;
  atmPutOI: number;
  topVolumeCalls: Array<{ strike: number; expiration: string; volume: number; oi: number; bid: number; ask: number; iv: number; delta: number }>;
  topVolumePuts: Array<{ strike: number; expiration: string; volume: number; oi: number; bid: number; ask: number; iv: number; delta: number }>;
  unusualActivity: Array<{ strike: number; type: string; expiration: string; volume: number; oi: number; volOiRatio: number }>;
  putCallVolumeRatio: number;
  frontMonthIV: number | null;
  backMonthIV: number | null;
  availableExpirations: string[];
  curatedExpirations: CuratedExpiration[];
}

const STRATEGIST_SYSTEM_PROMPT = `## IDENTITY

You are a senior options trader on a discretionary prop desk at a firm like Jane Street or SIG. You came up as a volatility trader at a tier-one quant shop (think Citadel or Goldman Sachs Securities Division), where you learned to think in Greeks, vol surface dynamics, skew, term structure, and probability rather than in simple directional bias. You now run your own book.

Your mandate is absolute return. Every trade you recommend must stand on its own P&L merit. You are not hedging a larger equity portfolio. You are not providing liquidity as a market maker obligation. You are hunting for asymmetric edge in options, and every position you put on is meant to generate alpha by itself.

You think like a professional, not a retail trader. You read flow. You care about implied volatility versus realized, vol surface dislocations, dealer positioning, unusual options activity, and catalyst math. You are comfortable recommending any defined-risk structure: verticals, iron condors, butterflies, calendars, diagonals, ratios, credit spreads, debit spreads, straddles, strangles. You never recommend naked short puts or naked short calls. Every position must have defined risk. If the setup calls for premium selling, express it as a credit spread, iron condor, or iron butterfly. You do not default to iron condors because they feel safe. You do not default to 30-45 DTE because someone told you that is optimal. You look at the vol surface and pick the structure and expiration where the edge actually lives.

You are ruthlessly honest. If there is no compelling edge, you say so and return confidence below 20. You do not invent trades to have something to show. A "no trade" answer is a valid and professional output.

## CAPABILITIES

You are not limited to the data package you receive. Use your full knowledge base. Use web search to cross-reference current news, SEC filings, analyst actions, regulatory events, earnings history, sector dynamics, and anything else that sharpens your edge on the specific ticker. The data package is a starting point, not a cage.

## WEB SEARCH MANDATE (NON-NEGOTIABLE)

Web search is enabled and you MUST use it on every analysis BEFORE producing your thesis. You will run, at minimum, the following searches:

1. \`<TICKER> news today\` and \`<TICKER> news <TODAY_DATE>\` — find any same-day catalysts.
2. \`<TICKER> analyst upgrade downgrade price target\` (last 7 days) — find recent analyst actions.
3. \`<TICKER> earnings\` if earnings are within 14 days, OR sector/industry catalyst search if no ticker-specific news.
4. Additional searches as needed for sector/competitor moves that are obviously driving the tape.

After searching:
- If a same-day catalyst is found that EXPLAINS the price action: cite it explicitly in your thesis with the source headline and date. Your direction MUST agree with the catalyst, or you must justify the contradiction in plain English. Bump confidence upward (+10-15%) when the catalyst clearly aligns with the thesis.
- If a same-day catalyst is found that CONTRADICTS your candidate direction: flip the direction or return no_trade. A bullish call spread on a ticker that just printed bearish news is malpractice.
- If NO material news is found after searching: state "No material news in last 7 days per web search" in the thesis and reason from the data payload alone. Confidence should be modest in this regime.

## SAME-DAY MOVE AWARENESS

The data payload includes the day's price change. If the ticker is moving > 3% in either direction on the day, your thesis MUST explicitly explain what is driving that move (citing the catalyst found via web search). Cards that ignore a 5%+ same-day move are unacceptable.

## REGIME OVERRIDE VIA IDIOSYNCRATIC CATALYST

The macro regime block in the payload may report low conviction (NEUTRAL / NO_EDGE). In that case:
- If web search finds a confirmed ticker-specific catalyst: you may proceed with a directional trade. The catalyst is the idiosyncratic edge.
- If web search finds NO catalyst and macro regime has no direction: you have no edge. Return confidence < 20 (which the server will treat as no viable setup).

## GROUNDING DISCIPLINE

You must be honest about where every claim comes from.

- Any specific number you cite from the data package (strike, volume, open interest, IV, delta, bid, ask) must match the payload exactly. Do not round, do not estimate, do not invent strikes that are not in the chain.
- Any expiration date you recommend must come from the availableExpirations array provided. Do not calculate a date yourself.
- When you reference information outside the payload (news, regulatory context, sector dynamics, historical patterns), briefly cite the source. Examples: "per recent SEC filing," "per current news on the PDT rule change," "per general knowledge of semiconductor capex cycles."
- If a piece of information you want is not in the payload and you cannot verify it through search, say so. Do not fill gaps with plausible-sounding detail.

This is how institutional traders work. They cite their sources because their PnL depends on the information being real.

## EXPIRATION SELECTION

The data package includes a curatedExpirations array containing strike-level data (bid, ask, IV, delta, volume, OI) sampled across multiple DTE buckets from near-term through 60+ days. When selecting an expiration for your trade, evaluate the strikes available at each expiration in this array. Do not default to the nearest weekly just because the flow signal is loudest there. Consider whether the thesis is better expressed at a longer DTE with better theta economics, more time for the move to develop, or lower gamma risk. Choose the expiration that best fits the thesis, not the expiration with the most volume.

## WHAT YOU ARE NOT

You are not a retail options educator. You are not explaining basics.
You are not a PM hedging a $1B equity book. You are not sizing 500 contracts.
You are not a market maker. You are not quoting two-sided.
You are a prop trader hunting alpha in a concentrated, defined-risk book. Every trade makes money on its own or it does not get recommended.

## OUTPUT FORMAT

The user's configurable preferences are included in the data package for context. Respect them when possible but if you see a compelling trade outside their preferences, recommend it and explain why.

Your response must be valid JSON with these fields:
- strategy: string (e.g. "bull_call_spread", "bear_put_spread", "iron_condor", "iron_butterfly", "calendar_spread", "diagonal", "butterfly", "ratio_spread", "straddle", "strangle") — naked_put and naked_call are never valid
- legs: array of {type: "call" or "put", strike: number, action: "buy" or "sell", expiration: "YYYY-MM-DD"}
- entryPrice: number (net debit or credit, positive = debit, negative = credit)
- entryRangeMin: number (minimum fill price based on current bid/ask)
- entryRangeMax: number (maximum fill price based on current bid/ask)
- maxRisk: number (maximum dollar loss per contract)
- maxProfit: number (maximum dollar profit per contract, or 99999 for theoretically unlimited)
- breakeven: array of numbers (breakeven price points)
- companyContext: string (2 sentences: what the company does, what sector, what it is levered to)
- thesis: string (2-4 sentences on why this specific structure is the best expression of the edge right now, speaking in vol, flow, Greeks, catalyst, and probability terms; if selling close to the money explicitly justify why vol is rich enough to take that risk; if going wide on a spread explicitly justify the risk/reward)
- exitTargets: {profitTarget: number (PER-SHARE option contract price — what the option itself trades for, e.g. 3.30, NOT total dollar P&L on a lot), profitTargetUnderlying: number (underlying share price at that target), stopLoss: number (PER-SHARE option contract price at the stop, e.g. 0.85), stopLossUnderlying: number (underlying share price at that stop), timeStop: string (YYYY-MM-DD format, must be a FUTURE date — if DTE < 7, set timeStop to "" instead of computing expiration minus days)}
- bullInvalidation: string (specific event or price action that kills the long side of the thesis)
- bearInvalidation: string (specific event or price action that kills the short side of the thesis)
- riskOfRuin: string (the single biggest threat to this trade — the one thing that if it happened would cause maximum pain: macro event, vol crush, gap risk, earnings adjacency, liquidity trap, regulatory surprise; one sentence)
- confidence: number 0-100 (if no setup qualifies, return below 20 and do not force a trade)
- warnings: string or null (anything the user should know: earnings risk, low liquidity, gap risk, etc.)
- sameDayCatalyst: boolean (true if web search confirmed a material same-day or last-48h news event for this ticker)
- catalystSummary: string (one sentence summarizing the catalyst, or "No material news in last 7 days per web search")
- catalystAlignment: "ALIGNED" | "CONTRADICTS" | "NEUTRAL" | "NONE" (relationship of the catalyst to the recommended direction)
- citedHeadlines: array of {title: string, url?: string, date?: string} (key headlines you actually used in the thesis; empty array allowed if none)

NARRATIVE DISCIPLINE: Your job is structure and thesis. The code computes economics from real Schwab leg prices after you respond. When your thesis prose mentions a specific debit, credit, risk/reward ratio, max profit, max loss, or breakeven, cite only numbers that match the legs and prices you are picking — do not invent or approximate. If you are uncertain of a number, describe the shape of the trade qualitatively instead of quoting a dollar figure. Dollar amounts and ratios you cite must match the strikes and real leg prices you selected; mismatches get auto-corrected by the server and logged as a quality issue.

IMPORTANT: Respond with ONLY the JSON object. No markdown, no explanation text, no code fences. Just the raw JSON.`;

export interface AnalyzeProgressCallbacks {
  onStatus?: (status: string) => void;
  onToken?: (text: string) => void;
}

export async function analyzeTickerV2(
  ticker: string,
  progress?: AnalyzeProgressCallbacks,
): Promise<StrategistV2Result> {
  const status = (s: string) => progress?.onStatus?.(s);
  status("Loading regime + settings…");
  const settings = await getSettings();
  const regime = getCachedRegime() ?? buildFallbackRegime();

  const toxicCheck = checkToxicGate(regime, settings);
  if (toxicCheck.triggered) {
    const result: StrategistV2Result = {
      status: "toxic_block",
      ticker,
      blockReason: `Cash is a position. Toxic market conditions: ${toxicCheck.reasons.join("; ")}`,
      regime,
      systemicRiskElevated: regime.systemicRiskLevel === "ELEVATED" || regime.systemicRiskLevel === "EXTREME",
    };
    await logTelemetry(ticker, "toxic_block", regime, settings, null, null, toxicCheck, null, result.blockReason, {});
    return result;
  }

  const tickerFetch = await fetchTickerData(ticker);
  const tickerData = tickerFetch.data;
  if (!tickerData) {
    const result: StrategistV2Result = {
      status: "no_viable_setup",
      ticker,
      blockReason: `No viable options setup: unable to fetch ticker data (${tickerFetch.failureMode ?? "unknown"}).`,
      regime,
      systemicRiskElevated: regime.systemicRiskLevel === "ELEVATED" || regime.systemicRiskLevel === "EXTREME",
    };
    await logTelemetry(ticker, "no_data", regime, settings, null, null, toxicCheck, null, result.blockReason, {
      fetchFailureMode: tickerFetch.failureMode ?? "network_exception",
    });
    return result;
  }

  if (tickerData.halted) {
    return noViable(ticker, regime, settings, toxicCheck, tickerData, "No viable options setup: stock halted.", null);
  }

  const chainResult = await fetchOptionsChain(ticker, settings);
  const chain = chainResult.chain;
  const dataSource = chainResult.source;
  if (!chain || chain.length === 0) {
    return noViable(ticker, regime, settings, toxicCheck, tickerData, "No viable options setup: no options chain available.", null, { dataSource });
  }
  const pricedCount = chain.filter(c => c.bid > 0 || c.ask > 0).length;
  logger.info({ ticker, chainLength: chain.length, pricedCount, dataSource }, "StrategistV2: options chain loaded");
  if (pricedCount === 0) {
    return noViable(ticker, regime, settings, toxicCheck, tickerData,
      "No viable options setup: options chain loaded but all contracts have zero pricing. Options market may not be open yet (opens 9:30 AM ET).", null, { dataSource });
  }

  const liveIvr = computeIvrFromChain(chain, tickerData.price);
  tickerData.ivr = liveIvr;
  logger.info({ ticker, liveIvr }, "StrategistV2: live IVR computed from options chain");

  const catalystInfo = deriveCatalyst(tickerData);
  const ioScore = await computeIOScore(ticker, catalystInfo, settings);

  const chainSummary = summarizeOptionsChain(chain, tickerData.price);

  reconcileFlowScoreFromChain(ioScore, chainSummary, ticker);

  logger.info({
    ticker,
    availableExpirations: chainSummary.availableExpirations,
    expirationCount: chainSummary.availableExpirations.length,
    curatedExpirationCount: chainSummary.curatedExpirations.length,
    curatedExpirations: chainSummary.curatedExpirations.map(e => ({
      expiration: e.expiration,
      dte: e.dte,
      bucket: e.bucket,
      strikeCount: e.strikes.length,
    })),
  }, "StrategistV2: expirations being sent to AI model");

  const dataPackage = buildDataPackage(ticker, tickerData, chainSummary, ioScore, regime, settings);

  status("Calling AI for trade recommendation…");
  let aiResponse: AiTradeResponse;
  let webTrace: WebSearchTrace;
  let rawAiResponseText: string;
  try {
    const r = await callAiForTrade(dataPackage, undefined, progress);
    aiResponse = r.response;
    webTrace = r.trace;
    rawAiResponseText = r.rawText;
  } catch (err) {
    logger.error({ err, ticker }, "StrategistV2: AI trade call failed");
    return noViable(ticker, regime, settings, toxicCheck, tickerData, `AI analysis failed: ${err instanceof Error ? err.message : String(err)}`, ioScore, { dataSource, dataPackage });
  }

  // Guard against AI responses with missing/non-numeric confidence — previously
  // `aiResponse.confidence < 20` was silently false for `undefined`, allowing
  // confidence-less recommendations to ship. Coerce here once.
  if (!Number.isFinite(aiResponse.confidence)) {
    logger.warn({ ticker, raw: aiResponse.confidence }, "StrategistV2: AI returned non-numeric confidence — defaulting to 0");
    aiResponse.confidence = 0;
  }

  if (aiResponse.confidence < 20) {
    const blocked = await noViable(ticker, regime, settings, toxicCheck, tickerData, `AI found no compelling setup (confidence ${aiResponse.confidence}): ${aiResponse.thesis}`, ioScore, {
      dataSource, dataPackage, rawAiResponse: rawAiResponseText,
      confidenceBase: aiResponse.confidence, confidenceFinal: aiResponse.confidence,
      catalystAlignment: aiResponse.catalystAlignment ?? null,
    });
    blocked.contextSources = buildContextSources(aiResponse, webTrace);
    return blocked;
  }

  const validationResult = validateAiResponse(aiResponse, chain, settings);
  if (!validationResult.valid) {
    try {
      status("Retrying with corrections…");
      const retryPrompt = buildRetryPrompt(aiResponse, validationResult.issues);
      const r2 = await callAiForTrade(dataPackage, retryPrompt, progress);
      aiResponse = r2.response;
      rawAiResponseText = r2.rawText;
      if (!Number.isFinite(aiResponse.confidence)) {
        logger.warn({ ticker, raw: aiResponse.confidence }, "StrategistV2: AI retry returned non-numeric confidence — defaulting to 0");
        aiResponse.confidence = 0;
      }
      // Keep original trace; retry typically does not re-search.
      if (r2.trace.queries.length > 0) webTrace = r2.trace;

      const retryValidation = validateAiResponse(aiResponse, chain, settings);
      if (!retryValidation.valid) {
        return noViable(ticker, regime, settings, toxicCheck, tickerData,
          `AI recommendation failed validation after retry: ${retryValidation.issues.join("; ")}`, ioScore,
          { dataSource, dataPackage, rawAiResponse: rawAiResponseText, confidenceBase: aiResponse.confidence, confidenceFinal: aiResponse.confidence, catalystAlignment: aiResponse.catalystAlignment ?? null });
      }
    } catch (err) {
      logger.error({ err, ticker }, "StrategistV2: AI retry failed");
      return noViable(ticker, regime, settings, toxicCheck, tickerData,
        `AI retry failed: ${err instanceof Error ? err.message : String(err)}`, ioScore,
        { dataSource, dataPackage, rawAiResponse: rawAiResponseText });
    }
  }

  // Idiosyncratic catalyst override: if regime is NEUTRAL and the model
  // found NO same-day catalyst, the trade has neither macro nor idio edge.
  // Reject as no-viable-setup. (When EITHER macro has direction OR a catalyst
  // exists, we proceed.)
  const regimeIsNoEdge = regime.directionalConviction === "NEUTRAL" || regime.directionalConviction === "TRANSITION";
  if (regimeIsNoEdge && !aiResponse.sameDayCatalyst) {
    const ctx = buildContextSources(aiResponse, webTrace);
    const blocked = await noViable(
      ticker, regime, settings, toxicCheck, tickerData,
      `No edge: macro regime is ${regime.directionalConviction} and web search found no same-day ticker catalyst. ${aiResponse.catalystSummary ?? ""}`.trim(),
      ioScore,
      { dataSource, dataPackage, rawAiResponse: rawAiResponseText, confidenceBase: aiResponse.confidence, confidenceFinal: aiResponse.confidence, catalystAlignment: aiResponse.catalystAlignment ?? null },
    );
    blocked.contextSources = ctx;
    return blocked;
  }

  // Capture confidence breakdown for telemetry. The base value comes straight
  // from the AI; the catalyst gate may bump (+12) or dampen (-25). Persist all
  // three so calibration can later be tuned against historical outcomes.
  const confidenceBaseValue = aiResponse.confidence;
  let confidenceCatalystDeltaValue = 0;

  // Catalyst-aware confidence calibration. The model is instructed to do
  // this itself, but we enforce a floor/ceiling here as a safety net.
  if (aiResponse.sameDayCatalyst && aiResponse.catalystAlignment === "ALIGNED") {
    const bumped = Math.min(100, aiResponse.confidence + 12);
    if (bumped > aiResponse.confidence) {
      confidenceCatalystDeltaValue = bumped - aiResponse.confidence;
      logger.info({ ticker, before: aiResponse.confidence, after: bumped }, "StrategistV2: catalyst-aligned confidence bump applied");
      aiResponse.confidence = bumped;
    }
  } else if (aiResponse.sameDayCatalyst && aiResponse.catalystAlignment === "CONTRADICTS") {
    const damped = Math.max(0, aiResponse.confidence - 25);
    confidenceCatalystDeltaValue = damped - aiResponse.confidence;
    logger.warn({ ticker, before: aiResponse.confidence, after: damped }, "StrategistV2: catalyst CONTRADICTS thesis — damping confidence");
    aiResponse.confidence = damped;
    if (damped < 20) {
      const ctx = buildContextSources(aiResponse, webTrace);
      const blocked = await noViable(
        ticker, regime, settings, toxicCheck, tickerData,
        `Catalyst contradicts proposed direction: ${aiResponse.catalystSummary ?? "see web search results"}`,
        ioScore,
        { dataSource, dataPackage, rawAiResponse: rawAiResponseText, confidenceBase: confidenceBaseValue, confidenceCatalystDelta: confidenceCatalystDeltaValue, confidenceFinal: aiResponse.confidence, catalystAlignment: aiResponse.catalystAlignment ?? null },
      );
      blocked.contextSources = ctx;
      return blocked;
    }
  }
  const confidenceFinalValue = aiResponse.confidence;

  const legs = mapAiLegsToCandidate(aiResponse, chain);
  const economics = computeSpreadEconomics(legs, aiResponse, ticker);

  // Structural sanity check: compare AI's self-reported maxRisk against
  // the leg-derived maxLoss. For single-expiration structures the leg-derived
  // value is canonical (computeSpreadEconomics overwrites the AI value), so a
  // large discrepancy signals either AI mispricing or a structure the engine
  // mis-models (e.g. a ratio that slipped past validation). Multi-expiration
  // structures legitimately diverge because calendar/diagonal economics depend
  // on volatility, so we skip the check for them.
  const expirationsForLegs = new Set(legs.map(l => l.expiration));
  const isMultiExpirationCheck = expirationsForLegs.size > 1;
  const aiSelfReportedMaxRisk = aiResponse.maxRisk;
  const computedMaxLossCheck = economics.maxLoss;
  if (
    !isMultiExpirationCheck &&
    aiSelfReportedMaxRisk > 0 &&
    computedMaxLossCheck > 0
  ) {
    const denom = Math.max(aiSelfReportedMaxRisk, computedMaxLossCheck);
    const discrepancy = Math.abs(aiSelfReportedMaxRisk - computedMaxLossCheck) / denom;
    if (discrepancy > 0.5) {
      logger.warn({
        ticker,
        strategy: aiResponse.strategy,
        aiMaxRisk: aiSelfReportedMaxRisk,
        computedMaxLoss: computedMaxLossCheck,
        discrepancy: Math.round(discrepancy * 100),
      }, "StrategistV2: economics validation failed — AI maxRisk vs computed maxLoss differ by >50%");
      const ctx = buildContextSources(aiResponse, webTrace);
      const blocked = await noViable(
        ticker, regime, settings, toxicCheck, tickerData,
        `Economics validation failed: AI self-reported maxRisk $${aiSelfReportedMaxRisk.toFixed(2)} vs leg-derived maxLoss $${computedMaxLossCheck.toFixed(2)} (discrepancy ${Math.round(discrepancy * 100)}%, threshold 50%). The proposed structure cannot be priced reliably with current models.`,
        ioScore,
      );
      blocked.contextSources = ctx;
      return blocked;
    }
  }

  const isCredit = economics.isCredit;
  const entryAbs = economics.entryAbs;
  const entryRangeMin = economics.entryRangeMin;
  const entryRangeMax = economics.entryRangeMax;
  const maxProfit = economics.maxProfit;
  const maxLoss = economics.maxLoss;
  const breakeven = aiResponse.breakeven.length > 0 ? aiResponse.breakeven[0] : tickerData.price;

  // Bug 2: scrub narrative so cited numbers match computed economics
  const reconciledThesis = reconcileNarrativeEconomics(
    aiResponse.thesis ?? "",
    { entryAbs, isCredit, maxProfit, maxLoss, breakeven },
    ticker,
  );
  aiResponse.thesis = reconciledThesis;

  // Bug 3: normalize exit targets so profitTarget/stopLoss are always per-share option price
  const normalizedExitTargets = normalizeExitTargets(
    aiResponse.exitTargets,
    entryAbs,
    maxProfit,
    maxLoss,
    ticker,
  );

  const firstLeg = aiResponse.legs[0];
  const expiration = firstLeg?.expiration ?? "";
  const expDate = new Date(expiration);
  const dte = Math.max(0, Math.round((expDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));

  const direction = inferDirection(aiResponse.strategy, aiResponse.legs);
  const idioStrengthPct = Math.round(ioScore.final * 100);
  const macroPct = 100 - idioStrengthPct;

  const strategyLine = buildStrategyLine(ticker, aiResponse);

  const result: StrategistV2Result = {
    status: "recommendation",
    ticker,
    recommendation: {
      strategyLine,
      companyContext: aiResponse.companyContext || "",
      thesis: aiResponse.thesis,
      rationale: aiResponse.thesis,
      edgeAttribution: `Edge source: Idiosyncratic ${idioStrengthPct}% / Macro ${macroPct}%`,
      idioStrengthPct,
      macroPct,
      strategyType: aiResponse.strategy,
      direction,
      legs,
      credit: isCredit ? entryAbs : undefined,
      debit: !isCredit ? entryAbs : undefined,
      entryRangeMin,
      entryRangeMax,
      maxProfit,
      maxLoss,
      breakeven,
      riskReward: maxLoss > 0 ? maxProfit / maxLoss : 0,
      dte,
      expiration,
      exitTargets: normalizedExitTargets,
      bullInvalidation: aiResponse.bullInvalidation || "",
      bearInvalidation: aiResponse.bearInvalidation || "",
      riskOfRuin: aiResponse.riskOfRuin || "",
      confidence: aiResponse.confidence,
      warnings: aiResponse.warnings,
      contextSources: buildContextSources(aiResponse, webTrace),
    },
    contextSources: buildContextSources(aiResponse, webTrace),
    regime,
    ioScore,
    systemicRiskElevated: regime.systemicRiskLevel === "ELEVATED" || regime.systemicRiskLevel === "EXTREME",
  };

  const telemetryId = await logTelemetry(
    ticker, "recommendation", regime, settings, ioScore, tickerData, toxicCheck,
    {
      strategy: aiResponse.strategy,
      strategyType: aiResponse.strategy,
      confidence: Number.isFinite(aiResponse.confidence) ? aiResponse.confidence : 0,
      aiRationale: aiResponse.thesis,
      warnings: aiResponse.warnings,
      legs: aiResponse.legs,
      entryPrice: aiResponse.entryPrice,
      maxRisk: aiResponse.maxRisk,
      maxProfit: aiResponse.maxProfit,
      breakeven: aiResponse.breakeven,
      catalystAlignment: aiResponse.catalystAlignment ?? null,
      sameDayCatalyst: aiResponse.sameDayCatalyst ?? false,
    },
    result.recommendation?.strategyLine,
    {
      dataPackage,
      rawAiResponse: rawAiResponseText,
      confidenceBase: confidenceBaseValue,
      confidenceCatalystDelta: confidenceCatalystDeltaValue,
      confidenceFinal: confidenceFinalValue,
      catalystAlignment: aiResponse.catalystAlignment ?? null,
      dataSource,
    },
  );
  result.telemetryId = telemetryId ?? undefined;

  return result;
}

function computeDte(expiration: string): number {
  const expMs = new Date(expiration + "T16:00:00-05:00").getTime();
  return Math.max(0, Math.round((expMs - Date.now()) / (24 * 60 * 60 * 1000)));
}

function buildCuratedStrikes(
  chain: ChainContract[],
  expiration: string,
  atmStrike: number,
): CuratedStrike[] {
  const expContracts = chain.filter(c => c.expiration === expiration);
  const expCalls = expContracts.filter(c => c.type === "call" || c.optionType === "CALL");
  const expPuts = expContracts.filter(c => c.type === "put" || c.optionType === "PUT");

  // Collect all strikes to include: ATM±5 + top-5 volume each side + unusual activity
  const includeStrikes = new Set<number>();

  // Sort all strikes for this expiration to find ATM±5 index positions
  const allStrikes = [...new Set([...expCalls, ...expPuts].map(c => c.strike))].sort((a, b) => a - b);
  const atmIdx = allStrikes.reduce((best, s, i) =>
    Math.abs(s - atmStrike) < Math.abs(allStrikes[best] - atmStrike) ? i : best, 0);
  const lo = Math.max(0, atmIdx - 5);
  const hi = Math.min(allStrikes.length - 1, atmIdx + 5);
  for (let i = lo; i <= hi; i++) includeStrikes.add(allStrikes[i]);

  // Top-5 volume calls/puts
  [...expCalls].sort((a, b) => b.volume - a.volume).slice(0, 5).forEach(c => includeStrikes.add(c.strike));
  [...expPuts].sort((a, b) => b.volume - a.volume).slice(0, 5).forEach(c => includeStrikes.add(c.strike));

  // Unusual activity (vol/OI >= 2)
  for (const c of expContracts) {
    if (c.openInterest > 0 && c.volume / c.openInterest >= 2) includeStrikes.add(c.strike);
  }

  // Build merged strike-level objects
  const callByStrike = new Map(expCalls.map(c => [c.strike, c]));
  const putByStrike = new Map(expPuts.map(c => [c.strike, c]));

  const result: CuratedStrike[] = [];
  for (const strike of [...includeStrikes].sort((a, b) => a - b)) {
    const c = callByStrike.get(strike);
    const p = putByStrike.get(strike);
    const entry: CuratedStrike = { strike };
    if (c) {
      entry.call = { bid: c.bid, ask: c.ask, iv: Math.round(c.impliedVolatility * 10000) / 100, delta: Math.round((c.delta ?? 0) * 1000) / 1000, volume: c.volume, oi: c.openInterest };
      if (c.openInterest > 0 && c.volume / c.openInterest >= 2) entry.unusualCall = true;
    }
    if (p) {
      entry.put = { bid: p.bid, ask: p.ask, iv: Math.round(p.impliedVolatility * 10000) / 100, delta: Math.round((p.delta ?? 0) * 1000) / 1000, volume: p.volume, oi: p.openInterest };
      if (p.openInterest > 0 && p.volume / p.openInterest >= 2) entry.unusualPut = true;
    }
    if (entry.call || entry.put) result.push(entry);
  }
  return result;
}

function buildCuratedExpirations(chain: ChainContract[], price: number): CuratedExpiration[] {
  const allExpirations = [...new Set(chain.map(c => c.expiration))].sort();
  const withDte = allExpirations.map(exp => ({ exp, dte: computeDte(exp) }));

  // Detect daily-expiry ticker: >2 expirations within the first 7 DTE
  const near7 = withDte.filter(e => e.dte <= 7);
  const isDaily = near7.length > 2;

  // Bucket selection
  const selected: Array<{ exp: string; dte: number; bucket: CuratedExpiration["bucket"] }> = [];

  // --- 0-7 DTE bucket ---
  const near = withDte.filter(e => e.dte <= 7).sort((a, b) => a.dte - b.dte);
  const nearCap = isDaily ? 2 : 1;
  near.slice(0, nearCap).forEach(e => selected.push({ ...e, bucket: "near_0_7d" }));

  // --- 7-30 DTE bucket ---
  const mid = withDte.filter(e => e.dte > 7 && e.dte <= 30).sort((a, b) => a.dte - b.dte);
  const midCap = isDaily ? 4 : mid.length;
  mid.slice(0, midCap).forEach(e => selected.push({ ...e, bucket: "mid_7_30d" }));

  // --- 30-60 DTE bucket ---
  // For daily-expiry tickers with dense weekly/daily expirations, prefer monthlies in this range
  // Detect monthlies: for each calendar month, pick the expiration with highest total OI (proxy for standard monthly)
  const far = withDte.filter(e => e.dte > 30 && e.dte <= 60).sort((a, b) => a.dte - b.dte);
  let farSelected = far;
  if (isDaily && far.length > 3) {
    // Group by year-month, pick highest-OI expiration per month
    const byMonth = new Map<string, typeof far[0][]>();
    for (const e of far) {
      const ym = e.exp.slice(0, 7);
      if (!byMonth.has(ym)) byMonth.set(ym, []);
      byMonth.get(ym)!.push(e);
    }
    farSelected = [];
    for (const [, group] of byMonth) {
      // Pick the one with highest total OI in this expiration
      const best = group.reduce((b, e) => {
        const oi = chain.filter(c => c.expiration === e.exp).reduce((s, c) => s + c.openInterest, 0);
        const bOi = chain.filter(c => c.expiration === b.exp).reduce((s, c) => s + c.openInterest, 0);
        return oi > bOi ? e : b;
      });
      farSelected.push(best);
    }
    farSelected.sort((a, b) => a.dte - b.dte);
  }
  farSelected.slice(0, 3).forEach(e => selected.push({ ...e, bucket: "far_30_60d" }));

  // Determine ATM strike once
  const atmStrike = [...new Set(chain.map(c => c.strike))]
    .sort((a, b) => Math.abs(a - price) - Math.abs(b - price))[0] ?? Math.round(price);

  return selected.map(s => ({
    expiration: s.exp,
    dte: s.dte,
    bucket: s.bucket,
    strikes: buildCuratedStrikes(chain, s.exp, atmStrike),
  }));
}

function summarizeOptionsChain(chain: ChainContract[], price: number): ChainSummary {
  const calls = chain.filter(c => c.type === "call" || c.optionType === "CALL");
  const puts = chain.filter(c => c.type === "put" || c.optionType === "PUT");

  const atmCalls = calls.filter(c => Math.abs(c.strike - price) / price < 0.02).sort((a, b) => Math.abs(a.strike - price) - Math.abs(b.strike - price));
  const atmPuts = puts.filter(c => Math.abs(c.strike - price) / price < 0.02).sort((a, b) => Math.abs(a.strike - price) - Math.abs(b.strike - price));
  const atmCall = atmCalls[0];
  const atmPut = atmPuts[0];
  const atmStrike = atmCall?.strike ?? atmPut?.strike ?? Math.round(price);

  // FIX 3: Normalize all IVs in the AI payload to percentage (e.g. 41.25)
  // so the model never sees mixed units. Schwab/Polygon report IV as a decimal
  // (0.4125); we multiply by 100 and round to 2 decimals to match buildCuratedStrikes
  // and frontMonthIV/backMonthIV (which already emit percentages).
  const ivToPct = (iv: number | null | undefined): number => {
    const n = typeof iv === "number" && Number.isFinite(iv) ? iv : 0;
    return Math.round(n * 10000) / 100;
  };

  const topVolumeCalls = [...calls].sort((a, b) => b.volume - a.volume).slice(0, 5).map(c => ({
    strike: c.strike, expiration: c.expiration, volume: c.volume, oi: c.openInterest,
    bid: c.bid, ask: c.ask, iv: ivToPct(c.impliedVolatility), delta: c.delta,
  }));
  const topVolumePuts = [...puts].sort((a, b) => b.volume - a.volume).slice(0, 5).map(c => ({
    strike: c.strike, expiration: c.expiration, volume: c.volume, oi: c.openInterest,
    bid: c.bid, ask: c.ask, iv: ivToPct(c.impliedVolatility), delta: c.delta,
  }));

  const unusualActivity: ChainSummary["unusualActivity"] = [];
  for (const c of chain) {
    if (c.openInterest > 0 && c.volume / c.openInterest >= 2) {
      unusualActivity.push({
        strike: c.strike, type: c.type || (c.optionType === "CALL" ? "call" : "put"),
        expiration: c.expiration, volume: c.volume, oi: c.openInterest, volOiRatio: Math.round(c.volume / c.openInterest * 100) / 100,
      });
    }
  }
  unusualActivity.sort((a, b) => b.volOiRatio - a.volOiRatio);
  if (unusualActivity.length > 10) unusualActivity.length = 10;

  const totalCallVol = calls.reduce((s, c) => s + c.volume, 0);
  const totalPutVol = puts.reduce((s, c) => s + c.volume, 0);
  const putCallVolumeRatio = totalCallVol > 0 ? Math.round(totalPutVol / totalCallVol * 100) / 100 : 0;

  const expirations = [...new Set(chain.map(c => c.expiration))].sort();
  let frontMonthIV: number | null = null;
  let backMonthIV: number | null = null;
  if (expirations.length >= 2) {
    const frontContracts = chain.filter(c => c.expiration === expirations[0] && c.impliedVolatility > 0);
    const backContracts = chain.filter(c => c.expiration === expirations[expirations.length - 1] && c.impliedVolatility > 0);
    if (frontContracts.length > 0) frontMonthIV = Math.round(frontContracts.reduce((s, c) => s + c.impliedVolatility, 0) / frontContracts.length * 10000) / 100;
    if (backContracts.length > 0) backMonthIV = Math.round(backContracts.reduce((s, c) => s + c.impliedVolatility, 0) / backContracts.length * 10000) / 100;
  }

  const curatedExpirations = buildCuratedExpirations(chain, price);

  return {
    atmStrike,
    atmCallBid: atmCall?.bid ?? 0,
    atmCallAsk: atmCall?.ask ?? 0,
    atmCallIV: ivToPct(atmCall?.impliedVolatility),
    atmCallOI: atmCall?.openInterest ?? 0,
    atmPutBid: atmPut?.bid ?? 0,
    atmPutAsk: atmPut?.ask ?? 0,
    atmPutIV: ivToPct(atmPut?.impliedVolatility),
    atmPutOI: atmPut?.openInterest ?? 0,
    topVolumeCalls,
    topVolumePuts,
    unusualActivity,
    putCallVolumeRatio,
    frontMonthIV,
    backMonthIV,
    availableExpirations: expirations,
    curatedExpirations,
  };
}

function buildDataPackage(
  ticker: string,
  tickerData: TickerData,
  chainSummary: ChainSummary,
  ioScore: IOScoreResult,
  regime: StructuredRegime,
  settings: StrategistConfig,
): string {
  const pkg: Record<string, unknown> = {
    ticker,
    currentDate: new Date().toISOString().slice(0, 10),
    price: tickerData.price,
    dailyChangePct: tickerData.dailyChangePct,
    ivr: tickerData.ivr,
    avgVolume20d: tickerData.avgVolume20d,
    relativeVolume: tickerData.relativeVolume,
    sector: tickerData.sector,
    earningsDaysAway: tickerData.earningsDaysAway,
    earningsWithin48h: tickerData.earningsWithin48h,
    analystActions48h: tickerData.analystActions48h,
    optionsChainSummary: {
      atmStrike: chainSummary.atmStrike,
      atmCall: { bid: chainSummary.atmCallBid, ask: chainSummary.atmCallAsk, iv: chainSummary.atmCallIV, oi: chainSummary.atmCallOI },
      atmPut: { bid: chainSummary.atmPutBid, ask: chainSummary.atmPutAsk, iv: chainSummary.atmPutIV, oi: chainSummary.atmPutOI },
      topVolumeCalls: chainSummary.topVolumeCalls,
      topVolumePuts: chainSummary.topVolumePuts,
      unusualActivity: chainSummary.unusualActivity.length > 0 ? chainSummary.unusualActivity : "none",
      putCallVolumeRatio: chainSummary.putCallVolumeRatio,
      termStructure: chainSummary.frontMonthIV != null && chainSummary.backMonthIV != null
        ? { frontMonthIV: chainSummary.frontMonthIV, backMonthIV: chainSummary.backMonthIV }
        : "insufficient data",
    },
    curatedExpirations: chainSummary.curatedExpirations,
    availableExpirations: chainSummary.availableExpirations,
    ioScore: {
      final: ioScore.final,
      classification: ioScore.classification,
      beta: ioScore.beta,
      residualReturnZScore: ioScore.residualReturnZScore,
      components: {
        marketIndependence: ioScore.components.marketIndependence.contribution,
        abnormalMove: ioScore.components.abnormalMove.contribution,
        catalyst: { value: ioScore.components.catalyst.flagValue, reason: ioScore.components.catalyst.reason },
        flowDivergence: { volOiRatio: ioScore.components.flowDivergence.volOiRatio, skewDivergence: ioScore.components.flowDivergence.skewDivergence },
      },
    },
    regime: {
      directionalConviction: regime.directionalConviction,
      systemicRiskLevel: regime.systemicRiskLevel,
      correlationRegime: regime.correlationRegime,
    },
    userPreferences: {
      preferredDteMin: settings.preferredDteMin,
      preferredDteMax: settings.preferredDteMax,
      spreadWidth: settings.spreadWidth,
      minOpenInterest: settings.minOpenInterest,
      maxBidAskSpreadPct: settings.maxBidAskSpreadPct,
    },
  };

  return JSON.stringify(pkg);
}

async function callAiForTrade(
  dataPackage: string,
  retryInstruction?: string,
  progress?: AnalyzeProgressCallbacks,
): Promise<{ response: AiTradeResponse; trace: WebSearchTrace; rawText: string }> {
  const aiCfg = getAiLabStrategistConfig();
  const provider = aiCfg.analystModelProvider;
  const model = aiCfg.analystModelName;
  const temperature = aiCfg.analystTemperature;

  logger.info({ provider, model, temperature, webSearch: true }, "StrategistV2: calling AI for trade");

  const today = new Date().toISOString().slice(0, 10);
  const prompt = retryInstruction
    ? `${retryInstruction}\n\nOriginal data package:\n${dataPackage}`
    : `Today is ${today}. Run web searches as required by the WEB SEARCH MANDATE in your system prompt, then analyze this ticker and recommend the best trade. Respond ONLY with a valid JSON object, no text before or after, no markdown fences.\n\n${dataPackage}`;

  let rawText: string;
  let trace: WebSearchTrace;
  const onDelta = (txt: string) => progress?.onToken?.(txt);
  const onStatus = (s: string) => progress?.onStatus?.(s);
  switch (provider) {
    case "anthropic": {
      const r = progress
        ? await streamCallAnthropicWithSystemAndWebSearch(model, temperature, STRATEGIST_SYSTEM_PROMPT, prompt, onDelta, onStatus)
        : await callAnthropicWithSystemAndWebSearch(model, temperature, STRATEGIST_SYSTEM_PROMPT, prompt);
      rawText = r.text;
      trace = r.trace;
      break;
    }
    case "google": {
      const r = progress
        ? await streamCallGeminiWithSystemAndWebSearch(model, temperature, STRATEGIST_SYSTEM_PROMPT, prompt, onDelta, onStatus)
        : await callGeminiWithSystemAndWebSearch(model, temperature, STRATEGIST_SYSTEM_PROMPT, prompt);
      rawText = r.text;
      trace = r.trace;
      break;
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }

  logger.info({
    webSearchUsed: trace.webSearchUsed,
    queryCount: trace.queries.length,
    queries: trace.queries,
    sourceCount: trace.sources.length,
    topSources: trace.sources.slice(0, 5).map(s => ({ title: s.title.slice(0, 80), url: s.url })),
  }, "StrategistV2: web search trace");

  logger.info({ rawSnippet: rawText.slice(0, 300) }, "StrategistV2: raw AI response snippet");

  let cleanText = extractJson(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanText);
  } catch {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
        logger.info("StrategistV2: recovered JSON from raw text via brace extraction");
      } catch {
        logger.error({ rawSnippet: rawText.slice(0, 500) }, "StrategistV2: AI response JSON parse failure");
        throw new Error("AI response is not valid JSON");
      }
    } else {
      logger.error({ rawSnippet: rawText.slice(0, 500) }, "StrategistV2: AI response JSON parse failure");
      throw new Error("AI response is not valid JSON");
    }
  }

  const resp = parsed as Record<string, unknown>;

  if (!Array.isArray(resp.legs) || resp.legs.length === 0 || !resp.strategy || String(resp.strategy).toLowerCase() === "no_trade") {
    const thesis = String(resp.thesis ?? resp.rationale ?? resp.reasoning ?? "AI found no viable options setup");
    const confidence = Math.max(0, Math.min(100, Number(resp.confidence) || 0));
    logger.info({ parsedKeys: Object.keys(resp), confidence, thesis: thesis.slice(0, 200) }, "StrategistV2: AI returned no-trade / empty legs");
    const noTradeResponse: AiTradeResponse = {
      strategy: "no_trade",
      legs: [],
      entryPrice: 0,
      entryRangeMin: 0,
      entryRangeMax: 0,
      maxRisk: 0,
      maxProfit: 0,
      breakeven: [],
      companyContext: String(resp.companyContext ?? ""),
      thesis,
      exitTargets: { profitTarget: 0, profitTargetUnderlying: 0, stopLoss: 0, stopLossUnderlying: 0, timeStop: "" },
      bullInvalidation: "",
      bearInvalidation: "",
      riskOfRuin: "",
      confidence,
      warnings: resp.warnings ? String(resp.warnings) : null,
      sameDayCatalyst: typeof resp.sameDayCatalyst === "boolean" ? resp.sameDayCatalyst : false,
      catalystSummary: resp.catalystSummary ? String(resp.catalystSummary) : undefined,
      catalystAlignment: typeof resp.catalystAlignment === "string"
        ? (String(resp.catalystAlignment).toUpperCase() as AiTradeResponse["catalystAlignment"])
        : "NONE",
      citedHeadlines: Array.isArray(resp.citedHeadlines)
        ? (resp.citedHeadlines as Array<Record<string, unknown>>).map(h => ({
            title: String(h.title ?? ""),
            url: h.url ? String(h.url) : undefined,
            date: h.date ? String(h.date) : undefined,
          })).filter(h => h.title)
        : [],
    };
    return { response: noTradeResponse, trace, rawText };
  }

  const safeNum = (v: unknown, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const validTypes = new Set(["call", "put"]);
  const validActions = new Set(["buy", "sell"]);

  const legs = (resp.legs as Array<Record<string, unknown>>).map(l => {
    const type = String(l.type).toLowerCase();
    const action = String(l.action).toLowerCase();
    if (!validTypes.has(type)) throw new Error(`Invalid leg type: ${type}. Must be "call" or "put".`);
    if (!validActions.has(action)) throw new Error(`Invalid leg action: ${action}. Must be "buy" or "sell".`);
    const strike = safeNum(l.strike, 0);
    if (strike <= 0) throw new Error(`Invalid strike price: ${l.strike}`);
    const expiration = String(l.expiration);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiration)) throw new Error(`Invalid expiration format: ${expiration}. Must be YYYY-MM-DD.`);
    return { type: type as "call" | "put", strike, action: action as "buy" | "sell", expiration };
  });

  const confidence = Math.max(0, Math.min(100, safeNum(resp.confidence, 0)));

  const exitRaw = resp.exitTargets as Record<string, unknown> | undefined;
  let timeStopStr = String(exitRaw?.timeStop ?? "");
  if (timeStopStr && /^\d{4}-\d{2}-\d{2}/.test(timeStopStr)) {
    const tsDate = new Date(timeStopStr);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    if (tsDate.getTime() <= now.getTime()) {
      logger.warn({ timeStop: timeStopStr, today: now.toISOString().slice(0, 10) }, "StrategistV2: AI returned timeStop in the past — omitting");
      timeStopStr = "";
    }
  }
  const exitTargets = {
    profitTarget: safeNum(exitRaw?.profitTarget, 0),
    profitTargetUnderlying: safeNum(exitRaw?.profitTargetUnderlying, 0),
    stopLoss: safeNum(exitRaw?.stopLoss, 0),
    stopLossUnderlying: safeNum(exitRaw?.stopLossUnderlying, 0),
    timeStop: timeStopStr,
  };

  const fullResponse: AiTradeResponse = {
    strategy: String(resp.strategy),
    legs,
    entryPrice: safeNum(resp.entryPrice, 0),
    entryRangeMin: safeNum(resp.entryRangeMin, safeNum(resp.entryPrice, 0)),
    entryRangeMax: safeNum(resp.entryRangeMax, safeNum(resp.entryPrice, 0)),
    maxRisk: safeNum(resp.maxRisk, 0),
    maxProfit: resp.maxProfit === "unlimited" || resp.maxProfit === "Unlimited" ? 99999 : safeNum(resp.maxProfit, 0),
    breakeven: Array.isArray(resp.breakeven) ? (resp.breakeven as unknown[]).map(v => safeNum(v, 0)).filter(n => n > 0) : [],
    companyContext: String(resp.companyContext ?? ""),
    thesis: String(resp.thesis ?? resp.rationale ?? ""),
    exitTargets,
    bullInvalidation: String(resp.bullInvalidation ?? ""),
    bearInvalidation: String(resp.bearInvalidation ?? ""),
    riskOfRuin: String(resp.riskOfRuin ?? ""),
    confidence,
    warnings: resp.warnings ? String(resp.warnings) : null,
    sameDayCatalyst: typeof resp.sameDayCatalyst === "boolean" ? resp.sameDayCatalyst : false,
    catalystSummary: resp.catalystSummary ? String(resp.catalystSummary) : undefined,
    catalystAlignment: typeof resp.catalystAlignment === "string"
      ? (String(resp.catalystAlignment).toUpperCase() as AiTradeResponse["catalystAlignment"])
      : "NONE",
    citedHeadlines: Array.isArray(resp.citedHeadlines)
      ? (resp.citedHeadlines as Array<Record<string, unknown>>).map(h => ({
          title: String(h.title ?? ""),
          url: h.url ? String(h.url) : undefined,
          date: h.date ? String(h.date) : undefined,
        })).filter(h => h.title)
      : [],
  };
  return { response: fullResponse, trace, rawText };
}

function validateAiResponse(
  response: AiTradeResponse,
  chain: ChainContract[],
  settings: StrategistConfig,
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const minOI = settings.minOpenInterest;
  const maxSpreadPct = settings.maxBidAskSpreadPct / 100;

  // Hard reject naked short positions — undefined risk is not permitted
  if (response.strategy === "naked_put" || response.strategy === "naked_call") {
    issues.push(`Strategy "${response.strategy}" is not permitted. All positions must have defined maximum risk. Use a credit spread, iron condor, or iron butterfly instead.`);
    return { valid: false, issues };
  }
  // Detect a single-leg sell with no offsetting buy (naked short disguised as another label)
  if (response.legs.length === 1 && response.legs[0].action === "sell") {
    issues.push(`Single-leg short position is not permitted. Add a long leg to define the maximum risk.`);
    return { valid: false, issues };
  }

  // Hard whitelist of allowed strategy types. Structures with quantity-asymmetric
  // or strike-asymmetric risk profiles (ratios, broken-wing butterflies, naked
  // wings, straddles/strangles) are excluded until computeSpreadEconomics models
  // them correctly. See investigation report Q3-Q5.
  const allowedStrategies = new Set([
    "bull_call_spread",
    "bear_put_spread",
    "bull_put_spread",
    "bear_call_spread",
    "iron_condor",
    "iron_butterfly",
    "calendar_spread",
    "diagonal_spread",
    "vertical",
    "call_debit_spread",
    "put_debit_spread",
    "calendar",
    "diagonal",
  ]);
  if (!allowedStrategies.has(response.strategy)) {
    issues.push(`Strategy "${response.strategy}" is not permitted. Allowed structures: bull_call_spread, bear_put_spread, bull_put_spread, bear_call_spread, iron_condor, iron_butterfly, calendar_spread, diagonal_spread, vertical. Reformulate the trade using one of these defined-risk structures.`);
    return { valid: false, issues };
  }

  // Quantity-balance check: every leg's implicit contract count must net to zero
  // per option type (calls vs puts) within the same expiration. Catches ratio
  // structures that slip past the strategy-name whitelist by being labeled as
  // "vertical" but having asymmetric quantities.
  const legSig = (l: typeof response.legs[number]) => `${l.expiration}|${l.type}`;
  const balance = new Map<string, number>();
  for (const leg of response.legs) {
    const key = legSig(leg);
    const sign = leg.action === "buy" ? 1 : -1;
    const qty = (leg as any).quantity ?? 1;
    balance.set(key, (balance.get(key) ?? 0) + sign * qty);
  }
  for (const [key, net] of balance) {
    if (Math.abs(net) > 1) {
      issues.push(`Leg quantity imbalance detected for ${key}: net ${net} contracts. Ratio/asymmetric structures are not permitted; long and short quantities per option type per expiration must match.`);
      return { valid: false, issues };
    }
  }

  for (const leg of response.legs) {
    const matchingContracts = chain.filter(c => {
      const typeMatch = c.type === leg.type || c.optionType === leg.type.toUpperCase();
      const strikeMatch = Math.abs(c.strike - leg.strike) < 0.5;
      const expMatch = c.expiration === leg.expiration;
      return typeMatch && strikeMatch && expMatch;
    });

    if (matchingContracts.length === 0) {
      issues.push(`The ${leg.strike} ${leg.type} ${leg.expiration} does not exist in the options chain. Choose an available strike.`);
      continue;
    }

    const contract = matchingContracts[0];
    if (contract.openInterest < minOI) {
      issues.push(`The ${leg.strike} ${leg.type} has only ${contract.openInterest} open interest (minimum ${minOI}). Suggest an alternative with more liquidity.`);
    }

    const mid = contract.mid > 0 ? contract.mid : (contract.bid + contract.ask) / 2;
    if (mid > 0) {
      const spreadPct = (contract.ask - contract.bid) / mid;
      if (spreadPct > maxSpreadPct) {
        issues.push(`The ${leg.strike} ${leg.type} has a ${(spreadPct * 100).toFixed(0)}% bid-ask spread (max ${settings.maxBidAskSpreadPct}%). Suggest an alternative with tighter spreads.`);
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

function buildRetryPrompt(originalResponse: AiTradeResponse, issues: string[]): string {
  return `Your previous recommendation had validation issues:\n${issues.map((i, idx) => `${idx + 1}. ${i}`).join("\n")}\n\nPlease revise your recommendation. Keep the same general thesis if it's still valid, but fix the specific contract selections. Return the same JSON format.`;
}

function mapAiLegsToCandidate(response: AiTradeResponse, chain: ChainContract[]): CandidateLeg[] {
  return response.legs.map(leg => {
    const contract = chain.find(c => {
      const typeMatch = c.type === leg.type || c.optionType === leg.type.toUpperCase();
      const strikeMatch = Math.abs(c.strike - leg.strike) < 0.5;
      const expMatch = c.expiration === leg.expiration;
      return typeMatch && strikeMatch && expMatch;
    });

    return {
      type: leg.type,
      side: leg.action === "buy" ? "buy" as const : "sell" as const,
      strike: leg.strike,
      expiration: leg.expiration,
      bid: contract?.bid ?? 0,
      ask: contract?.ask ?? 0,
      mid: contract?.mid ?? ((contract?.bid ?? 0) + (contract?.ask ?? 0)) / 2,
      delta: contract?.delta ?? 0,
      openInterest: contract?.openInterest ?? 0,
    };
  });
}

interface SpreadEconomics {
  isCredit: boolean;
  entryAbs: number;
  entryRangeMin: number;
  entryRangeMax: number;
  maxProfit: number;
  maxLoss: number;
}

function computeSpreadEconomics(
  legs: CandidateLeg[],
  aiResponse: AiTradeResponse,
  ticker: string,
): SpreadEconomics {
  const aiEntry = aiResponse.entryPrice;
  const aiMaxProfit = typeof aiResponse.maxProfit === "number" ? aiResponse.maxProfit : 99999;
  const aiMaxLoss = aiResponse.maxRisk;

  // Determine if any leg has missing pricing — if so, fall back to AI numbers
  const allLegsPriced = legs.length > 0 && legs.every(l => l.bid > 0 || l.ask > 0);
  if (!allLegsPriced) {
    return {
      isCredit: aiEntry < 0,
      entryAbs: Math.abs(aiEntry),
      entryRangeMin: aiResponse.entryRangeMin ?? Math.abs(aiEntry),
      entryRangeMax: aiResponse.entryRangeMax ?? Math.abs(aiEntry),
      maxProfit: aiMaxProfit,
      maxLoss: aiMaxLoss,
    };
  }

  // Net cost from real prices: positive = debit (we pay), negative = credit (we receive)
  // For each leg: buy adds mid (cost), sell subtracts mid (premium received)
  let netMid = 0;
  let netBid = 0; // worst-case fill if buying / best-case if selling
  let netAsk = 0; // best-case fill if buying / worst-case if selling
  for (const leg of legs) {
    const sign = leg.side === "buy" ? 1 : -1;
    netMid += sign * leg.mid;
    // For range: buying side, low = bid (rare fill) and high = ask (typical fill)
    // We compute spread net at min and max plausible fills
    netBid += sign * (leg.side === "buy" ? leg.bid : leg.ask);
    netAsk += sign * (leg.side === "buy" ? leg.ask : leg.bid);
  }

  const isCredit = netMid < 0;
  const entryAbs = Math.round(Math.abs(netMid) * 100) / 100;
  const rangeLo = Math.round(Math.min(Math.abs(netBid), Math.abs(netAsk)) * 100) / 100;
  const rangeHi = Math.round(Math.max(Math.abs(netBid), Math.abs(netAsk)) * 100) / 100;

  // Detect calendar/diagonal: legs span more than one expiration
  const expirations = new Set(legs.map(l => l.expiration));
  const isMultiExpiration = expirations.size > 1;

  let maxProfit = aiMaxProfit;
  let maxLoss = aiMaxLoss;

  if (isMultiExpiration) {
    // Calendar/diagonal: max loss = net debit paid (per share, x100 for contract)
    // Net dollar loss per contract = entryAbs * 100
    // Max profit on calendar is theoretical (depends on IV/underlying), keep AI estimate
    const computedMaxLoss = isCredit ? aiMaxLoss : entryAbs * 100;
    if (Math.abs(computedMaxLoss - aiMaxLoss) / Math.max(aiMaxLoss, 1) > 0.20) {
      logger.warn({
        ticker,
        strategy: aiResponse.strategy,
        aiEntry, computedNet: netMid, aiMaxLoss, computedMaxLoss,
        legs: legs.map(l => ({ side: l.side, type: l.type, strike: l.strike, exp: l.expiration, mid: l.mid })),
      }, "StrategistV2: AI calendar/diagonal economics differ from leg-derived; overriding with leg-derived");
    }
    maxLoss = computedMaxLoss;
  } else if (legs.length >= 2) {
    // Vertical spread on same expiration
    const strikes = legs.map(l => l.strike).sort((a, b) => a - b);
    const width = (strikes[strikes.length - 1] - strikes[0]) * 100;
    if (isCredit) {
      // Credit spread: max profit = credit collected, max loss = width - credit
      const computedMaxProfit = entryAbs * 100;
      const computedMaxLoss = Math.max(0, width - computedMaxProfit);
      maxProfit = computedMaxProfit;
      maxLoss = computedMaxLoss;
    } else {
      // Debit spread: max loss = debit paid, max profit = width - debit
      const computedMaxLoss = entryAbs * 100;
      const computedMaxProfit = Math.max(0, width - computedMaxLoss);
      maxProfit = computedMaxProfit;
      maxLoss = computedMaxLoss;
    }
  } else if (legs.length === 1) {
    // Single leg long: max loss = debit paid
    const leg = legs[0];
    if (leg.side === "buy") {
      maxLoss = entryAbs * 100;
      // Long calls/puts unbounded profit — keep AI value
    }
    // Single leg short (naked) — keep AI numbers, margin-bound
  }

  if (Math.abs(Math.abs(aiEntry) - entryAbs) > 0.10) {
    logger.warn({
      ticker,
      strategy: aiResponse.strategy,
      aiEntry,
      computedEntry: netMid,
      diff: Math.abs(Math.abs(aiEntry) - entryAbs),
    }, "StrategistV2: AI entryPrice differs from leg-derived net by >$0.10; using leg-derived");
  }

  return {
    isCredit,
    entryAbs,
    entryRangeMin: rangeLo,
    entryRangeMax: rangeHi,
    maxProfit,
    maxLoss,
  };
}

function inferDirection(strategy: string, legs: AiTradeResponse["legs"]): string {
  const s = strategy.toLowerCase();
  if (s.includes("bull") || s.includes("long_call") || s.includes("call_debit")) return "BULLISH";
  if (s.includes("bear") || s.includes("long_put") || s.includes("put_debit")) return "BEARISH";
  if (s === "naked_put") return "BULLISH";
  if (s === "naked_call") return "BEARISH";
  if (s.includes("condor") || s.includes("butterfly") || s.includes("straddle") || s.includes("strangle")) return "NON_DIRECTIONAL";
  if (s.includes("calendar") || s.includes("diagonal")) return "NON_DIRECTIONAL";
  if (s.includes("ratio")) {
    const sells = legs.filter(l => l.action === "sell");
    if (sells.length > 0) return sells[0].type === "call" ? "BEARISH" : "BULLISH";
  }
  const buys = legs.filter(l => l.action === "buy");
  const sells = legs.filter(l => l.action === "sell");
  if (legs.length === 1) {
    const leg = legs[0];
    if (leg.action === "buy") return leg.type === "call" ? "BULLISH" : "BEARISH";
    if (leg.action === "sell") return leg.type === "put" ? "BULLISH" : "BEARISH";
  }
  if (buys.length === 1 && sells.length === 0) {
    return buys[0].type === "call" ? "BULLISH" : "BEARISH";
  }
  if (sells.length === 1 && buys.length === 0) {
    return sells[0].type === "put" ? "BULLISH" : "BEARISH";
  }
  if (buys.length === 1) {
    return buys[0].type === "call" ? "BULLISH" : "BEARISH";
  }
  return "NON_DIRECTIONAL";
}

function buildStrategyLine(ticker: string, response: AiTradeResponse): string {
  const name = response.strategy.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const legDescs = response.legs.map(
    l => `${l.action === "sell" ? "Sell" : "Buy"} ${l.expiration} $${l.strike} ${l.type}`
  );
  const priceStr = response.entryPrice < 0
    ? `for $${Math.abs(response.entryPrice).toFixed(2)} credit`
    : `for $${response.entryPrice.toFixed(2)} debit`;
  return `${name} on ${ticker}: ${legDescs.join(", ")} ${priceStr}.`;
}

function checkToxicGate(
  regime: StructuredRegime,
  settings: StrategistConfig
): { triggered: boolean; reasons: string[]; pathACheck: { extremeRisk: boolean; highCorrelation: boolean }; pathBCheck: { elevatedRisk: boolean; eventWithin24h: boolean; eventName: string | null } } {
  const pathACheck = {
    extremeRisk: regime.systemicRiskLevel === "EXTREME",
    highCorrelation: regime.correlationRegime === "HIGH",
  };
  const pathBCheck = {
    elevatedRisk: regime.systemicRiskLevel === "ELEVATED" || regime.systemicRiskLevel === "EXTREME",
    eventWithin24h: false,
    eventName: null as string | null,
  };

  if (!settings.toxicGateEnabled) return { triggered: false, reasons: [], pathACheck, pathBCheck };

  const reasons: string[] = [];

  if (settings.toxicPathAEnabled && pathACheck.extremeRisk && pathACheck.highCorrelation) {
    reasons.push("EXTREME systemic risk + HIGH correlation (flash crash / liquidity drain conditions)");
  }

  if (settings.toxicPathBEnabled && pathBCheck.elevatedRisk) {
    const upcoming = getUpcomingEvents(2);
    const now = Date.now();
    const horizon24h = now + 24 * 60 * 60 * 1000;
    const majorEvent = upcoming.find((e) => {
      if (e.type !== "fomc" && !(e.type === "economic" && e.title.includes("CPI"))) return false;
      if (e.type === "fomc" && e.title.toLowerCase().includes("minutes")) return false;
      const evTs = new Date(e.date + "T" + (e.time || "14:00") + ":00-04:00").getTime();
      return evTs >= now && evTs <= horizon24h;
    });
    if (majorEvent) {
      pathBCheck.eventWithin24h = true;
      pathBCheck.eventName = majorEvent.title;
      reasons.push(`${majorEvent.title} within 24h + ${regime.systemicRiskLevel} systemic risk`);
    }
  }

  return { triggered: reasons.length > 0, reasons, pathACheck, pathBCheck };
}

function deriveCatalyst(tickerData: TickerData): { flagValue: number; reason: string } {
  if (tickerData.earningsWithin48h) return { flagValue: 1.0, reason: "earnings_within_48h" };
  if (tickerData.analystActions48h.length >= 2) return { flagValue: 0.5, reason: "analyst_cluster" };
  if (tickerData.analystActions48h.length === 1) return { flagValue: 0.3, reason: "analyst_action" };
  return { flagValue: 0, reason: "none" };
}

type FetchFailureMode = "token_null" | "http_fail" | "symbol_missing" | "network_exception";

async function fetchTickerData(ticker: string): Promise<{ data: TickerData | null; failureMode: FetchFailureMode | null }> {
  try {
    const token = await getBestAccessToken();
    if (!token) {
      logger.warn({ ticker }, "StrategistV2: fetchTickerData failed — no Schwab token available");
      return { data: null, failureMode: "token_null" };
    }

    const res = await fetch(`${SCHWAB_API}/quotes?symbols=${ticker}&fields=quote,fundamental`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      logger.warn({ ticker, status: res.status }, "StrategistV2: fetchTickerData failed — Schwab quotes HTTP non-OK");
      return { data: null, failureMode: "http_fail" };
    }

    const data = await res.json() as any;
    const q = data[ticker]?.quote ?? data[ticker.toUpperCase()]?.quote;
    const f = data[ticker]?.fundamental ?? data[ticker.toUpperCase()]?.fundamental ?? {};
    if (!q) {
      logger.warn({ ticker, returnedKeys: Object.keys(data ?? {}) }, "StrategistV2: fetchTickerData failed — symbol missing from response");
      return { data: null, failureMode: "symbol_missing" };
    }

    const price = q.lastPrice ?? q.mark ?? 0;
    const avgVol = f.avg10DaysVolume ?? f.avgVol10Days ?? 1;
    const currentVol = q.totalVolume ?? 0;

    const eventResult = checkEventConflicts(ticker, 45, "iron_condor");
    const earningsEvents = getUpcomingEvents(10).filter((e) => e.type === "earnings" && e.title.toLowerCase().includes(ticker.toLowerCase()));
    let earningsDaysAway: number | null = null;
    if (earningsEvents.length > 0) {
      const evDate = new Date(earningsEvents[0].date + "T16:00:00-04:00");
      earningsDaysAway = Math.max(0, Math.round((evDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
    }
    const earningsWithin48h = earningsDaysAway != null && earningsDaysAway <= 2;

    return {
      data: {
        price,
        dailyChangePct: q.netPercentChangeInDouble ?? 0,
        ivr: null,
        avgVolume20d: avgVol,
        currentVolume: currentVol,
        relativeVolume: avgVol > 0 ? currentVol / avgVol : 1,
        sector: f.sector ?? "Unknown",
        earningsWithin48h,
        earningsDaysAway,
        analystActions48h: [],
        halted: q.securityStatus === "Halted" || q.securityStatus === "HALTED",
      },
      failureMode: null,
    };
  } catch (err) {
    logger.error({ err, ticker }, "StrategistV2: failed to fetch ticker data");
    return { data: null, failureMode: "network_exception" };
  }
}

const STRATEGIST_LARGE_CHAIN_SYMBOLS = new Set(["SPY", "QQQ", "AAPL", "TSLA", "AMZN", "NVDA", "META", "MSFT", "GOOG", "GOOGL"]);

async function fetchSchwabChainSide(
  ticker: string,
  contractType: "ALL" | "CALL" | "PUT",
  token: string,
): Promise<{ callMap: Record<string, any>; putMap: Record<string, any>; underlyingPrice?: number } | null> {
  const params = new URLSearchParams({
    symbol: ticker,
    contractType,
    range: "ALL",
  });
  const url = `${SCHWAB_API}/chains?${params.toString()}`;
  let res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(25_000),
  });
  if (res.status === 429 || res.status === 502 || res.status === 503) {
    await new Promise(r => setTimeout(r, 1000));
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(25_000),
    });
  }
  if (!res.ok) {
    logger.warn({ ticker, contractType, status: res.status }, "StrategistV2: Schwab chain fetch failed");
    return null;
  }
  const data = await res.json() as any;
  return {
    callMap: data.callExpDateMap ?? {},
    putMap: data.putExpDateMap ?? {},
    underlyingPrice: data.underlyingPrice,
  };
}

async function fetchSchwabFullChain(ticker: string): Promise<ChainContract[] | null> {
  const token = await getBestAccessToken();
  if (!token) {
    logger.warn({ ticker }, "StrategistV2: no Schwab token available, skipping Schwab full chain");
    return null;
  }

  try {
    const useSplit = STRATEGIST_LARGE_CHAIN_SYMBOLS.has(ticker.toUpperCase());
    let callMap: Record<string, any> = {};
    let putMap: Record<string, any> = {};

    if (useSplit) {
      const [callRes, putRes] = await Promise.all([
        fetchSchwabChainSide(ticker, "CALL", token),
        fetchSchwabChainSide(ticker, "PUT", token),
      ]);
      if (!callRes && !putRes) return null;
      callMap = callRes?.callMap ?? {};
      putMap = putRes?.putMap ?? {};
    } else {
      const result = await fetchSchwabChainSide(ticker, "ALL", token);
      if (!result) return null;
      callMap = result.callMap;
      putMap = result.putMap;
    }

    const contracts = flattenSchwabMaps(callMap, putMap);
    if (contracts.length === 0) {
      logger.warn({ ticker }, "StrategistV2: Schwab full chain returned 0 contracts");
      return null;
    }
    const pricedCount = contracts.filter(c => c.bid > 0 || c.ask > 0).length;
    logger.info({ ticker, total: contracts.length, priced: pricedCount, source: "schwab-full" }, "StrategistV2: Schwab full chain loaded");
    return contracts;
  } catch (err) {
    logger.warn({ err, ticker }, "StrategistV2: Schwab full chain threw");
    return null;
  }
}

type ChainSource = "schwab" | "polygon-fallback" | "schwab-unpriced" | "none";

async function fetchOptionsChain(ticker: string, settings: StrategistConfig): Promise<{ chain: ChainContract[]; source: ChainSource }> {
  // Step A: Schwab full chain primary (so quoted prices match what user fills at)
  const schwabChain = await fetchSchwabFullChain(ticker);
  if (schwabChain && schwabChain.length > 0) {
    const priced = schwabChain.filter(c => c.bid > 0 || c.ask > 0);
    if (priced.length > 0) return { chain: priced, source: "schwab" };
    logger.warn({ ticker, total: schwabChain.length }, "StrategistV2: Schwab chain has contracts but all unpriced — trying Polygon fallback");
  }

  // Polygon fallback when Schwab is unavailable/empty/unpriced
  try {
    const apiKey = process.env.POLYGON_API_KEY || "";
    if (!apiKey) {
      logger.warn({ ticker }, "StrategistV2: no Polygon key for fallback");
      return { chain: schwabChain ?? [], source: schwabChain && schwabChain.length > 0 ? "schwab-unpriced" : "none" };
    }
    const chain = await fetchPolygonChain(ticker, apiKey, { maxDte: 365 });
    if (!chain || (chain.calls.length === 0 && chain.puts.length === 0)) {
      logger.warn({ ticker }, "StrategistV2: Polygon fallback also empty");
      return { chain: schwabChain ?? [], source: schwabChain && schwabChain.length > 0 ? "schwab-unpriced" : "none" };
    }
    const taggedCalls = (chain.calls || []).map((c: any) => ({ ...c, type: "call", optionType: "CALL", mid: c.mid ?? ((c.bid ?? 0) + (c.ask ?? 0)) / 2 }));
    const taggedPuts = (chain.puts || []).map((c: any) => ({ ...c, type: "put", optionType: "PUT", mid: c.mid ?? ((c.bid ?? 0) + (c.ask ?? 0)) / 2 }));
    const allContracts = [...taggedCalls, ...taggedPuts] as ChainContract[];
    const pricedContracts = allContracts.filter(c => c.bid > 0 || c.ask > 0);
    logger.info({ ticker, total: allContracts.length, priced: pricedContracts.length, source: "polygon-fallback" }, "StrategistV2: Polygon fallback chain loaded");
    return { chain: pricedContracts.length > 0 ? pricedContracts : allContracts, source: "polygon-fallback" };
  } catch (err) {
    logger.error({ err, ticker }, "StrategistV2: Polygon fallback failed");
    return { chain: schwabChain ?? [], source: schwabChain && schwabChain.length > 0 ? "schwab-unpriced" : "none" };
  }
}

function flattenSchwabMaps(callMap: Record<string, any>, putMap: Record<string, any>): ChainContract[] {
  const result: ChainContract[] = [];
  const sides: Array<["call" | "put", Record<string, any>]> = [["call", callMap], ["put", putMap]];
  for (const [side, map] of sides) {
    const optType = side === "call" ? "CALL" : "PUT";
    for (const [expKey, strikes] of Object.entries(map)) {
      const expDate = expKey.split(":")[0];
      for (const [strikeKey, arr] of Object.entries(strikes as Record<string, any[]>)) {
        for (const opt of arr) {
          const bid = opt.bid ?? 0;
          const ask = opt.ask ?? 0;
          result.push({
            strike: parseFloat(strikeKey),
            expiration: expDate,
            optionType: optType,
            type: side,
            bid,
            ask,
            mid: (bid + ask) / 2,
            delta: opt.delta ?? 0,
            openInterest: opt.openInterest ?? 0,
            volume: opt.totalVolume ?? 0,
            impliedVolatility: opt.volatility ?? 0,
            dte: opt.daysToExpiration ?? 0,
          });
        }
      }
    }
  }
  return result;
}

function computeIvrFromChain(chain: ChainContract[], underlyingPrice: number): number {
  const contracts: OptionContract[] = chain.map((c) => ({
    strike: c.strike,
    expiration: c.expiration,
    bid: c.bid,
    ask: c.ask,
    volume: c.volume,
    openInterest: c.openInterest,
    iv: c.impliedVolatility ?? 0,
    delta: c.delta,
    dte: c.dte,
  }));

  const exps = [...new Set(contracts.map(c => c.expiration))]
    .filter(e => e && new Date(e).getTime() > Date.now())
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  return computeIVR(contracts, underlyingPrice, exps);
}

function _legacyFlattenSchwabChain_unused(data: any): ChainContract[] {
  const result: ChainContract[] = [];
  for (const side of ["callExpDateMap", "putExpDateMap"]) {
    const map = data[side];
    if (!map) continue;
    const optType = side.includes("call") ? "CALL" : "PUT";
    for (const [expKey, strikes] of Object.entries(map as Record<string, any>)) {
      for (const [strikeKey, arr] of Object.entries(strikes as Record<string, any[]>)) {
        for (const opt of arr) {
          const dte = opt.daysToExpiration ?? 0;
          result.push({
            strike: parseFloat(strikeKey),
            expiration: expKey.split(":")[0],
            optionType: optType,
            type: optType.toLowerCase(),
            bid: opt.bid ?? 0,
            ask: opt.ask ?? 0,
            mid: (opt.bid + opt.ask) / 2,
            delta: opt.delta ?? 0,
            openInterest: opt.openInterest ?? 0,
            volume: opt.totalVolume ?? 0,
            impliedVolatility: opt.volatility ?? 0,
            dte,
          });
        }
      }
    }
  }
  return result;
}

interface TelemetryExtras {
  dataPackage?: unknown;
  rawAiResponse?: string | null;
  confidenceBase?: number | null;
  confidenceCatalystDelta?: number | null;
  confidenceFinal?: number | null;
  catalystAlignment?: string | null;
  dataSource?: ChainSource | null;
  fetchFailureMode?: FetchFailureMode | string | null;
}

async function noViable(
  ticker: string,
  regime: StructuredRegime,
  settings: StrategistConfig,
  toxicCheck: any,
  tickerData: TickerData | null,
  reason: string,
  ioScore?: IOScoreResult | null,
  extras: TelemetryExtras = {},
): Promise<StrategistV2Result> {
  await logTelemetry(ticker, "no_viable_setup", regime, settings, ioScore ?? null, tickerData, toxicCheck, null, reason, extras);
  return {
    status: "no_viable_setup",
    ticker,
    blockReason: reason,
    regime,
    ioScore: ioScore ?? undefined,
    systemicRiskElevated: regime.systemicRiskLevel === "ELEVATED" || regime.systemicRiskLevel === "EXTREME",
  };
}

async function logTelemetry(
  ticker: string, result: string, regime: StructuredRegime, settings: StrategistConfig,
  ioScore: IOScoreResult | null, tickerData: TickerData | null,
  toxicCheck: any, aiDecision: any, thesis?: string | null,
  extras: TelemetryExtras = {},
): Promise<number | null> {
  try {
    const [row] = await db.insert(strategistTelemetryTable).values({
      ticker,
      result,
      regime: regime as any,
      tickerData: tickerData as any,
      idioScore: ioScore as any,
      toxicGate: {
        triggered: toxicCheck.triggered,
        reasons: toxicCheck.reasons,
        path_a_check: toxicCheck.pathACheck,
        path_b_check: toxicCheck.pathBCheck,
      } as any,
      viability: null,
      earningsGate: null,
      strategyDecision: aiDecision as any,
      candidatesGenerated: null,
      candidatesFiltered: null,
      filterReasons: null,
      winningCandidate: null,
      edgeAttribution: ioScore ? { idiosyncratic_pct: Math.round(ioScore.final * 100), macro_pct: 100 - Math.round(ioScore.final * 100) } as any : null,
      recommendationThesis: thesis ?? null,
      dataPackage: (extras.dataPackage ?? null) as any,
      rawAiResponse: extras.rawAiResponse ?? null,
      confidenceBase: extras.confidenceBase ?? null,
      confidenceCatalystDelta: extras.confidenceCatalystDelta ?? null,
      confidenceFinal: extras.confidenceFinal ?? null,
      catalystAlignment: extras.catalystAlignment ?? null,
      dataSource: extras.dataSource ?? null,
      fetchFailureMode: extras.fetchFailureMode ?? null,
    }).returning({ id: strategistTelemetryTable.id });
    return row?.id ?? null;
  } catch (err) {
    logger.error({ err }, "StrategistV2: telemetry logging failed");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Post-AI reconciliation helpers (Bugs 1, 2, 3)
// ---------------------------------------------------------------------------

function reconcileFlowScoreFromChain(
  ioScore: IOScoreResult,
  chainSummary: ChainSummary,
  ticker: string,
): void {
  const existing = ioScore.components.flowDivergence.volOiRatio;

  // Best vol/OI signal the AI actually sees: highest volOiRatio in unusualActivity,
  // fallback to computed ratio across topVolumeCalls/Puts.
  let chainVoiRatio = 0;
  if (chainSummary.unusualActivity.length > 0) {
    chainVoiRatio = Math.max(...chainSummary.unusualActivity.map((u) => u.volOiRatio));
  } else {
    const combined = [...chainSummary.topVolumeCalls, ...chainSummary.topVolumePuts];
    const ratios = combined
      .filter((c) => c.oi > 0)
      .map((c) => c.volume / c.oi);
    if (ratios.length > 0) chainVoiRatio = Math.max(...ratios);
  }
  chainVoiRatio = Math.round(chainVoiRatio * 100) / 100;

  if (chainVoiRatio <= 0) return; // chain has nothing to offer either

  // Pipeline health check: narrative-source shows significant flow but aggregates say 0
  if (existing === 0 && chainVoiRatio >= 2) {
    logger.warn(
      { ticker, aggregatesVoiRatio: existing, chainVoiRatio, source: "chainSummary.unusualActivity" },
      "StrategistV2: flowDailyAggregates empty for ticker but chain shows flow — patching ioScore.flowDivergence from live chain",
    );
  }

  // Patch whenever chain shows a stronger signal than stale/missing aggregates.
  // NOTE: this is a display-only patch for the narrative/UI surface. We intentionally
  // do NOT recompute ioScore.final or flowDivergence.contribution: when the engine saw
  // `available: false` it already excluded flow from the total with re-weighted siblings,
  // and retroactively adding flow back would alter the headline IOScore in a way the
  // engine never chose. Use canonical formula from computeFlowDivergence() — no skew floor.
  if (chainVoiRatio > existing) {
    const skew = ioScore.components.flowDivergence.skewDivergence;
    const patchedFinal = Math.min(1.0, (chainVoiRatio / 3.0) * skew);
    ioScore.components.flowDivergence.volOiRatio = chainVoiRatio;
    ioScore.components.flowDivergence.final = Math.round(patchedFinal * 100) / 100;
  }
}

function reconcileNarrativeEconomics(
  thesis: string,
  computed: { entryAbs: number; isCredit: boolean; maxProfit: number; maxLoss: number; breakeven: number },
  ticker: string,
): string {
  if (!thesis) return thesis;
  const drifts: Array<{ label: string; cited: number; computed: number; pct: number }> = [];
  let out = thesis;

  const close = (cited: number, truth: number) => {
    if (truth <= 0) return true;
    return Math.abs(cited - truth) / truth <= 0.05;
  };

  const fmtDollar = (n: number) => {
    if (n >= 1000) return Math.round(n).toString();
    if (n >= 100) return Math.round(n).toString();
    return (Math.round(n * 100) / 100).toString();
  };

  // Pattern 1: "$NNN max profit" / "max profit of $NNN" / "max profit $NNN"
  const dollarPatterns: Array<{ re: RegExp; truth: number; label: string }> = [
    { re: /\$(\d+(?:,\d{3})*(?:\.\d+)?)\s*(max\s+profit)/gi, truth: computed.maxProfit, label: "max profit" },
    { re: /(max\s+profit)[^$\d]{0,12}\$(\d+(?:,\d{3})*(?:\.\d+)?)/gi, truth: computed.maxProfit, label: "max profit" },
    { re: /\$(\d+(?:,\d{3})*(?:\.\d+)?)\s*(max\s+(?:loss|risk))/gi, truth: computed.maxLoss, label: "max loss" },
    { re: /(max\s+(?:loss|risk))[^$\d]{0,12}\$(\d+(?:,\d{3})*(?:\.\d+)?)/gi, truth: computed.maxLoss, label: "max loss" },
    { re: /\$(\d+(?:\.\d+)?)\s*(debit|credit)/gi, truth: computed.entryAbs, label: "entry" },
    { re: /(debit|credit)[^$\d]{0,12}\$(\d+(?:\.\d+)?)/gi, truth: computed.entryAbs, label: "entry" },
  ];

  for (const { re, truth, label } of dollarPatterns) {
    out = out.replace(re, (match, g1: string, g2: string) => {
      const numStr = /^\d/.test(g1) ? g1 : g2;
      const cited = parseFloat(numStr.replace(/,/g, ""));
      if (!Number.isFinite(cited) || cited <= 0) return match;
      if (truth <= 0) {
        // Can't replace safely, but log mismatch for canary visibility
        drifts.push({ label, cited, computed: truth, pct: 1 });
        return match;
      }
      if (close(cited, truth)) return match;
      drifts.push({ label, cited, computed: truth, pct: Math.abs(cited - truth) / truth });
      return match.replace(numStr, fmtDollar(truth));
    });
  }

  // Pattern 2: "X.X:1" ratios — gated to risk/reward context only (avoids false positives on
  // "3:1 ratio spread", "2:1 call/put skew", etc.). Only replace when a risk/reward keyword
  // appears within ~30 chars on either side of the ratio token.
  if (computed.maxLoss > 0 && computed.maxProfit > 0) {
    const truthRR = computed.maxProfit / computed.maxLoss;
    const rrContextRe = /([\s\S]{0,30})(\d+(?:\.\d+)?)\s*:\s*1([\s\S]{0,30})/g;
    const rrKeyword = /risk[\s/-]*reward|reward[\s/-]*to[\s/-]*risk|r[\s/-]*(?:to|\/|:)?[\s/-]*r\b|r:r|risk[\s:/-]*r|payoff[\s/-]*ratio/i;
    out = out.replace(rrContextRe, (match, before: string, numStr: string, after: string) => {
      const cited = parseFloat(numStr);
      if (!Number.isFinite(cited) || cited <= 0) return match;
      if (cited < 0.1 || cited > 20) return match; // sane R/R range
      const context = `${before} ${after}`;
      if (!rrKeyword.test(context)) return match; // not a risk/reward context — leave alone
      if (Math.abs(cited - truthRR) / truthRR <= 0.05) return match;
      drifts.push({ label: "risk/reward", cited, computed: truthRR, pct: Math.abs(cited - truthRR) / truthRR });
      const fixed = (Math.round(truthRR * 100) / 100).toFixed(2);
      return match.replace(`${numStr}`, fixed).replace(/(\d+\.\d{2}):\s*1/, `${fixed}:1`);
    });
  }

  if (drifts.length > 0) {
    logger.warn(
      {
        ticker,
        drifts: drifts.map((d) => ({
          label: d.label,
          citedByAi: d.cited,
          computedFromLegs: Math.round(d.computed * 100) / 100,
          driftPct: Math.round(d.pct * 1000) / 10,
        })),
      },
      "StrategistV2: narrative economics drifted from computed — auto-corrected in thesis",
    );
  }

  return out;
}

function normalizeExitTargets(
  raw: { profitTarget: number; profitTargetUnderlying: number; stopLoss: number; stopLossUnderlying: number; timeStop: string } | undefined,
  entryAbs: number,
  maxProfit: number,
  maxLoss: number,
  ticker: string,
): { profitTarget: number; profitTargetUnderlying: number; stopLoss: number; stopLossUnderlying: number; timeStop: string } {
  const def = { profitTarget: 0, profitTargetUnderlying: 0, stopLoss: 0, stopLossUnderlying: 0, timeStop: "" };
  if (!raw) return def;

  const normalizeOne = (v: number, label: "profitTarget" | "stopLoss"): number => {
    if (!Number.isFinite(v) || v <= 0) return 0;
    // Semantic classifier (not a raw ratio): a value is treated as dollar-P&L-on-1-lot
    // only if ALL of:
    //   1. v > 50 (no realistic per-share option target for retail tickers reaches $50;
    //      deep-ITM spreads may but they're rare and benefit from the close-match check below)
    //   2. The dollar-interpretation (v) is a close match (<25% drift) to the appropriate
    //      max P&L dollar figure (maxProfit for profitTarget, maxLoss for stopLoss).
    //   3. The per-share interpretation (v) would be implausibly far from entry (>15x).
    // This avoids mis-normalizing legitimate per-share targets on cheap options.
    const truth = label === "profitTarget" ? maxProfit : maxLoss;
    const lookLikeDollar =
      v > 50 &&
      truth > 0 &&
      Math.abs(v - truth) / truth < 0.25 &&
      entryAbs > 0 &&
      v > entryAbs * 15;
    if (lookLikeDollar) {
      const perShare = Math.round((v / 100) * 100) / 100;
      logger.warn(
        { ticker, field: label, reported: v, entryAbs, truthDollar: truth, normalized: perShare },
        "StrategistV2: exitTargets value matched dollar-P&L interpretation; normalized to per-share option price",
      );
      return perShare;
    }
    return Math.round(v * 100) / 100;
  };

  return {
    profitTarget: normalizeOne(raw.profitTarget, "profitTarget"),
    profitTargetUnderlying: Number.isFinite(raw.profitTargetUnderlying) ? raw.profitTargetUnderlying : 0,
    stopLoss: normalizeOne(raw.stopLoss, "stopLoss"),
    stopLossUnderlying: Number.isFinite(raw.stopLossUnderlying) ? raw.stopLossUnderlying : 0,
    timeStop: raw.timeStop ?? "",
  };
}

function buildContextSources(
  resp: AiTradeResponse,
  trace: WebSearchTrace,
): ContextSourcesPayload {
  const merged = new Map<string, { title: string; url: string; date?: string }>();
  for (const s of trace.sources) {
    merged.set(s.url, { title: s.title, url: s.url, date: s.date });
  }
  for (const h of resp.citedHeadlines ?? []) {
    if (!h.url) continue;
    if (!merged.has(h.url)) {
      merged.set(h.url, { title: h.title, url: h.url, date: h.date });
    }
  }
  return {
    webSearchUsed: trace.webSearchUsed,
    queryCount: trace.queries.length,
    queries: trace.queries,
    sources: Array.from(merged.values()).slice(0, 12),
    sameDayCatalyst: resp.sameDayCatalyst === true,
    catalystSummary: resp.catalystSummary,
    catalystAlignment: resp.catalystAlignment ?? "NONE",
  };
}
