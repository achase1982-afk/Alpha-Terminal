import pLimit from "p-limit";
import { getFmpApiKeyOrThrow, FMP_HTTP_CONCURRENCY } from "../fmpClient.js";
import type { Situation } from "@workspace/movers-types";

const FMP_STABLE_BASE = "https://financialmodelingprep.com/stable";
const FMP_V3_BASE = "https://financialmodelingprep.com/api/v3";
const httpLimit = pLimit(FMP_HTTP_CONCURRENCY);
const HEADLINES_PER_SYMBOL = 8;

export interface MoversNewsHeadline {
  symbol: string;
  publishedAt: string;
  title: string;
  source: string;
  kind: "news" | "press_release";
}

function pickString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function normaliseHeadline(
  raw: Record<string, unknown>,
  symbol: string,
  kind: MoversNewsHeadline["kind"],
): MoversNewsHeadline | null {
  const title = pickString(raw["title"]) ?? pickString(raw["headline"]);
  if (!title) return null;
  const publishedAt =
    pickString(raw["publishedDate"]) ??
    pickString(raw["date"]) ??
    pickString(raw["published_at"]) ??
    "";
  const source = pickString(raw["site"]) ?? pickString(raw["publisher"]) ?? pickString(raw["source"]) ?? "";
  return { symbol, publishedAt, title, source, kind };
}

async function fetchJsonArray(url: string): Promise<Record<string, unknown>[]> {
  const res = await httpLimit(() =>
    fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) }),
  );
  if (!res.ok) return [];
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data.filter((x): x is Record<string, unknown> => x != null && typeof x === "object");
}

async function fetchStockNews(symbol: string): Promise<MoversNewsHeadline[]> {
  const apiKey = getFmpApiKeyOrThrow();
  const sym = symbol.toUpperCase();
  const stableUrl =
    `${FMP_STABLE_BASE}/news/stock?symbols=${encodeURIComponent(sym)}` +
    `&limit=${HEADLINES_PER_SYMBOL}&apikey=${encodeURIComponent(apiKey)}`;
  let rows = await fetchJsonArray(stableUrl);
  if (rows.length === 0) {
    const v3Url =
      `${FMP_V3_BASE}/stock_news?tickers=${encodeURIComponent(sym)}` +
      `&limit=${HEADLINES_PER_SYMBOL}&apikey=${encodeURIComponent(apiKey)}`;
    rows = await fetchJsonArray(v3Url);
  }
  const out: MoversNewsHeadline[] = [];
  for (const row of rows) {
    const h = normaliseHeadline(row, sym, "news");
    if (h) out.push(h);
  }
  return out;
}

async function fetchPressReleases(symbol: string): Promise<MoversNewsHeadline[]> {
  const apiKey = getFmpApiKeyOrThrow();
  const sym = symbol.toUpperCase();
  const stableUrl =
    `${FMP_STABLE_BASE}/press-releases?symbol=${encodeURIComponent(sym)}` +
    `&limit=${HEADLINES_PER_SYMBOL}&apikey=${encodeURIComponent(apiKey)}`;
  let rows = await fetchJsonArray(stableUrl);
  if (rows.length === 0) {
    const v3Url =
      `${FMP_V3_BASE}/press-releases/${encodeURIComponent(sym)}` +
      `?limit=${HEADLINES_PER_SYMBOL}&apikey=${encodeURIComponent(apiKey)}`;
    rows = await fetchJsonArray(v3Url);
  }
  const out: MoversNewsHeadline[] = [];
  for (const row of rows) {
    const h = normaliseHeadline(row, sym, "press_release");
    if (h) out.push(h);
  }
  return out;
}

/** Recent news and press releases for all tickers in a situation (deduped by title). */
export async function fetchHeadlinesForSituation(situation: Situation): Promise<MoversNewsHeadline[]> {
  const symbols = [...new Set(situation.tickers.map((t) => t.symbol.toUpperCase()))];
  const byTitle = new Map<string, MoversNewsHeadline>();

  await Promise.all(
    symbols.map(async (sym) => {
      const [news, releases] = await Promise.all([fetchStockNews(sym), fetchPressReleases(sym)]);
      for (const h of [...news, ...releases]) {
        const key = h.title.toLowerCase();
        if (!byTitle.has(key)) byTitle.set(key, h);
      }
    }),
  );

  return [...byTitle.values()].slice(0, 24);
}

export function formatHeadlinesForPrompt(headlines: MoversNewsHeadline[]): string {
  if (headlines.length === 0) return "(no recent headlines returned)";
  return headlines
    .map((h) => {
      const when = h.publishedAt ? `[${h.publishedAt}] ` : "";
      const src = h.source ? ` (${h.source})` : "";
      const kind = h.kind === "press_release" ? "PR" : "NEWS";
      return `- ${kind} ${h.symbol}: ${when}${h.title}${src}`;
    })
    .join("\n");
}
