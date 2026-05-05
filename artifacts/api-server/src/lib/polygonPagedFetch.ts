/**
 * Shared paginated GET helper for Polygon REST (used by tape backfill and quote replay).
 *
 * Each HTTP GET uses {@link fetch} with `AbortSignal.timeout(httpMs)` where `httpMs` is
 * `min(httpTimeoutMs option, remaining deadline)` — i.e. **per GET page**, not per OCC symbol
 * and not a single AbortSignal for the whole tape run. Timeouts therefore stack through
 * pagination; callers raise `httpTimeoutMs` for heavy chains (see strategistTapeBackfill).
 */
import { logger } from "./logger.js";
import { appendPolygonApiTraceRecord } from "./polygonApiTrace.js";

/** Upper bound on a single Polygon HTTP round-trip during backfill / replay (override per call for mega names). */
export const POLYGON_PAGED_FETCH_HTTP_MS = 14_000;

export async function fetchPolygonPaged(
  firstUrl: string,
  apiKey: string,
  deadlineMs: number,
  opts?: { httpTimeoutMs?: number },
): Promise<{
  rows: unknown[];
  truncated: boolean;
  sawPolygonHttpError: boolean;
  lowestPolygonHttpStatus: number | null;
}> {
  const rows: unknown[] = [];
  let sawPolygonHttpError = false;
  let lowestPolygonHttpStatus: number | null = null;
  let url: string | null = firstUrl.includes("apiKey=")
    ? firstUrl
    : `${firstUrl}${firstUrl.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(apiKey)}`;
  let truncated = false;
  let paginationPages = 0;
  pageLoop: while (url && Date.now() < deadlineMs) {
    paginationPages += 1;
    const pageUrl = url;
    const pathForTrace = (() => {
      try {
        const u = new URL(pageUrl.replace(/\bapiKey=[^&]+/i, "apiKey=[REDACTED]"));
        return u.pathname + u.search;
      } catch {
        return pageUrl.split("?")[0] ?? pageUrl;
      }
    })();
    const tPageStart = Date.now();
    let pageTimedOut = false;
    let retry429Total = 0;
    let saw429OnPage = false;
    let finalStatus: number | null = null;

    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) break;

    let r: Response | undefined;
    for (let attempt = 0; attempt <= 3; attempt++) {
      const rem = deadlineMs - Date.now();
      if (rem <= 0) {
        truncated = true;
        break pageLoop;
      }
      const httpCap = opts?.httpTimeoutMs ?? POLYGON_PAGED_FETCH_HTTP_MS;
      const httpMs = Math.min(httpCap, Math.max(800, rem));
      try {
        r = await fetch(pageUrl, { signal: AbortSignal.timeout(httpMs) });
      } catch {
        truncated = true;
        pageTimedOut = true;
        appendPolygonApiTraceRecord({
          path: pathForTrace,
          method: "GET",
          statusCode: null,
          responseTimeMs: Date.now() - tPageStart,
          paginationPages,
          retryCountAfter429: retry429Total,
          saw429: saw429OnPage,
          timedOut: true,
        });
        break pageLoop;
      }

      if (r.status !== 429) {
        finalStatus = r.status;
        break;
      }

      saw429OnPage = true;
      retry429Total += 1;

      if (attempt >= 3) {
        logger.warn(
          { attempt: attempt + 1, url: pageUrl.split("?")[0] },
          "fetchPolygonPaged: Polygon 429 after max retries on paginated fetch",
        );
        truncated = true;
        finalStatus = r.status;
        break;
      }

      const ra = r.headers.get("retry-after");
      let delayMs: number;
      if (ra != null && ra.trim() !== "") {
        const sec = parseInt(ra.trim(), 10);
        delayMs = Number.isFinite(sec) && sec >= 0 ? sec * 1000 : Math.min(10_000, 1000 * 2 ** attempt + Math.random() * 500);
      } else {
        delayMs = Math.min(10_000, 1000 * 2 ** attempt + Math.random() * 500);
      }

      const now = Date.now();
      if (now + delayMs > deadlineMs) {
        truncated = true;
        finalStatus = r.status;
        break;
      }

      logger.warn(
        {
          attempt: attempt + 1,
          maxAttempts: 4,
          delayMs: Math.round(delayMs),
          retryAfterHeader: ra,
          url: pageUrl.split("?")[0],
        },
        "fetchPolygonPaged: Polygon 429 on paginated fetch, backing off before retry",
      );
      await new Promise((res) => setTimeout(res, delayMs));
    }

    appendPolygonApiTraceRecord({
      path: pathForTrace,
      method: "GET",
      statusCode: finalStatus,
      responseTimeMs: Date.now() - tPageStart,
      paginationPages,
      retryCountAfter429: retry429Total,
      saw429: saw429OnPage,
      timedOut: pageTimedOut,
    });

    if (!r) {
      truncated = true;
      break;
    }
    if (!r.ok) {
      sawPolygonHttpError = true;
      if (lowestPolygonHttpStatus === null || r.status < lowestPolygonHttpStatus) {
        lowestPolygonHttpStatus = r.status;
      }
      truncated = true;
      break;
    }
    const j = (await r.json()) as { results?: unknown[]; next_url?: string };
    if (Array.isArray(j.results)) rows.push(...j.results);
    if (j.next_url) {
      url = j.next_url.includes("apiKey=") ? j.next_url : `${j.next_url}&apiKey=${encodeURIComponent(apiKey)}`;
    } else {
      url = null;
    }
  }
  if (Date.now() >= deadlineMs && url) truncated = true;
  return { rows, truncated, sawPolygonHttpError, lowestPolygonHttpStatus };
}
