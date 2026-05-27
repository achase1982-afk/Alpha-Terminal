import { z } from "zod";
import type {
  MoversCatalystType,
  MoversConfidence,
  MoversPosture,
  MoversSituationRead,
  Situation,
} from "@workspace/movers-types";
import {
  headlineHasHardCatalystKeyword,
  MOVERS_WEB_FALLBACK_MIN_ABS_CHANGE_PCT,
} from "@workspace/movers-types";
import { db, moversCatalystCacheTable, eq, lt } from "@workspace/db";
import {
  callAnthropicWithSystem,
  callGeminiWithSystem,
  callOpenAIWithSystem,
  extractJson,
} from "../aiLabAnalystClient.js";
import type { AiLabModelProvider } from "../aiLabConfig.js";
import { getMoversAiConfig } from "../aiLabConfig.js";
import {
  executeDedicatedWebSearch,
  formatDedicatedWebSearchForChat,
  isDedicatedWebSearchApiEnabled,
} from "../webSearchApiClient.js";
import { logger } from "../logger.js";
import type { MoversNewsHeadline } from "./fmpMoversNews.js";
import { fetchHeadlinesForSituation, formatHeadlinesForPrompt } from "./fmpMoversNews.js";
import { buildMoversNewsKey, pickCatalystHeadline } from "./moversNewsKey.js";
import { getLatestMoversFeed } from "./moversFeedStore.js";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const READ_CATALYST_TYPES = [
  "GOV",
  "ANALYST",
  "CONTRACT",
  "EARNINGS",
  "MA",
  "SECTOR",
  "NONE",
] as const;

const ReadSchema = z.object({
  read: z.string(),
  posture: z.enum(["WATCH", "WAIT", "PASS"]),
  confidence: z.enum(["HIGH", "MED", "LOW"]),
  catalystType: z.enum(READ_CATALYST_TYPES),
  catalystSummary: z.string(),
});

const READ_SYSTEM_PROMPT = `You are a trading desk analyst for an institutional movers feed.
You receive pre-gathered context (FMP headlines and optional web search). Identify the primary catalyst for today's move.
Respond with JSON only (no markdown):
{
  "read": "one-line risk and timing verdict",
  "posture": "WATCH" | "WAIT" | "PASS",
  "confidence": "HIGH" | "MED" | "LOW",
  "catalystType": "GOV" | "ANALYST" | "CONTRACT" | "EARNINGS" | "MA" | "SECTOR" | "NONE",
  "catalystSummary": "one sentence describing the driving catalyst headline"
}
Use NONE only when no credible catalyst exists. Do not invent facts beyond the context.`;

export type MoversReadAiProvider = "anthropic" | "google" | "openai";

function normalizeReadProvider(provider: AiLabModelProvider): MoversReadAiProvider {
  if (provider === "anthropic" || provider === "google" || provider === "openai") return provider;
  return "anthropic";
}

function maxAbsChangePct(situation: Situation): number {
  if (situation.tickers.length === 0) return 0;
  return Math.max(...situation.tickers.map((t) => Math.abs(t.changePct)));
}

/** Web fallback on expand when FMP is empty or headline lacks hard-catalyst signal on a large move. */
export function shouldRunMoversWebFallback(
  headlines: MoversNewsHeadline[],
  selected: MoversNewsHeadline | null,
  situation: Situation,
  minAbsChangePct = MOVERS_WEB_FALLBACK_MIN_ABS_CHANGE_PCT,
): boolean {
  if (headlines.length === 0) return true;
  if (maxAbsChangePct(situation) < minAbsChangePct) return false;
  if (!selected) return true;
  return !headlineHasHardCatalystKeyword(selected.title);
}

async function pruneOldCacheEntries(): Promise<void> {
  const cutoff = new Date(Date.now() - CACHE_TTL_MS);
  await db.delete(moversCatalystCacheTable).where(lt(moversCatalystCacheTable.createdAt, cutoff));
}

async function getCachedRead(newsKey: string): Promise<MoversSituationRead | null> {
  if (!newsKey) return null;
  const rows = await db
    .select()
    .from(moversCatalystCacheTable)
    .where(eq(moversCatalystCacheTable.newsKey, newsKey))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const out: MoversSituationRead = {
    read: row.read,
    posture: row.posture as MoversPosture,
    confidence: row.confidence as MoversConfidence,
    cached: true,
  };
  if (row.catalystType?.trim()) {
    out.catalystType = row.catalystType as MoversCatalystType;
  }
  if (row.catalystSummary?.trim()) {
    out.catalystSummary = row.catalystSummary.trim();
  }
  return out;
}

async function writeCache(newsKey: string, payload: MoversSituationRead): Promise<void> {
  await db
    .insert(moversCatalystCacheTable)
    .values({
      newsKey,
      read: payload.read,
      posture: payload.posture,
      confidence: payload.confidence,
      catalystType: payload.catalystType ?? null,
      catalystSummary: payload.catalystSummary ?? null,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: moversCatalystCacheTable.newsKey,
      set: {
        read: payload.read,
        posture: payload.posture,
        confidence: payload.confidence,
        catalystType: payload.catalystType ?? null,
        catalystSummary: payload.catalystSummary ?? null,
        createdAt: new Date(),
      },
    });
  await pruneOldCacheEntries();
}

function buildReadPrompt(
  situation: Situation,
  contextBlock: string,
  seedType: MoversCatalystType,
  seedSummary: string,
): string {
  const tickerLines = situation.tickers
    .map((t) => {
      return `- ${t.symbol} (${t.name}): $${t.price.toFixed(2)}, ${t.changePct >= 0 ? "+" : ""}${t.changePct.toFixed(2)}%`;
    })
    .join("\n");

  return `Situation: ${situation.kind === "cluster" ? `cluster "${situation.label}"` : situation.id}
Seed catalyst type (FMP/keyword): ${seedType}
Seed catalyst summary: ${seedSummary || "(none)"}

Tickers:
${tickerLines}

Context:
${contextBlock}`;
}

async function gatherReadContext(
  situation: Situation,
  options: { includeWebSearch: boolean },
): Promise<string> {
  const headlines = await fetchHeadlinesForSituation(situation);
  const fmpBlock = formatHeadlinesForPrompt(headlines);
  const parts = [`FMP news:\n${fmpBlock}`];

  if (options.includeWebSearch && isDedicatedWebSearchApiEnabled()) {
    const symbols = situation.tickers.map((t) => t.symbol).join(" ");
    const query = `${symbols} stock news catalyst today`.slice(0, 380);
    try {
      const search = await executeDedicatedWebSearch(query);
      const webText = formatDedicatedWebSearchForChat(search).trim();
      if (webText) parts.push(`Web search supplement:\n${webText.slice(0, 8000)}`);
    } catch (err) {
      logger.warn({ err, situationId: situation.id }, "Movers read web search fallback failed");
    }
  }

  return parts.join("\n\n");
}

async function callReadLlm(
  prompt: string,
  provider: MoversReadAiProvider,
  modelName: string,
  temperature: number,
): Promise<MoversSituationRead> {
  let rawText: string;
  switch (provider) {
    case "anthropic":
      rawText = await callAnthropicWithSystem(modelName, temperature, READ_SYSTEM_PROMPT, prompt);
      break;
    case "google":
      rawText = await callGeminiWithSystem(modelName, temperature, READ_SYSTEM_PROMPT, prompt);
      break;
    case "openai":
      rawText = await callOpenAIWithSystem(modelName, temperature, READ_SYSTEM_PROMPT, prompt);
      break;
    default:
      throw new Error(`Unsupported movers read provider: ${provider}`);
  }
  const parsed = ReadSchema.parse(JSON.parse(extractJson(rawText)));
  return {
    read: parsed.read.trim(),
    posture: parsed.posture,
    confidence: parsed.confidence,
    catalystType: parsed.catalystType,
    catalystSummary: parsed.catalystSummary.trim(),
    cached: false,
  };
}

export async function findSituationById(situationId: string): Promise<Situation | null> {
  const feed = await getLatestMoversFeed();
  return feed.situations.find((s) => s.id === situationId) ?? null;
}

export async function getOrCreateMoversSituationRead(situationId: string): Promise<MoversSituationRead> {
  const situation = await findSituationById(situationId);
  if (!situation) {
    throw new Error(`Situation not found: ${situationId}`);
  }

  const headlines = await fetchHeadlinesForSituation(situation);
  const selected = pickCatalystHeadline(headlines);
  const newsKey = selected ? buildMoversNewsKey(selected) : situation.newsKey;
  const useWebFallback = shouldRunMoversWebFallback(headlines, selected, situation);

  if (!newsKey && !useWebFallback) {
    return {
      read: "No driving news item — unable to generate a read.",
      posture: "WAIT",
      confidence: "LOW",
      cached: false,
    };
  }

  const cached = newsKey ? await getCachedRead(newsKey) : null;
  if (cached && cached.catalystType && cached.catalystSummary && !useWebFallback) {
    return cached;
  }

  const aiCfg = getMoversAiConfig();
  const provider = normalizeReadProvider(aiCfg.provider);
  const contextBlock = await gatherReadContext(situation, { includeWebSearch: useWebFallback });
  const prompt = buildReadPrompt(
    situation,
    contextBlock,
    situation.catalystType,
    situation.catalyst || selected?.title || "",
  );
  const generated = await callReadLlm(prompt, provider, aiCfg.modelName, aiCfg.temperature);

  if (newsKey) {
    await writeCache(newsKey, generated);
  }

  return generated;
}
