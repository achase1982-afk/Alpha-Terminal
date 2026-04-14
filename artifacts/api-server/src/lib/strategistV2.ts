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
import { callAnthropicWithSystem, callGeminiWithSystem, extractJson } from "./aiLabAnalystClient.js";

const SCHWAB_API = "https://api.schwabapi.com/marketdata/v1";

export interface StrategistV2Result {
  status: "recommendation" | "no_viable_setup" | "toxic_block";
  ticker: string;
  recommendation?: {
    strategyLine: string;
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
    maxProfit: number;
    maxLoss: number;
    breakeven: number;
    riskReward: number;
    dte: number;
    expiration: string;
    confidence: number;
    warnings: string | null;
  };
  blockReason?: string;
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

interface AiTradeResponse {
  strategy: string;
  legs: Array<{
    type: "call" | "put";
    strike: number;
    action: "buy" | "sell";
    expiration: string;
  }>;
  entryPrice: number;
  maxRisk: number;
  maxProfit: number | string;
  breakeven: number[];
  rationale: string;
  confidence: number;
  warnings: string | null;
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
}

const STRATEGIST_SYSTEM_PROMPT = `You are a senior options trader on a professional trading desk. You have access to the data package provided AND your full training knowledge about markets, stocks, sectors, options pricing, earnings patterns, institutional behavior, and current events. Use both. The data package gives you current numbers. Your knowledge gives you context. You are not limited to the data package.

Analyze this ticker and recommend the single best options trade right now. You may recommend any strategy: vertical spreads, iron condors, butterflies, calendars, naked options, debit spreads, credit spreads, or anything else you believe has edge. Any expiration is allowed including short-dated weeklys. You MUST pick an expiration from the availableExpirations list in the data package. Use YYYY-MM-DD format.

The user's configurable preferences are included for context. Respect them when possible but if you see a compelling trade outside their preferences, recommend it and explain why.

If you genuinely see no compelling setup in the data, say so honestly. Return confidence below 20 and explain why there is nothing worth trading. Do not invent a trade just to have an answer.

Your response must be valid JSON with these fields:
- strategy: string (e.g. "bull_call_spread", "iron_condor", "naked_put", "calendar_spread")
- legs: array of {type: "call" or "put", strike: number, action: "buy" or "sell", expiration: "YYYY-MM-DD"}
- entryPrice: number (net debit or credit, positive = debit, negative = credit)
- maxRisk: number (maximum dollar loss per contract)
- maxProfit: number (maximum dollar profit per contract, or 99999 for theoretically unlimited)
- breakeven: array of numbers (breakeven price points)
- rationale: string (3-5 sentences explaining why this specific trade, what you see in the data and your broader knowledge, why this structure fits the current setup)
- confidence: number 0-100
- warnings: string or null (anything the user should know: earnings risk, low liquidity, gap risk, etc.)

IMPORTANT: Respond with ONLY the JSON object. No markdown, no explanation text, no code fences. Just the raw JSON.`;

export async function analyzeTickerV2(ticker: string): Promise<StrategistV2Result> {
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
    await logTelemetry(ticker, "toxic_block", regime, settings, null, null, toxicCheck, null, result.blockReason);
    return result;
  }

  const tickerData = await fetchTickerData(ticker);
  if (!tickerData) {
    const result: StrategistV2Result = {
      status: "no_viable_setup",
      ticker,
      blockReason: "No viable options setup: unable to fetch ticker data.",
      regime,
      systemicRiskElevated: regime.systemicRiskLevel === "ELEVATED" || regime.systemicRiskLevel === "EXTREME",
    };
    await logTelemetry(ticker, "no_data", regime, settings, null, null, toxicCheck, null, result.blockReason);
    return result;
  }

  if (tickerData.halted) {
    return noViable(ticker, regime, settings, toxicCheck, tickerData, "No viable options setup: stock halted.", null);
  }

  const chain = await fetchOptionsChain(ticker, settings);
  if (!chain || chain.length === 0) {
    return noViable(ticker, regime, settings, toxicCheck, tickerData, "No viable options setup: no options chain.", null);
  }
  logger.info({ ticker, chainLength: chain.length }, "StrategistV2: options chain loaded");

  const liveIvr = computeIvrFromChain(chain, tickerData.price);
  tickerData.ivr = liveIvr;
  logger.info({ ticker, liveIvr }, "StrategistV2: live IVR computed from options chain");

  const catalystInfo = deriveCatalyst(tickerData);
  const ioScore = await computeIOScore(ticker, catalystInfo, settings);

  const chainSummary = summarizeOptionsChain(chain, tickerData.price);

  const dataPackage = buildDataPackage(ticker, tickerData, chainSummary, ioScore, regime, settings);

  let aiResponse: AiTradeResponse;
  try {
    aiResponse = await callAiForTrade(dataPackage);
  } catch (err) {
    logger.error({ err, ticker }, "StrategistV2: AI trade call failed");
    return noViable(ticker, regime, settings, toxicCheck, tickerData, `AI analysis failed: ${err instanceof Error ? err.message : String(err)}`, ioScore);
  }

  if (aiResponse.confidence < 20) {
    return noViable(ticker, regime, settings, toxicCheck, tickerData, `AI found no compelling setup (confidence ${aiResponse.confidence}): ${aiResponse.rationale}`, ioScore);
  }

  const validationResult = validateAiResponse(aiResponse, chain, settings);
  if (!validationResult.valid) {
    try {
      const retryPrompt = buildRetryPrompt(aiResponse, validationResult.issues);
      aiResponse = await callAiForTrade(dataPackage, retryPrompt);

      const retryValidation = validateAiResponse(aiResponse, chain, settings);
      if (!retryValidation.valid) {
        return noViable(ticker, regime, settings, toxicCheck, tickerData,
          `AI recommendation failed validation after retry: ${retryValidation.issues.join("; ")}`, ioScore);
      }
    } catch (err) {
      logger.error({ err, ticker }, "StrategistV2: AI retry failed");
      return noViable(ticker, regime, settings, toxicCheck, tickerData,
        `AI retry failed: ${err instanceof Error ? err.message : String(err)}`, ioScore);
    }
  }

  const legs = mapAiLegsToCandidate(aiResponse, chain);
  const isCredit = aiResponse.entryPrice < 0;
  const entryAbs = Math.abs(aiResponse.entryPrice);
  const maxProfit = typeof aiResponse.maxProfit === "number" ? aiResponse.maxProfit : 99999;
  const maxLoss = aiResponse.maxRisk;
  const breakeven = aiResponse.breakeven.length > 0 ? aiResponse.breakeven[0] : tickerData.price;

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
      thesis: aiResponse.rationale,
      rationale: aiResponse.rationale,
      edgeAttribution: `Edge source: Idiosyncratic ${idioStrengthPct}% / Macro ${macroPct}%`,
      idioStrengthPct,
      macroPct,
      strategyType: aiResponse.strategy,
      direction,
      legs,
      credit: isCredit ? entryAbs : undefined,
      debit: !isCredit ? entryAbs : undefined,
      maxProfit,
      maxLoss,
      breakeven,
      riskReward: maxLoss > 0 ? maxProfit / maxLoss : 0,
      dte,
      expiration,
      confidence: aiResponse.confidence,
      warnings: aiResponse.warnings,
    },
    regime,
    ioScore,
    systemicRiskElevated: regime.systemicRiskLevel === "ELEVATED" || regime.systemicRiskLevel === "EXTREME",
  };

  const telemetryId = await logTelemetry(
    ticker, "recommendation", regime, settings, ioScore, tickerData, toxicCheck,
    {
      strategy: aiResponse.strategy,
      strategyType: aiResponse.strategy,
      confidence: aiResponse.confidence,
      aiRationale: aiResponse.rationale,
      warnings: aiResponse.warnings,
      legs: aiResponse.legs,
      entryPrice: aiResponse.entryPrice,
      maxRisk: aiResponse.maxRisk,
      maxProfit: aiResponse.maxProfit,
      breakeven: aiResponse.breakeven,
    },
    result.recommendation?.strategyLine,
  );
  result.telemetryId = telemetryId ?? undefined;

  return result;
}

function summarizeOptionsChain(chain: ChainContract[], price: number): ChainSummary {
  const calls = chain.filter(c => c.type === "call" || c.optionType === "CALL");
  const puts = chain.filter(c => c.type === "put" || c.optionType === "PUT");

  const atmCalls = calls.filter(c => Math.abs(c.strike - price) / price < 0.02).sort((a, b) => Math.abs(a.strike - price) - Math.abs(b.strike - price));
  const atmPuts = puts.filter(c => Math.abs(c.strike - price) / price < 0.02).sort((a, b) => Math.abs(a.strike - price) - Math.abs(b.strike - price));
  const atmCall = atmCalls[0];
  const atmPut = atmPuts[0];
  const atmStrike = atmCall?.strike ?? atmPut?.strike ?? Math.round(price);

  const topVolumeCalls = [...calls].sort((a, b) => b.volume - a.volume).slice(0, 5).map(c => ({
    strike: c.strike, expiration: c.expiration, volume: c.volume, oi: c.openInterest,
    bid: c.bid, ask: c.ask, iv: c.impliedVolatility, delta: c.delta,
  }));
  const topVolumePuts = [...puts].sort((a, b) => b.volume - a.volume).slice(0, 5).map(c => ({
    strike: c.strike, expiration: c.expiration, volume: c.volume, oi: c.openInterest,
    bid: c.bid, ask: c.ask, iv: c.impliedVolatility, delta: c.delta,
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

  return {
    atmStrike,
    atmCallBid: atmCall?.bid ?? 0,
    atmCallAsk: atmCall?.ask ?? 0,
    atmCallIV: atmCall?.impliedVolatility ?? 0,
    atmCallOI: atmCall?.openInterest ?? 0,
    atmPutBid: atmPut?.bid ?? 0,
    atmPutAsk: atmPut?.ask ?? 0,
    atmPutIV: atmPut?.impliedVolatility ?? 0,
    atmPutOI: atmPut?.openInterest ?? 0,
    topVolumeCalls,
    topVolumePuts,
    unusualActivity,
    putCallVolumeRatio,
    frontMonthIV,
    backMonthIV,
    availableExpirations: expirations,
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

async function callAiForTrade(dataPackage: string, retryInstruction?: string): Promise<AiTradeResponse> {
  const aiCfg = getAiLabStrategistConfig();
  const provider = aiCfg.analystModelProvider;
  const model = aiCfg.analystModelName;
  const temperature = aiCfg.analystTemperature;

  logger.info({ provider, model, temperature }, "StrategistV2: calling AI for trade");

  const prompt = retryInstruction
    ? `${retryInstruction}\n\nOriginal data package:\n${dataPackage}`
    : `Analyze this ticker and recommend the best trade. Respond ONLY with a valid JSON object, no text before or after.\n\n${dataPackage}`;

  let rawText: string;
  switch (provider) {
    case "anthropic":
      rawText = await callAnthropicWithSystem(model, temperature, STRATEGIST_SYSTEM_PROMPT, prompt);
      break;
    case "google":
      rawText = await callGeminiWithSystem(model, temperature, STRATEGIST_SYSTEM_PROMPT, prompt);
      break;
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }

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
  if (!resp.strategy || !Array.isArray(resp.legs) || resp.legs.length === 0) {
    logger.error({ parsedKeys: Object.keys(resp), parsedSnippet: JSON.stringify(resp).slice(0, 500) }, "StrategistV2: AI response missing required fields");
    throw new Error("AI response missing required fields (strategy, legs)");
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

  return {
    strategy: String(resp.strategy),
    legs,
    entryPrice: safeNum(resp.entryPrice, 0),
    maxRisk: safeNum(resp.maxRisk, 0),
    maxProfit: resp.maxProfit === "unlimited" || resp.maxProfit === "Unlimited" ? 99999 : safeNum(resp.maxProfit, 0),
    breakeven: Array.isArray(resp.breakeven) ? (resp.breakeven as unknown[]).map(v => safeNum(v, 0)).filter(n => n > 0) : [],
    rationale: String(resp.rationale ?? ""),
    confidence,
    warnings: resp.warnings ? String(resp.warnings) : null,
  };
}

function validateAiResponse(
  response: AiTradeResponse,
  chain: ChainContract[],
  settings: StrategistConfig,
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const minOI = settings.minOpenInterest;
  const maxSpreadPct = settings.maxBidAskSpreadPct / 100;

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

function inferDirection(strategy: string, legs: AiTradeResponse["legs"]): string {
  const s = strategy.toLowerCase();
  if (s.includes("bull") || s.includes("long_call") || s.includes("call_debit")) return "BULLISH";
  if (s.includes("bear") || s.includes("long_put") || s.includes("put_debit")) return "BEARISH";
  if (s.includes("condor") || s.includes("butterfly") || s.includes("straddle") || s.includes("strangle")) return "NON_DIRECTIONAL";
  if (s.includes("calendar")) return "NON_DIRECTIONAL";
  const buys = legs.filter(l => l.action === "buy");
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

async function fetchTickerData(ticker: string): Promise<TickerData | null> {
  try {
    const token = await getBestAccessToken();
    if (!token) return null;

    const res = await fetch(`${SCHWAB_API}/quotes?symbols=${ticker}&fields=quote,fundamental`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;

    const data = await res.json() as any;
    const q = data[ticker]?.quote ?? data[ticker.toUpperCase()]?.quote;
    const f = data[ticker]?.fundamental ?? data[ticker.toUpperCase()]?.fundamental ?? {};
    if (!q) return null;

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
    };
  } catch (err) {
    logger.error({ err, ticker }, "StrategistV2: failed to fetch ticker data");
    return null;
  }
}

async function fetchOptionsChain(ticker: string, settings: StrategistConfig): Promise<ChainContract[]> {
  try {
    const apiKey = process.env.POLYGON_API_KEY || "";
    const chain = await fetchPolygonChain(ticker, apiKey, { maxDte: 365 });
    if (!chain || !chain.calls || (chain.calls.length === 0 && chain.puts.length === 0)) {
      const token = await getBestAccessToken();
      if (!token) return [];
      const res = await fetch(
        `${SCHWAB_API}/chains?symbol=${ticker}&strikeCount=20&strategy=SINGLE&range=OTM`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) return [];
      const data = await res.json() as any;
      return flattenSchwabChain(data, settings);
    }

    const taggedCalls = (chain.calls || []).map((c: any) => ({ ...c, type: "call", optionType: "CALL", mid: c.mid ?? ((c.bid ?? 0) + (c.ask ?? 0)) / 2 }));
    const taggedPuts = (chain.puts || []).map((c: any) => ({ ...c, type: "put", optionType: "PUT", mid: c.mid ?? ((c.bid ?? 0) + (c.ask ?? 0)) / 2 }));
    return [...taggedCalls, ...taggedPuts] as ChainContract[];
  } catch (err) {
    logger.error({ err, ticker }, "StrategistV2: failed to fetch options chain");
    return [];
  }
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

function flattenSchwabChain(data: any, settings: StrategistConfig): ChainContract[] {
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

async function noViable(
  ticker: string,
  regime: StructuredRegime,
  settings: StrategistConfig,
  toxicCheck: any,
  tickerData: TickerData | null,
  reason: string,
  ioScore?: IOScoreResult | null,
): Promise<StrategistV2Result> {
  await logTelemetry(ticker, "no_viable_setup", regime, settings, ioScore ?? null, tickerData, toxicCheck, null, reason);
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
    }).returning({ id: strategistTelemetryTable.id });
    return row?.id ?? null;
  } catch (err) {
    logger.error({ err }, "StrategistV2: telemetry logging failed");
    return null;
  }
}
