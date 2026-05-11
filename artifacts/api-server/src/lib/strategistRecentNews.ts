import { logger } from "./logger.js";
import {
  fetchFinnhubNews,
  fetchPolygonNews,
  fetchVendorPrimaryNews,
  type NormalizedArticle,
} from "./tickerNewsAggregated.js";
import { fetchEdgarFilings, type EdgarFiling } from "../routes/sec.js";

const SUMMARY_MAX = 280;

export type StrategistRecentNewsFetchStatus = "ok" | "error";

export interface StrategistRecentNewsItem {
  id: string | null;
  source: string;
  publishedAt: string;
  title: string;
  summary: string | null;
  filingType: string | null;
}

export interface StrategistRecentNewsPayload {
  asOf: string;
  lookbackDays: number;
  itemCount: number;
  items: StrategistRecentNewsItem[];
  fetchStatus: StrategistRecentNewsFetchStatus;
}

const SEC_FORM_LABELS: Record<string, string> = {
  "8-K": "Current Report",
  "10-Q": "Quarterly Report",
  "10-K": "Annual Report",
};

function secHeadline(symbol: string, f: EdgarFiling): string {
  const label = SEC_FORM_LABELS[f.formType] || f.formType;
  return `${symbol.toUpperCase()} — ${f.formType}: ${label}`;
}

/** Truncate at nearest word boundary; total length including U+2026 ellipsis never exceeds maxLen. */
export function truncateSummaryWordBoundary(text: string | null | undefined, maxLen: number): string | null {
  if (text == null) return null;
  const t = text.trim();
  if (t.length === 0) return null;
  if (t.length <= maxLen) return t;
  const budget = maxLen - 1;
  const slice = t.slice(0, budget + 1);
  const lastSpace = slice.lastIndexOf(" ", budget);
  const cut = lastSpace > budget * 0.5 ? lastSpace : budget;
  const out = t.slice(0, cut).trimEnd();
  return `${out}…`;
}

function mapBenzingaWireSource(): "benzinga" {
  return "benzinga";
}

function mapPolygonWireSource(): "polygon" {
  return "polygon";
}

function mapFinnhubWireSource(raw: string): string {
  const r = (raw || "").trim().toLowerCase();
  if (!r) return "finnhub_company_news";
  if (r.includes("yahoo")) return "yahoo";
  return r.replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 48) || "aggregator";
}

function dedupeRestByHeadline(items: StrategistRecentNewsItem[]): StrategistRecentNewsItem[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    const k = it.title.toLowerCase().slice(0, 80);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function toSecItems(
  symbol: string,
  filings: EdgarFiling[],
  cutoffMs: number,
  perSourceLimit: number,
): StrategistRecentNewsItem[] {
  return filings
    .map((f) => {
      const ts = new Date(f.filedAt + "T16:00:00Z").getTime();
      return { f, ts };
    })
    .filter(({ ts }) => Number.isFinite(ts) && ts >= cutoffMs)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, perSourceLimit)
    .map(({ f, ts }) => {
      const desc = f.description && f.description !== f.formType ? f.description : null;
      return {
        id: f.accessionNo || f.id || null,
        source: "sec_edgar",
        publishedAt: new Date(ts).toISOString(),
        title: secHeadline(symbol, f),
        summary: truncateSummaryWordBoundary(desc, SUMMARY_MAX),
        filingType: f.formType || null,
      };
    });
}

function toPolygonItems(articles: NormalizedArticle[], cutoffMs: number, perSourceLimit: number): StrategistRecentNewsItem[] {
  return articles
    .filter((a) => Number.isFinite(a.datetime) && a.datetime * 1000 >= cutoffMs)
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, perSourceLimit)
    .map((a) => ({
      id: String(a.id),
      source: mapPolygonWireSource(),
      publishedAt: new Date(a.datetime * 1000).toISOString(),
      title: a.headline,
      summary: truncateSummaryWordBoundary(a.summary || null, SUMMARY_MAX),
      filingType: null,
    }));
}

function toBenzingaItems(articles: NormalizedArticle[], cutoffMs: number, perSourceLimit: number): StrategistRecentNewsItem[] {
  return articles
    .filter((a) => Number.isFinite(a.datetime) && a.datetime * 1000 >= cutoffMs)
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, perSourceLimit)
    .map((a) => ({
      id: String(a.id),
      source: mapBenzingaWireSource(),
      publishedAt: new Date(a.datetime * 1000).toISOString(),
      title: a.headline,
      summary: truncateSummaryWordBoundary(a.summary || null, SUMMARY_MAX),
      filingType: null,
    }));
}

function toFinnhubItems(articles: NormalizedArticle[], cutoffMs: number, perSourceLimit: number): StrategistRecentNewsItem[] {
  return articles
    .filter((a) => Number.isFinite(a.datetime) && a.datetime * 1000 >= cutoffMs)
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, perSourceLimit)
    .map((a) => ({
      id: String(a.id),
      source: mapFinnhubWireSource(a.source),
      publishedAt: new Date(a.datetime * 1000).toISOString(),
      title: a.headline,
      summary: truncateSummaryWordBoundary(a.summary || null, SUMMARY_MAX),
      filingType: null,
    }));
}

function mergeSecFirst(sec: StrategistRecentNewsItem[], rest: StrategistRecentNewsItem[], maxTotal: number): StrategistRecentNewsItem[] {
  const r = dedupeRestByHeadline(rest).sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
  while (sec.length + r.length > maxTotal && r.length > 0) {
    r.pop();
  }
  return [...sec, ...r];
}

export interface GetRecentNewsForTickerOptions {
  lookbackDays: number;
  perSourceLimit: number;
  /** Snapshot timestamp (caller supplies end-of-build ISO time). */
  asOf: string;
}

/**
 * Unified recent news for strategist data_package.catalyst.recentNews.
 * Calls the same upstream paths as the NEWS tab (SEC + Polygon + Benzinga + Finnhub), in-process — no HTTP self-calls.
 */
export async function getRecentNewsForTicker(
  ticker: string,
  options: GetRecentNewsForTickerOptions,
  log: Pick<typeof logger, "warn" | "info" | "error"> = logger,
): Promise<StrategistRecentNewsPayload> {
  const { lookbackDays, perSourceLimit, asOf } = options;
  const symbol = ticker.toUpperCase().replace(/^\$/, "");
  const cutoffMs = Date.now() - lookbackDays * 86_400_000;
  const maxTotal = 12;
  const signal = AbortSignal.timeout(2000);

  const emptyError = (): StrategistRecentNewsPayload => ({
    asOf,
    lookbackDays,
    itemCount: 0,
    items: [],
    fetchStatus: "error",
  });

  try {
    const polygonKey = process.env["POLYGON_API_KEY"];
    const vendorPrimaryKey = process.env["BENZ" + "INGA_API_KEY"];
    const finnhubKey = process.env["FINNHUB_API_KEY"];

    const settled = await Promise.allSettled([
      fetchEdgarFilings(symbol, log, signal),
      polygonKey ? fetchPolygonNews(symbol, polygonKey, log, signal, true) : Promise.resolve([] as NormalizedArticle[]),
      vendorPrimaryKey ? fetchVendorPrimaryNews(symbol, vendorPrimaryKey, log, signal, true) : Promise.resolve([] as NormalizedArticle[]),
      finnhubKey ? fetchFinnhubNews(symbol, finnhubKey, log, signal, true) : Promise.resolve([] as NormalizedArticle[]),
    ]);

    const secFilings: EdgarFiling[] = settled[0].status === "fulfilled" ? settled[0].value : [];
    if (settled[0].status === "rejected") {
      log.warn({ err: settled[0].reason, symbol }, "strategistRecentNews: SEC filings rejected");
    }

    const polygonArts: NormalizedArticle[] = settled[1].status === "fulfilled" ? settled[1].value : [];
    if (settled[1].status === "rejected") {
      log.warn({ err: settled[1].reason, symbol }, "strategistRecentNews: Polygon news rejected");
    }

    const vendorArts: NormalizedArticle[] = settled[2].status === "fulfilled" ? settled[2].value : [];
    if (settled[2].status === "rejected") {
      log.warn({ err: settled[2].reason, symbol }, "strategistRecentNews: vendor news rejected");
    }

    const finnArts: NormalizedArticle[] = settled[3].status === "fulfilled" ? settled[3].value : [];
    if (settled[3].status === "rejected") {
      log.warn({ err: settled[3].reason, symbol }, "strategistRecentNews: Finnhub news rejected");
    }

    if (settled.every((s) => s.status === "rejected")) {
      log.warn({ symbol }, "strategistRecentNews: all news sources failed");
      return emptyError();
    }

    const secItems = toSecItems(symbol, secFilings, cutoffMs, perSourceLimit);
    const polygonItems = toPolygonItems(polygonArts, cutoffMs, perSourceLimit);
    const benzingaItems = toBenzingaItems(vendorArts, cutoffMs, perSourceLimit);
    const finnhubItems = toFinnhubItems(finnArts, cutoffMs, perSourceLimit);

    const rest = [...polygonItems, ...benzingaItems, ...finnhubItems];
    const items = mergeSecFirst(secItems, rest, maxTotal);

    return {
      asOf,
      lookbackDays,
      itemCount: items.length,
      items,
      fetchStatus: "ok",
    };
  } catch (err) {
    log.error({ err, symbol }, "strategistRecentNews: pipeline failed");
    return emptyError();
  }
}
