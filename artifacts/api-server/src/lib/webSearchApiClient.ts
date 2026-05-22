import { logger } from "./logger.js";

export interface WebSearchSource {
  title: string;
  url: string;
  date?: string;
}

export type WebSearchProviderName = "tavily" | "serper";

export interface WebSearchTrace {
  webSearchUsed: boolean;
  queries: string[];
  sources: WebSearchSource[];
  searchBackend?: "dedicated_api" | "provider_native";
  dedicatedApiEndpoint?: WebSearchApiEndpoint;
  /** Which vendor served this search (Tavily primary, Serper fallback). */
  dedicatedApiProvider?: WebSearchProviderName;
}

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const SERPER_SEARCH_URL = "https://google.serper.dev/search";

/** Tavily rejects queries longer than 400 characters (HTTP 400). */
export const TAVILY_MAX_QUERY_CHARS = 400;

export type WebSearchApiEndpoint = "primary" | "fallback";

export interface WebSearchApiConfig {
  provider: WebSearchProviderName;
  apiKey: string;
  baseUrl: string;
  endpoint: WebSearchApiEndpoint;
}

export interface DedicatedWebSearchResult {
  trace: WebSearchTrace;
  /** Optional synthesized answer from the search provider (e.g. Tavily include_answer). */
  answer: string | null;
  /** Bullet-friendly lines built from result snippets. */
  summaryLines: string[];
  endpointUsed: WebSearchApiEndpoint;
  providerUsed: WebSearchProviderName;
}

function envTrim(name: string): string {
  return (process.env[name] ?? "").trim();
}

function envInt(name: string, fallback: number): number {
  const raw = envTrim(name);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function firstNonEmpty(...names: string[]): string {
  for (const name of names) {
    const v = envTrim(name);
    if (v) return v;
  }
  return "";
}

/**
 * Dedicated web search is on when the Tavily key is set.
 * `WEB_SEARCH_API_KEY` is accepted as a legacy alias for `TAVILY_API_KEY`.
 */
export function isDedicatedWebSearchApiEnabled(): boolean {
  return Boolean(firstNonEmpty("TAVILY_API_KEY", "WEB_SEARCH_API_KEY"));
}

/** Primary: Tavily (`TAVILY_API_KEY`). */
export function getPrimaryWebSearchApiConfig(): WebSearchApiConfig | null {
  const apiKey = firstNonEmpty("TAVILY_API_KEY", "WEB_SEARCH_API_KEY");
  if (!apiKey) return null;
  const baseUrl = envTrim("TAVILY_API_BASE_URL") || envTrim("WEB_SEARCH_API_BASE_URL") || TAVILY_SEARCH_URL;
  return {
    provider: "tavily",
    apiKey,
    baseUrl,
    endpoint: "primary",
  };
}

/** Fallback: Serper (`SERPER_API_KEY`). */
export function getFallbackWebSearchApiConfig(): WebSearchApiConfig | null {
  const apiKey = firstNonEmpty("SERPER_API_KEY", "WEB_SEARCH_API_FALLBACK_KEY");
  if (!apiKey) return null;
  const baseUrl =
    envTrim("SERPER_API_BASE_URL") ||
    envTrim("WEB_SEARCH_API_FALLBACK_BASE_URL") ||
    SERPER_SEARCH_URL;
  return {
    provider: "serper",
    apiKey,
    baseUrl,
    endpoint: "fallback",
  };
}

export function getWebSearchApiMaxResults(): number {
  return Math.min(20, Math.max(1, envInt("WEB_SEARCH_API_MAX_RESULTS", 8)));
}

export function getWebSearchApiTimeoutMs(): number {
  return Math.min(120_000, Math.max(5_000, envInt("WEB_SEARCH_API_TIMEOUT_MS", 20_000)));
}

/** Truncate to provider max length, preferring a word boundary when possible. */
export function clampWebSearchQuery(query: string, maxLen = TAVILY_MAX_QUERY_CHARS): string {
  const trimmed = query.trim();
  if (trimmed.length <= maxLen) return trimmed;
  const slice = trimmed.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > maxLen * 0.6) return slice.slice(0, lastSpace).trim();
  return slice.trim();
}

function extractTickerFromPrompt(prompt: string): string | null {
  const jsonMatch = prompt.match(/"ticker"\s*:\s*"([A-Za-z0-9.-]+)"/i);
  if (jsonMatch?.[1]?.trim()) return jsonMatch[1].trim().toUpperCase();
  const runMatch = prompt.match(
    /(?:analyze this ticker|recommend the best trade|Ticker)\s*[:\s]+([A-Z][A-Z0-9.-]{0,9})\b/i,
  );
  if (runMatch?.[1]?.trim()) return runMatch[1].trim().toUpperCase();
  return null;
}

function buildTickerFocusedWebSearchQuery(ticker: string): string {
  const y = new Date().getUTCFullYear();
  return clampWebSearchQuery(
    `${ticker} stock news catalyst earnings analyst price target options implied volatility ${y}`,
  );
}

/** Pull an explicit query from catalyst/chat-style prompts when present. */
export function extractWebSearchQueryFromPrompt(prompt: string): string {
  const focused = prompt.match(
    /Execute a web search focused on this exact query:\s*(.+?)(?:\n\n|\nSource priority|$)/is,
  );
  if (focused?.[1]?.trim()) return clampWebSearchQuery(focused[1].trim());

  const ticker = extractTickerFromPrompt(prompt);
  if (ticker) return buildTickerFocusedWebSearchQuery(ticker);

  return clampWebSearchQuery(prompt);
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function pickString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function pushResultRow(
  row: Record<string, unknown>,
  sources: WebSearchSource[],
  lines: string[],
  seenUrls: Set<string>,
): void {
  const url = pickString(row.url) ?? pickString(row.link);
  if (!url || seenUrls.has(url)) return;
  seenUrls.add(url);
  const title = pickString(row.title) ?? url;
  const date =
    pickString(row.published_date) ??
    pickString(row.publishedDate) ??
    pickString(row.date) ??
    undefined;
  sources.push({ title, url, date });
  const snippet =
    pickString(row.content) ?? pickString(row.snippet) ?? pickString(row.description) ?? "";
  if (snippet) {
    lines.push(`- ${title}: ${snippet.slice(0, 500)} (${url})`);
  } else {
    lines.push(`- ${title} (${url})`);
  }
}

function normalizeTavilyResults(payload: unknown): { sources: WebSearchSource[]; answer: string | null; lines: string[] } {
  const sources: WebSearchSource[] = [];
  const seenUrls = new Set<string>();
  const lines: string[] = [];
  let answer: string | null = null;

  if (!payload || typeof payload !== "object") {
    return { sources, answer, lines };
  }

  const root = payload as Record<string, unknown>;
  answer = pickString(root.answer) ?? pickString(root.summary);

  const results = root.results;
  if (Array.isArray(results)) {
    for (const row of results) {
      if (!row || typeof row !== "object") continue;
      pushResultRow(row as Record<string, unknown>, sources, lines, seenUrls);
    }
  }

  return { sources, answer, lines };
}

function normalizeSerperResults(payload: unknown): { sources: WebSearchSource[]; answer: string | null; lines: string[] } {
  const sources: WebSearchSource[] = [];
  const seenUrls = new Set<string>();
  const lines: string[] = [];

  if (!payload || typeof payload !== "object") {
    return { sources, answer: null, lines };
  }

  const root = payload as Record<string, unknown>;
  const answer =
    pickString((root.answerBox as Record<string, unknown> | undefined)?.answer) ??
    pickString((root.answerBox as Record<string, unknown> | undefined)?.snippet) ??
    null;

  const organic = root.organic;
  if (Array.isArray(organic)) {
    for (const row of organic) {
      if (!row || typeof row !== "object") continue;
      pushResultRow(row as Record<string, unknown>, sources, lines, seenUrls);
    }
  }

  return { sources, answer, lines };
}

function buildTrace(
  query: string,
  config: WebSearchApiConfig,
  sources: WebSearchSource[],
  answer: string | null,
): WebSearchTrace {
  return {
    webSearchUsed: sources.length > 0 || Boolean(answer?.trim()),
    queries: [query],
    sources,
    searchBackend: "dedicated_api",
    dedicatedApiEndpoint: config.endpoint,
    dedicatedApiProvider: config.provider,
  };
}

async function postTavilySearch(
  config: WebSearchApiConfig,
  query: string,
  signal?: AbortSignal,
): Promise<DedicatedWebSearchResult> {
  const maxResults = getWebSearchApiMaxResults();
  const timeoutMs = getWebSearchApiTimeoutMs();
  const body = {
    api_key: config.apiKey,
    query,
    max_results: maxResults,
    include_answer: true,
    search_depth: "basic",
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (config.apiKey.startsWith("tvly-")) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const res = await fetch(config.baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    const err = new Error(
      `Tavily HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`,
    );
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }

  const payload = await res.json();
  const { sources, answer, lines } = normalizeTavilyResults(payload);
  return {
    trace: buildTrace(query, config, sources, answer),
    answer,
    summaryLines: lines,
    endpointUsed: config.endpoint,
    providerUsed: "tavily",
  };
}

async function postSerperSearch(
  config: WebSearchApiConfig,
  query: string,
  signal?: AbortSignal,
): Promise<DedicatedWebSearchResult> {
  const maxResults = getWebSearchApiMaxResults();
  const timeoutMs = getWebSearchApiTimeoutMs();

  const res = await fetch(config.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-API-KEY": config.apiKey,
    },
    body: JSON.stringify({ q: query, num: maxResults }),
    signal: signal ?? AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    const err = new Error(
      `Serper HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`,
    );
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }

  const payload = await res.json();
  const { sources, answer, lines } = normalizeSerperResults(payload);
  return {
    trace: buildTrace(query, config, sources, answer),
    answer,
    summaryLines: lines,
    endpointUsed: config.endpoint,
    providerUsed: "serper",
  };
}

async function postWebSearchRequest(
  config: WebSearchApiConfig,
  query: string,
  signal?: AbortSignal,
): Promise<DedicatedWebSearchResult> {
  if (config.provider === "serper") {
    return postSerperSearch(config, query, signal);
  }
  return postTavilySearch(config, query, signal);
}

function shouldTryFallback(err: unknown): boolean {
  if (!getFallbackWebSearchApiConfig()) return false;
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status?: number }).status;
    if (typeof status === "number") {
      return isRetryableHttpStatus(status);
    }
  }
  return true;
}

/**
 * Tavily (primary) then Serper (fallback).
 * Keys: `TAVILY_API_KEY`, `SERPER_API_KEY`.
 */
export async function executeDedicatedWebSearch(
  query: string,
  signal?: AbortSignal,
): Promise<DedicatedWebSearchResult> {
  const q = clampWebSearchQuery(query);
  if (!q) {
    throw new Error("Web search query is empty");
  }

  const primary = getPrimaryWebSearchApiConfig();
  if (!primary) {
    throw new Error("TAVILY_API_KEY not configured");
  }

  try {
    return await postWebSearchRequest(primary, q, signal);
  } catch (primaryErr) {
    const fallback = getFallbackWebSearchApiConfig();
    if (!fallback || !shouldTryFallback(primaryErr)) {
      throw primaryErr;
    }
    logger.warn(
      {
        op: "web_search_api_fallback",
        primaryProvider: primary.provider,
        fallbackProvider: fallback.provider,
        error: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
      },
      "Tavily web search failed; trying Serper fallback",
    );
    try {
      return await postWebSearchRequest(fallback, q, signal);
    } catch (fallbackErr) {
      logger.error(
        {
          op: "web_search_api_fallback_failed",
          error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
        },
        "Serper web search fallback also failed",
      );
      throw fallbackErr;
    }
  }
}

export function formatDedicatedWebSearchContextBlock(result: DedicatedWebSearchResult): string {
  const providerLabel = result.providerUsed === "tavily" ? "Tavily" : "Serper";
  const parts: string[] = [
    "## WEB SEARCH RESULTS (dedicated API)",
    `Query: ${result.trace.queries[0] ?? ""}`,
    `Provider: ${providerLabel} (${result.endpointUsed})`,
  ];
  if (result.answer?.trim()) {
    parts.push("", "Summary:", result.answer.trim());
  }
  if (result.summaryLines.length > 0) {
    parts.push("", "Sources:", ...result.summaryLines);
  } else if (result.trace.sources.length > 0) {
    parts.push(
      "",
      "Sources:",
      ...result.trace.sources.map((s) => `- ${s.title} (${s.url})`),
    );
  } else {
    parts.push("", "(No web results returned for this query.)");
  }
  return parts.join("\n");
}

export function augmentPromptWithDedicatedWebSearch(
  prompt: string,
  searchBlock: string,
): string {
  return `${searchBlock}\n\n---\n\n${prompt}`;
}

/** Format API hits as chat tool output (no extra LLM round-trip). */
export function formatDedicatedWebSearchForChat(result: DedicatedWebSearchResult): string {
  if (result.answer?.trim()) {
    return result.answer.trim();
  }
  if (result.summaryLines.length > 0) {
    return result.summaryLines.join("\n");
  }
  if (result.trace.sources.length > 0) {
    return result.trace.sources.map((s) => `- ${s.title}: ${s.url}`).join("\n");
  }
  return "No web results found for this query.";
}
