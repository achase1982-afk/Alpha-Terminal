import type { ComponentType } from "react";

/** Views that must re-issue `import()` on Retry (not React.lazy promise cache). */
export type FreshImportViewName = "Portfolio" | "News" | "Options" | "Order ticket";

export type ChunkImportLogEntry = {
  viewName: string;
  attempt: number;
  buildId: string;
  mode: "primary" | "cache-bust";
  url?: string;
  httpStatus?: number;
  ok: boolean;
  ts: number;
};

declare global {
  interface Window {
    __AT_CHUNK_IMPORT_LOG?: ChunkImportLogEntry[];
    __AT_BUILD_ID?: string;
  }
}

declare const __AT_BUILD_ID__: string | undefined;

const CHUNK_URL_PATTERNS: Record<FreshImportViewName, RegExp> = {
  Portfolio: /PortfolioView[^/?#]*\.js/i,
  News: /NewsTab[^/?#]*\.js/i,
  Options: /OptionsTab[^/?#]*\.js/i,
  "Order ticket": /OrderTicket[^/?#]*\.js/i,
};

const lastFailedChunkUrl = new Map<FreshImportViewName, string>();

export function getAppBuildId(): string {
  if (typeof __AT_BUILD_ID__ !== "undefined" && __AT_BUILD_ID__) return __AT_BUILD_ID__;
  if (typeof document !== "undefined") {
    const meta = document.querySelector('meta[name="at-build-id"]');
    const fromMeta = meta?.getAttribute("content");
    if (fromMeta) return fromMeta;
  }
  return "dev";
}

function publishBuildId(): void {
  if (typeof window === "undefined") return;
  window.__AT_BUILD_ID = getAppBuildId();
}

export function readChunkImportLog(): ChunkImportLogEntry[] {
  if (typeof window === "undefined") return [];
  return window.__AT_CHUNK_IMPORT_LOG ? [...window.__AT_CHUNK_IMPORT_LOG] : [];
}

function appendChunkImportLog(entry: Omit<ChunkImportLogEntry, "buildId" | "ts">): void {
  if (typeof window === "undefined") return;
  publishBuildId();
  const row: ChunkImportLogEntry = {
    ...entry,
    buildId: getAppBuildId(),
    ts: Date.now(),
  };
  const log = window.__AT_CHUNK_IMPORT_LOG ?? [];
  log.push(row);
  window.__AT_CHUNK_IMPORT_LOG = log;
}

/** Pull a chunk script URL from an import error or PerformanceResourceTiming. */
export function inferChunkUrlFromFailure(viewName: FreshImportViewName, err?: unknown): string | null {
  const msg = err instanceof Error ? err.message : err != null ? String(err) : "";
  const abs = msg.match(/(https?:\/\/[^\s)'"]+\.js[^\s)'"]*)/i);
  if (abs?.[1]) return abs[1].split("?")[0] ?? abs[1];
  const rel = msg.match(/(\/assets\/[^\s)'"]+\.js[^\s)'"]*)/i);
  if (rel?.[1]) return rel[1].split("?")[0] ?? rel[1];

  const pattern = CHUNK_URL_PATTERNS[viewName];
  if (typeof performance === "undefined") return null;
  const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  for (let i = entries.length - 1; i >= 0; i--) {
    const name = entries[i]?.name;
    if (name && pattern.test(name)) return name.split("?")[0] ?? name;
  }
  return null;
}

export function buildCacheBustedChunkUrl(baseUrl: string, attempt: number): string {
  const buildId = getAppBuildId();
  const absolute = baseUrl.startsWith("http")
    ? baseUrl
    : `${typeof window !== "undefined" ? window.location.origin : ""}${baseUrl}`;
  const sep = absolute.includes("?") ? "&" : "?";
  return `${absolute}${sep}atRetry=${attempt}&atBuild=${encodeURIComponent(buildId)}&t=${Date.now()}`;
}

async function probeChunkHttpStatus(url: string): Promise<number | undefined> {
  if (typeof fetch === "undefined") return undefined;
  try {
    const res = await fetch(url, { cache: "no-store", credentials: "same-origin" });
    return res.status;
  } catch {
    return undefined;
  }
}

async function importViaCacheBust(
  viewName: FreshImportViewName,
  attempt: number,
  baseUrl: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  normalize: (mod: Record<string, unknown>) => { default: ComponentType<any> },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ default: ComponentType<any> }> {
  const busted = buildCacheBustedChunkUrl(baseUrl, attempt);
  const httpStatus = await probeChunkHttpStatus(busted);
  try {
    const mod = (await import(/* @vite-ignore */ busted)) as Record<string, unknown>;
    const normalized = normalize(mod);
    appendChunkImportLog({
      viewName,
      attempt,
      mode: "cache-bust",
      url: busted,
      httpStatus,
      ok: true,
    });
    return normalized;
  } catch (err) {
    appendChunkImportLog({
      viewName,
      attempt,
      mode: "cache-bust",
      url: busted,
      httpStatus,
      ok: false,
    });
    throw err;
  }
}

/**
 * Factory: attempt 0 uses Vite's static `import()`; retries use a new URL so the browser fetches again.
 */
export function createFreshViewImportRunner(
  viewName: FreshImportViewName,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  primary: () => Promise<{ default: ComponentType<any> }>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  normalizeFromChunk: (mod: Record<string, unknown>) => { default: ComponentType<any> },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): (attempt: number) => Promise<{ default: ComponentType<any> }> {
  return async (attempt: number) => {
    publishBuildId();
    if (attempt === 0) {
      try {
        const mod = await primary();
        appendChunkImportLog({ viewName, attempt, mode: "primary", ok: true });
        return mod;
      } catch (err) {
        const url =
          inferChunkUrlFromFailure(viewName, err) ?? inferChunkUrlFromFailure(viewName);
        if (url) lastFailedChunkUrl.set(viewName, url);
        appendChunkImportLog({ viewName, attempt, mode: "primary", url: url ?? undefined, ok: false });
        throw err;
      }
    }

    const remembered = lastFailedChunkUrl.get(viewName);
    const url = remembered ?? inferChunkUrlFromFailure(viewName);
    if (!url) {
      appendChunkImportLog({ viewName, attempt, mode: "primary", ok: false });
      return primary();
    }

    return importViaCacheBust(viewName, attempt, url, normalizeFromChunk);
  };
}