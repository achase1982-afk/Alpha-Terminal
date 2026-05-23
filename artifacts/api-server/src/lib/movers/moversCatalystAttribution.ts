import { z } from "zod";
import pLimit from "p-limit";
import type {
  FlaggedName,
  MoversCatalystType,
  MoversConfidence,
  MoversPosture,
  Situation,
} from "@workspace/movers-types";
import {
  callAnthropicWithSystem,
  callGeminiWithSystem,
  callOpenAIWithSystem,
  callXaiWithSystem,
  extractJson,
} from "../aiLabAnalystClient.js";
import type { AiLabModelProvider } from "../aiLabConfig.js";
import { getMoversAiConfig } from "../aiLabConfig.js";
import { logger } from "../logger.js";
import { fetchHeadlinesForSituation, formatHeadlinesForPrompt } from "./fmpMoversNews.js";

const attributionLimit = pLimit(4);

const CatalystAttributionSchema = z.object({
  catalystType: z.enum(["GOV", "ANALYST", "CONTRACT", "EARNINGS", "MA", "SECTOR", "NONE"]),
  catalyst: z.string(),
  read: z.string(),
  posture: z.enum(["WATCH", "WAIT", "PASS"]),
  confidence: z.enum(["HIGH", "MED", "LOW"]),
});

export type MoversAiConfig = {
  provider: AiLabModelProvider;
  modelName: string;
  temperature: number;
};

const SYSTEM_PROMPT = `You are a catalyst analyst for an institutional movers feed.
Given tickers, price action, and recent headlines, identify the primary catalyst driving today's move.
Respond with JSON only (no markdown), matching this schema:
{
  "catalystType": "GOV" | "ANALYST" | "CONTRACT" | "EARNINGS" | "MA" | "SECTOR" | "NONE",
  "catalyst": "one sentence describing the catalyst",
  "read": "one-line risk and timing verdict",
  "posture": "WATCH" | "WAIT" | "PASS",
  "confidence": "HIGH" | "MED" | "LOW"
}
Use NONE when headlines do not support a specific catalyst. Do not invent facts not supported by the headlines.`;

function buildSituationPrompt(situation: Situation, headlinesBlock: string): string {
  const tickerLines = situation.tickers
    .map((t) => {
      const parts = [
        `${t.symbol} (${t.name})`,
        `price $${t.price.toFixed(2)}`,
        `change ${t.changePct >= 0 ? "+" : ""}${t.changePct.toFixed(2)}%`,
      ];
      if (t.sector) parts.push(`sector ${t.sector}`);
      if (t.industry) parts.push(`industry ${t.industry}`);
      return `- ${parts.join(", ")}`;
    })
    .join("\n");

  return `Situation: ${situation.kind === "cluster" ? `cluster "${situation.label}"` : "single name"}
Tickers:
${tickerLines}

Recent headlines:
${headlinesBlock}`;
}

async function callAttributionLlm(
  prompt: string,
  cfg: MoversAiConfig,
): Promise<z.infer<typeof CatalystAttributionSchema>> {
  let rawText: string;
  switch (cfg.provider) {
    case "anthropic":
      rawText = await callAnthropicWithSystem(cfg.modelName, cfg.temperature, SYSTEM_PROMPT, prompt);
      break;
    case "google":
      rawText = await callGeminiWithSystem(cfg.modelName, cfg.temperature, SYSTEM_PROMPT, prompt);
      break;
    case "openai":
      rawText = await callOpenAIWithSystem(cfg.modelName, cfg.temperature, SYSTEM_PROMPT, prompt);
      break;
    case "xai":
      rawText = await callXaiWithSystem(cfg.modelName, cfg.temperature, SYSTEM_PROMPT, prompt);
      break;
    default:
      throw new Error(`Unsupported movers attribution provider: ${cfg.provider}`);
  }

  const clean = extractJson(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch {
    throw new Error("Movers catalyst response is not valid JSON");
  }
  return CatalystAttributionSchema.parse(parsed);
}

function situationToFlagged(situation: Situation, note: string): FlaggedName[] {
  return situation.tickers.map((t) => ({
    symbol: t.symbol,
    name: t.name,
    price: t.price,
    changePct: t.changePct,
    note,
  }));
}

function applyAttribution(
  situation: Situation,
  attr: z.infer<typeof CatalystAttributionSchema>,
): Situation {
  return {
    ...situation,
    catalystType: attr.catalystType as MoversCatalystType,
    catalyst: attr.catalyst.trim(),
    read: attr.read.trim(),
    posture: attr.posture as MoversPosture,
    confidence: attr.confidence as MoversConfidence,
  };
}

export async function attributeMoversSituations(
  situations: Situation[],
  cfg: MoversAiConfig = getMoversAiConfig(),
): Promise<{ situations: Situation[]; flagged: FlaggedName[] }> {
  const attributed: Array<{ index: number; situation: Situation } | { index: number; flagged: FlaggedName[] }> =
    [];

  await Promise.all(
    situations.map((situation, index) =>
      attributionLimit(async () => {
        try {
          const headlines = await fetchHeadlinesForSituation(situation);
          const prompt = buildSituationPrompt(situation, formatHeadlinesForPrompt(headlines));
          const attr = await callAttributionLlm(prompt, cfg);

          if (attr.catalystType === "NONE") {
            const note = attr.catalyst.trim() || "No identifiable catalyst in recent headlines";
            attributed.push({ index, flagged: situationToFlagged(situation, note) });
            return;
          }

          attributed.push({ index, situation: applyAttribution(situation, attr) });
        } catch (err) {
          logger.warn({ err, situationId: situation.id }, "Movers catalyst attribution failed");
          attributed.push({
            index,
            flagged: situationToFlagged(situation, "Catalyst attribution unavailable"),
          });
        }
      }),
    ),
  );

  const situationsOut: Situation[] = [];
  const flaggedOut: FlaggedName[] = [];

  attributed.sort((a, b) => a.index - b.index);
  for (const entry of attributed) {
    if ("situation" in entry) situationsOut.push(entry.situation);
    else flaggedOut.push(...entry.flagged);
  }

  situationsOut.sort((a, b) => {
    const aPct = Math.max(...a.tickers.map((t) => Math.abs(t.changePct)));
    const bPct = Math.max(...b.tickers.map((t) => Math.abs(t.changePct)));
    return bPct - aPct;
  });

  return { situations: situationsOut, flagged: flaggedOut };
}
