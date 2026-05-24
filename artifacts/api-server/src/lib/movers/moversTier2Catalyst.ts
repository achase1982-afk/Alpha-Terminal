import { z } from "zod";
import type { MoversCatalystType, Situation, TickerStat } from "@workspace/movers-types";
import {
  callAnthropicWithSystem,
  callGeminiWithSystem,
  callOpenAIWithSystem,
  extractJson,
} from "../aiLabAnalystClient.js";
import type { AiLabModelProvider } from "../aiLabConfig.js";
import { getMoversAiConfig } from "../aiLabConfig.js";
import { logger } from "../logger.js";
import type { MoversNewsHeadline } from "./fmpMoversNews.js";
import { formatHeadlinesForPrompt } from "./fmpMoversNews.js";
import { buildMoversNewsKey, resolveHeadlineByTitle } from "./moversNewsKey.js";

const CLASSIFIABLE_TYPES = ["GOV", "ANALYST", "CONTRACT", "EARNINGS", "MA", "SECTOR", "NONE"] as const;
type Tier2CatalystType = (typeof CLASSIFIABLE_TYPES)[number];

const Tier2ItemSchema = z.object({
  ticker: z.string(),
  catalystType: z.enum(CLASSIFIABLE_TYPES),
  drivingHeadline: z.string(),
});

const Tier2BatchSchema = z.object({
  results: z.array(Tier2ItemSchema),
});

export type Tier2UnknownCandidate = {
  situation: Situation;
  headlines: MoversNewsHeadline[];
};

export type Tier2TickerPayload = {
  situationId: string;
  ticker: string;
  changePct: number;
  headlines: MoversNewsHeadline[];
};

type MoversAiProvider = "anthropic" | "google" | "openai";

const TIER2_SYSTEM_PROMPT = `You are a catalyst classifier for an institutional movers feed.
Given tickers, price change, and recent headlines, assign the catalyst type that best explains TODAY's move.

Respond with JSON only (no markdown):
{
  "results": [
    { "ticker": "SYMBOL", "catalystType": "GOV" | "ANALYST" | "CONTRACT" | "EARNINGS" | "MA" | "SECTOR" | "NONE", "drivingHeadline": "exact or near-exact headline title from the list" }
  ]
}

Rules:
- Pick the catalyst type that best explains the move from the headlines.
- drivingHeadline must be the primary news item driving the move (copy from the provided headlines when possible).
- Treat litigation-solicitation headlines as downstream noise, NOT catalysts: law firm names, "investors have opportunity", "join investigation", class action / shareholder investigation, securities fraud solicitations. They trail a move after it happens.
- Prefer regulatory, earnings, M&A, contract, sector, or analyst headlines over solicitation PR when both exist.
- Return NONE only when headlines genuinely contain no catalyst for the move (not when solicitation headlines dominate).`;

function normalizeProvider(provider: AiLabModelProvider): MoversAiProvider {
  if (provider === "anthropic" || provider === "google" || provider === "openai") return provider;
  return "anthropic";
}

export function leadTickerForSituation(situation: Situation): TickerStat {
  return situation.tickers.reduce((best, t) =>
    Math.abs(t.changePct) > Math.abs(best.changePct) ? t : best,
  );
}

export function buildTier2TickerPayloads(candidates: Tier2UnknownCandidate[]): Tier2TickerPayload[] {
  const payloads: Tier2TickerPayload[] = [];
  for (const { situation, headlines } of candidates) {
    const lead = leadTickerForSituation(situation);
    payloads.push({
      situationId: situation.id,
      ticker: lead.symbol,
      changePct: lead.changePct,
      headlines,
    });
  }
  return payloads;
}

function buildTier2UserPrompt(payloads: Tier2TickerPayload[]): string {
  const blocks = payloads.map((p) => {
    const sign = p.changePct >= 0 ? "+" : "";
    const headlineBlock = formatHeadlinesForPrompt(p.headlines);
    return `Ticker: ${p.ticker}
Change: ${sign}${p.changePct.toFixed(2)}%
Headlines:
${headlineBlock}`;
  });
  return `Classify each ticker below. Return one results[] entry per ticker (same ticker symbol).\n\n${blocks.join("\n\n---\n\n")}`;
}

async function callTier2Llm(prompt: string): Promise<z.infer<typeof Tier2BatchSchema>> {
  const aiCfg = getMoversAiConfig();
  const provider = normalizeProvider(aiCfg.provider);
  let rawText: string;
  switch (provider) {
    case "anthropic":
      rawText = await callAnthropicWithSystem(
        aiCfg.modelName,
        aiCfg.temperature,
        TIER2_SYSTEM_PROMPT,
        prompt,
      );
      break;
    case "google":
      rawText = await callGeminiWithSystem(
        aiCfg.modelName,
        aiCfg.temperature,
        TIER2_SYSTEM_PROMPT,
        prompt,
      );
      break;
    case "openai":
      rawText = await callOpenAIWithSystem(
        aiCfg.modelName,
        aiCfg.temperature,
        TIER2_SYSTEM_PROMPT,
        prompt,
      );
      break;
    default:
      throw new Error(`Unsupported movers tier-2 provider: ${provider}`);
  }
  return Tier2BatchSchema.parse(JSON.parse(extractJson(rawText)));
}

function isTier2Classified(type: MoversCatalystType): type is Tier2CatalystType {
  return (CLASSIFIABLE_TYPES as readonly string[]).includes(type);
}

export function applyTier2ResultToSituation(
  situation: Situation,
  headlines: MoversNewsHeadline[],
  item: z.infer<typeof Tier2ItemSchema>,
): Situation {
  const catalystType = item.catalystType as MoversCatalystType;
  if (catalystType === "NONE") {
    return { ...situation, catalystType: "NONE", catalyst: "", newsKey: "" };
  }
  const resolved = resolveHeadlineByTitle(headlines, item.drivingHeadline);
  const catalystText = resolved?.title.trim() ?? item.drivingHeadline.trim();
  const newsKey = resolved ? buildMoversNewsKey(resolved) : "";
  return {
    ...situation,
    catalystType: isTier2Classified(catalystType) ? catalystType : "NONE",
    catalyst: catalystText,
    newsKey,
  };
}

/**
 * One batched LLM call for all UNKNOWN residuals. Returns count of situations updated to a
 * non-NONE classifiable type.
 */
export async function classifyUnknownResidualWithTier2(
  candidates: Tier2UnknownCandidate[],
): Promise<{ situations: Situation[]; tier2Assigned: number }> {
  if (candidates.length === 0) return { situations: [], tier2Assigned: 0 };

  const payloads = buildTier2TickerPayloads(candidates);

  try {
    const batch = await callTier2Llm(buildTier2UserPrompt(payloads));
    const payloadByTicker = new Map(payloads.map((p) => [p.ticker.toUpperCase(), p]));
    const candidateBySituationId = new Map(candidates.map((c) => [c.situation.id, c]));
    let tier2Assigned = 0;

    for (const item of batch.results) {
      const payload = payloadByTicker.get(item.ticker.toUpperCase());
      if (!payload) continue;
      const candidate = candidateBySituationId.get(payload.situationId);
      if (!candidate) continue;

      const updated = applyTier2ResultToSituation(candidate.situation, candidate.headlines, item);
      candidateBySituationId.set(candidate.situation.id, {
        ...candidate,
        situation: updated,
      });
      if (item.catalystType !== "NONE") tier2Assigned += 1;
    }

    return {
      situations: [...candidateBySituationId.values()].map((c) => c.situation),
      tier2Assigned,
    };
  } catch (err) {
    logger.warn({ err, count: candidates.length }, "Movers tier-2 catalyst classification failed");
    return {
      situations: candidates.map((c) => c.situation),
      tier2Assigned: 0,
    };
  }
}
