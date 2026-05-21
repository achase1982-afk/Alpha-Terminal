import { logger } from "./logger.js";

export interface WebSearchSource {
  title: string;
  url: string;
  date?: string;
}

export interface WebSearchTrace {
  webSearchUsed: boolean;
  queries: string[];
  sources: WebSearchSource[];
  searchBackend?: "dedicated_api" | "provider_native";
  dedicatedApiEndpoint?: WebSearchApiEndpoint;
}

const DEFAULT_TAVILY_SEARCH_URL = "https://api.tavily.com/search";

export type WebSearchApiEndpoint = "primary" | "fallback";

export interface WebSearchApiConfig {
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

function resolveBaseUrl(override: string): string {
  const trimmed = override.trim();
  return trimmed || DEFAULT_TAVILY_SEARCH_URL;
}

/** True when `WEB_SEARCH_API_KEY` is set (dedicated API is the search backend). */
export function isDedicatedWebSearchApiEnabled(): boolean {
  return Boolean(envTrim("WEB_SEARCH_API_KEY"));
}

export function getPrimaryWebSearchApiConfig(): WebSearchApiConfig | null {
  const apiKey = envTrim("WEB_SEARCH_API_KEY");
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: resolveBaseUrl(envTrim("WEB_SEARCH_API_BASE_URL")),
    endpoint: "primary",
  };
}

export function getFallbackWebSearchApiConfig(): WebSearchApiConfig | null {
  const apiKey = envTrim("WEB_SEARCH_API_FALLBACK_KEY");
  if (!apiKey) return null;
  const primary = getPrimaryWebSearchApiConfig();
  const baseUrl = resolveBaseUrl(
    envTrim("WEB_SEARCH_API_FALLBACK_BASE_URL") || primary?.baseUrl || "",
  );
  return { apiKey, baseUrl, endpoint: "fallback" };
}

export function getWebSearchApiMaxResults(): number {
  return Math.min(20, Math.max(1, envInt("WEB_SEARCH_API_MAX_RESULTS", 8)));
}

export function getWebSearchApiTimeoutMs(): number {
  return Math.min(120_000, Math.max(5_000, envInt("WEB_SEARCH_API_TIMEOUT_MS", 20_000)));
}

/** Pull an explicit query from catalyst/chat-style prompts when present. */
export function extractWebSearchQueryFromPrompt(prompt: string): string {
  const focused = prompt.match(
    /Execute a web search focused on this exact query:\s*(.+?)(?:\n\n|\nSource priority|$)/is,
  );
  if (focused?.[1]?.trim()) return focused[1].trim();
  const trimmed = prompt.trim();
  if (trimmed.length <= 600) return trimmed;
  return trimmed.slice(0, 1200);
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function pickString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function normalizeApiResults(payload: unknown): { sources: WebSearchSource[]; answer: string | null; lines: string[] } {
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
  if (!Array.isArray(results)) {
    return { sources, answer, lines };
  }

  for (const row of results) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const url = pickString(r.url) ?? pickString(r.link);
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    const title = pickString(r.title) ?? url;
    const date =
      pickString(r.published_date) ??
      pickString(r.publishedDate) ??
      pickString(r.date) ??
      undefined;
    sources.push({ title, url, date });
    const snippet =
      pickString(r.content) ??
      pickString(r.snippet) ??
      pickString(r.description) ??
      "";
    if (snippet) {
      lines.push(`- ${title}: ${snippet.slice(0, 500)} (${url})`);
    } else {
      lines.push(`- ${title} (${url})`);
    }
  }

  return { sources, answer, lines };
}

async function postWebSearchRequest(
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
      `Web Search API ${config.endpoint} HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`,
    );
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new Error(`Web Search API ${config.endpoint} returned non-JSON response`);
  }

  const { sources, answer, lines } = normalizeApiResults(payload);
  const queries = [query];

  return {
    trace: {
      webSearchUsed: sources.length > 0 || Boolean(answer?.trim()),
      queries,
      sources,
      searchBackend: "dedicated_api",
      dedicatedApiEndpoint: config.endpoint,
    },
    answer,
    summaryLines: lines,
    endpointUsed: config.endpoint,
  };
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
 * Run a web search through the dedicated Web Search API.
 * Uses `WEB_SEARCH_API_KEY` / `WEB_SEARCH_API_BASE_URL`, then
 * `WEB_SEARCH_API_FALLBACK_KEY` / `WEB_SEARCH_API_FALLBACK_BASE_URL` on failure.
 */
export async function executeDedicatedWebSearch(
  query: string,
  signal?: AbortSignal,
): Promise<DedicatedWebSearchResult> {
  const q = query.trim();
  if (!q) {
    throw new Error("Web search query is empty");
  }

  const primary = getPrimaryWebSearchApiConfig();
  if (!primary) {
    throw new Error("WEB_SEARCH_API_KEY not configured");
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
        primaryBaseUrl: primary.baseUrl,
        fallbackBaseUrl: fallback.baseUrl,
        error: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
      },
      "Web Search API primary failed; trying fallback",
    );
    try {
      return await postWebSearchRequest(fallback, q, signal);
    } catch (fallbackErr) {
      logger.error(
        {
          op: "web_search_api_fallback_failed",
          error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
        },
        "Web Search API fallback also failed",
      );
      throw fallbackErr;
    }
  }
}

export function formatDedicatedWebSearchContextBlock(result: DedicatedWebSearchResult): string {
  const parts: string[] = [
    "## WEB SEARCH RESULTS (dedicated API)",
    `Query: ${result.trace.queries[0] ?? ""}`,
    `Endpoint: ${result.endpointUsed}`,
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
