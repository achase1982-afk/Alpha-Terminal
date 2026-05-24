import { z } from "zod";
import type { MoversConfidence, MoversPosture, MoversSituationRead, Situation } from "@workspace/movers-types";
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
import { fetchHeadlinesForSituation, formatHeadlinesForPrompt } from "./fmpMoversNews.js";
import { getLatestMoversFeed } from "./moversFeedStore.js";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const THIN_HEADLINE_COUNT = 2;

const ReadSchema = z.object({
  read: z.string(),
  posture: z.enum(["WATCH", "WAIT", "PASS"]),
  confidence: z.enum(["HIGH", "MED", "LOW"]),
});

const READ_SYSTEM_PROMPT = `You are a trading desk analyst writing a one-line read for a movers situation.
You receive pre-gathered context only — do not search or invent facts beyond the context.
Respond with JSON only:
{
  "read": "one-line risk and timing verdict",
  "posture": "WATCH" | "WAIT" | "PASS",
  "confidence": "HIGH" | "MED" | "LOW"
}`;

export type MoversReadAiProvider = "anthropic" | "google" | "openai";

function normalizeReadProvider(provider: AiLabModelProvider): MoversReadAiProvider {
  if (provider === "anthropic" || provider === "google" || provider === "openai") return provider;
  return "anthropic";
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
  return {
    read: row.read,
    posture: row.posture as MoversPosture,
    confidence: row.confidence as MoversConfidence,
    cached: true,
  };
}

async function writeCache(newsKey: string, payload: MoversSituationRead): Promise<void> {
  await db
    .insert(moversCatalystCacheTable)
    .values({
      newsKey,
      read: payload.read,
      posture: payload.posture,
      confidence: payload.confidence,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: moversCatalystCacheTable.newsKey,
      set: {
        read: payload.read,
        posture: payload.posture,
        confidence: payload.confidence,
        createdAt: new Date(),
      },
    });
  await pruneOldCacheEntries();
}

function buildReadPrompt(situation: Situation, contextBlock: string): string {
  const tickerLines = situation.tickers
    .map((t) => {
      return `- ${t.symbol} (${t.name}): $${t.price.toFixed(2)}, ${t.changePct >= 0 ? "+" : ""}${t.changePct.toFixed(2)}%`;
    })
    .join("\n");

  return `Situation: ${situation.kind === "cluster" ? `cluster "${situation.label}"` : situation.id}
Catalyst type (deterministic): ${situation.catalystType}
Catalyst summary: ${situation.catalyst || "(none)"}

Tickers:
${tickerLines}

Context:
${contextBlock}`;
}

async function gatherReadContext(situation: Situation): Promise<string> {
  const headlines = await fetchHeadlinesForSituation(situation);
  const fmpBlock = formatHeadlinesForPrompt(headlines);
  const parts = [`FMP news:\n${fmpBlock}`];

  if (headlines.length < THIN_HEADLINE_COUNT && isDedicatedWebSearchApiEnabled()) {
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
  if (!situation.newsKey) {
    return {
      read: "No driving news item — unable to generate a read.",
      posture: "WAIT",
      confidence: "LOW",
      cached: false,
    };
  }

  const cached = await getCachedRead(situation.newsKey);
  if (cached) return cached;

  const aiCfg = getMoversAiConfig();
  const provider = normalizeReadProvider(aiCfg.provider);
  const contextBlock = await gatherReadContext(situation);
  const prompt = buildReadPrompt(situation, contextBlock);
  const generated = await callReadLlm(prompt, provider, aiCfg.modelName, aiCfg.temperature);
  await writeCache(situation.newsKey, generated);
  return generated;
}
