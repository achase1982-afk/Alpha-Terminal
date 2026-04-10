import { logger } from "./logger.js";
import { emitTelemetry } from "./telemetryStore.js";

const POLYGON_API_KEY = process.env.POLYGON_API_KEY ?? "";

const MIN_ADDV = 20_000_000;
const MIN_PRICE = 5;
const MIN_OPTIONS_VOLUME = 1_000;
const MIN_OPTIONS_OI = 10_000;
const TARGET_UNIVERSE_SIZE = 383;
const MIN_PER_SECTOR = 25;
const MAX_SECTOR_PCT = 0.28;

const SECTOR_TARGETS: Record<string, number> = {
  "Information Technology": 50,
  "Health Care": 45,
  "Financials": 45,
  "Industrials": 40,
  "Consumer Discretionary": 35,
  "Communication Services": 30,
  "Energy": 30,
  "Consumer Staples": 20,
  "Materials": 20,
  "Utilities": 15,
  "Real Estate": 15,
};

const SECTOR_SHORTHAND: Record<string, string> = {
  "Information Technology": "TECH",
  "Health Care": "HEALTHCARE",
  "Financials": "FINANCIALS",
  "Industrials": "INDUSTRIALS",
  "Energy": "ENERGY",
  "Consumer Discretionary": "CONS_DISCRETIONARY",
  "Consumer Staples": "CONS_STAPLES",
  "Communication Services": "COMM_SERVICES",
  "Materials": "MATERIALS",
  "Utilities": "UTILITIES",
  "Real Estate": "REAL_ESTATE",
};

const SUB_SECTOR_BUCKETS: Record<string, { label: string; sic_patterns: string[]; gics_patterns: string[]; maxSize: number }> = {
  TOP_SEMIS: {
    label: "Top Semiconductors",
    sic_patterns: ["semiconductor"],
    gics_patterns: ["Semiconductors"],
    maxSize: 30,
  },
  TOP_DEFENSE: {
    label: "Top Defense / Aerospace",
    sic_patterns: ["aerospace", "defense", "guided missile"],
    gics_patterns: ["Aerospace & Defense"],
    maxSize: 20,
  },
  TOP_BIOTECH: {
    label: "Top Biotech",
    sic_patterns: ["biological", "pharmaceutical", "medicinal"],
    gics_patterns: ["Biotechnology", "Pharmaceuticals"],
    maxSize: 30,
  },
  TOP_BANKS: {
    label: "Top Banks",
    sic_patterns: ["national commercial banks", "state commercial banks"],
    gics_patterns: ["Diversified Banks", "Regional Banks"],
    maxSize: 25,
  },
  TOP_SOFTWARE: {
    label: "Top Software",
    sic_patterns: ["prepackaged software", "computer programming"],
    gics_patterns: ["Systems Software", "Application Software"],
    maxSize: 30,
  },
  TOP_OIL_GAS: {
    label: "Top Oil & Gas",
    sic_patterns: ["crude petroleum", "natural gas", "petroleum refin"],
    gics_patterns: ["Oil & Gas Exploration", "Oil & Gas Refining", "Integrated Oil"],
    maxSize: 20,
  },
};

const SIC_TO_SECTOR: Record<string, string> = {
  "prepackaged software": "Information Technology",
  "computer programming": "Information Technology",
  "semiconductor": "Information Technology",
  "electronic computer": "Information Technology",
  "computer peripheral": "Information Technology",
  "computer integrated systems": "Information Technology",
  "computer storage": "Information Technology",
  "computer communication": "Information Technology",
  "calculating & accounting": "Information Technology",
  "electronic components": "Information Technology",
  "printed circuit boards": "Information Technology",
  "household audio & video": "Information Technology",
  "search, detection, navigation": "Information Technology",
  "telephone & telegraph apparatus": "Information Technology",
  "radio & tv broadcasting": "Communication Services",
  "cable & other pay television": "Communication Services",
  "motion picture": "Communication Services",
  "newspaper": "Communication Services",
  "book publishing": "Communication Services",
  "advertising services": "Communication Services",
  "services-computer processing": "Information Technology",
  "information retrieval": "Information Technology",
  "computer processing": "Information Technology",
  "data processing": "Information Technology",
  "pharmaceutical preparation": "Health Care",
  "biological": "Health Care",
  "surgical & medical": "Health Care",
  "electromedical": "Health Care",
  "orthopedic": "Health Care",
  "dental equipment": "Health Care",
  "diagnostic substance": "Health Care",
  "hospital": "Health Care",
  "medicinal": "Health Care",
  "medical laboratories": "Health Care",
  "health services": "Health Care",
  "services-health": "Health Care",
  "services-medical": "Health Care",
  "in vitro": "Health Care",
  "x-ray apparatus": "Health Care",
  "national commercial banks": "Financials",
  "state commercial banks": "Financials",
  "savings institution": "Financials",
  "personal credit": "Financials",
  "mortgage banker": "Financials",
  "security brokers": "Financials",
  "security & commodity": "Financials",
  "fire, marine & casualty insurance": "Financials",
  "life insurance": "Financials",
  "accident & health insurance": "Financials",
  "insurance agent": "Financials",
  "investment advice": "Financials",
  "finance services": "Financials",
  "investors, nec": "Financials",
  "real estate investment trusts": "Real Estate",
  "real estate": "Real Estate",
  "operators of apartment": "Real Estate",
  "crude petroleum": "Energy",
  "natural gas": "Energy",
  "petroleum refin": "Energy",
  "pipeline": "Energy",
  "drilling oil": "Energy",
  "oil & gas field": "Energy",
  "electric services": "Utilities",
  "gas distribution": "Utilities",
  "water supply": "Utilities",
  "combination utility": "Utilities",
  "cogeneration": "Utilities",
  "aerospace": "Industrials",
  "defense": "Industrials",
  "guided missile": "Industrials",
  "aircraft": "Industrials",
  "ship building": "Industrials",
  "railroad": "Industrials",
  "trucking": "Industrials",
  "air transportation": "Industrials",
  "industrial machinery": "Industrials",
  "farm machinery": "Industrials",
  "construction machinery": "Industrials",
  "general industrial": "Industrials",
  "special industry": "Industrials",
  "metalworking": "Industrials",
  "measuring & controlling": "Industrials",
  "services-management consulting": "Industrials",
  "services-engineering": "Industrials",
  "refuse systems": "Industrials",
  "motor vehicle": "Consumer Discretionary",
  "retail-eating places": "Consumer Discretionary",
  "retail-apparel": "Consumer Discretionary",
  "retail-home furniture": "Consumer Discretionary",
  "retail-variety stores": "Consumer Discretionary",
  "hotel": "Consumer Discretionary",
  "amusement": "Consumer Discretionary",
  "department store": "Consumer Discretionary",
  "auto dealers": "Consumer Discretionary",
  "retail-catalog": "Consumer Discretionary",
  "retail-building materials": "Consumer Discretionary",
  "services-amusement": "Consumer Discretionary",
  "retail-retail stores": "Consumer Discretionary",
  "retail-family clothing": "Consumer Discretionary",
  "footwear": "Consumer Discretionary",
  "retail-drug": "Consumer Staples",
  "retail-grocery": "Consumer Staples",
  "beverages": "Consumer Staples",
  "canned, frozen": "Consumer Staples",
  "dairy products": "Consumer Staples",
  "meat packing": "Consumer Staples",
  "grain mill": "Consumer Staples",
  "soap & detergent": "Consumer Staples",
  "tobacco": "Consumer Staples",
  "perfumes": "Consumer Staples",
  "sugar": "Consumer Staples",
  "household furniture": "Consumer Staples",
  "paper mill": "Materials",
  "steel works": "Materials",
  "primary smelting": "Materials",
  "chemical": "Materials",
  "plastics": "Materials",
  "glass products": "Materials",
  "cement": "Materials",
  "gold mining": "Materials",
  "copper ores": "Materials",
  "mining": "Materials",
  "fertilizers": "Materials",
  "industrial gases": "Materials",
  "paints": "Materials",
};

interface TickerInfo {
  ticker: string;
  name: string;
  market_cap: number;
  sic_description: string;
  sector: string;
  industry: string;
  addv: number;
  last_price: number;
  options_volume: number;
  options_oi: number;
  has_options: boolean;
}

export interface UniverseSnapshot {
  symbols: string[];
  bySector: Record<string, string[]>;
  sectorCounts: Record<string, number>;
  subSectorBuckets: Record<string, string[]>;
  buildTimestamp: string;
  totalCandidates: number;
  changesFromPrevious?: { added: string[]; removed: string[] };
}

let currentSnapshot: UniverseSnapshot | null = null;
let buildInProgress = false;

export function getUniverseSnapshot(): UniverseSnapshot | null {
  return currentSnapshot;
}

async function polygonFetch(url: string, retries = 3): Promise<any> {
  const sep = url.includes("?") ? "&" : "?";
  const fullUrl = `${url}${sep}apiKey=${POLYGON_API_KEY}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(fullUrl, { signal: AbortSignal.timeout(60_000) });

    if (res.status === 429 && attempt < retries) {
      const backoff = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 10000);
      logger.warn({ url: url.split("?")[0], attempt, backoffMs: Math.round(backoff) }, "Universe builder: Polygon 429, backing off");
      await new Promise(r => setTimeout(r, backoff));
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Polygon ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  throw new Error("Polygon fetch exhausted retries");
}

function classifySector(sic: string): string {
  const sicLower = sic.toLowerCase();
  for (const [pattern, sector] of Object.entries(SIC_TO_SECTOR)) {
    if (sicLower.includes(pattern)) return sector;
  }
  return "";
}

function getPreviousTradingDay(): string {
  const now = new Date();
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() - 1);
  }
  return d.toISOString().split("T")[0];
}

async function fetchGroupedBars(): Promise<Map<string, { close: number; volume: number; addv: number }>> {
  const date = getPreviousTradingDay();
  logger.info({ date }, "Universe builder: fetching grouped daily bars");

  const data = await polygonFetch(`https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true`);
  const results = data.results ?? [];

  const map = new Map<string, { close: number; volume: number; addv: number }>();
  for (const r of results) {
    if (!r.T) continue;
    const ticker = r.T;
    if (ticker.includes(".") || ticker.length > 5) continue;
    const close = r.c ?? 0;
    const volume = r.v ?? 0;
    const addv = close * volume;
    if (close >= MIN_PRICE && addv >= MIN_ADDV * 0.3) {
      map.set(ticker, { close, volume, addv });
    }
  }

  logger.info({ rawBars: results.length, afterPreFilter: map.size, date }, "Universe builder: grouped bars fetched");
  return map;
}

async function fetchTickerNames(): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  let nextUrl: string | null = `https://api.polygon.io/v3/reference/tickers?market=stocks&type=CS&active=true&limit=1000&order=asc&sort=ticker`;
  let pages = 0;
  const MAX_PAGES = 15;

  while (nextUrl && pages < MAX_PAGES) {
    pages++;
    try {
      const data = await polygonFetch(nextUrl);
      for (const t of data.results ?? []) {
        if (t.ticker && t.name) names.set(t.ticker, t.name);
      }
      nextUrl = data.next_url ?? null;
      if ((data.results ?? []).length < 1000) break;
    } catch (err: any) {
      logger.warn({ err: err.message, page: pages }, "Universe builder: reference tickers page fetch failed");
      break;
    }
  }

  logger.info({ totalNames: names.size, pages }, "Universe builder: ticker names fetched");
  return names;
}

async function enrichTickerDetails(tickers: TickerInfo[]): Promise<void> {
  const top = tickers.slice(0, 800);

  const batchSize = 5;
  let enriched = 0;
  let errors = 0;

  for (let i = 0; i < top.length; i += batchSize) {
    const batch = top.slice(i, i + batchSize);
    const promises = batch.map(async (t) => {
      try {
        const data = await polygonFetch(`https://api.polygon.io/v3/reference/tickers/${t.ticker}`);
        const r = data.results;
        if (r) {
          t.name = r.name ?? t.name;
          t.market_cap = r.market_cap ?? 0;
          t.sic_description = (r.sic_description ?? "").toLowerCase();
          t.sector = classifySector(t.sic_description);
          if (r.industry) t.industry = r.industry;
          enriched++;
        }
      } catch {
        errors++;
      }
    });

    await Promise.all(promises);

    if (i + batchSize < top.length) {
      await new Promise(r => setTimeout(r, 250));
    }
  }

  logger.info({ enriched, errors, total: top.length }, "Universe builder: ticker details enriched");
}

async function enrichOptionsData(tickers: TickerInfo[]): Promise<void> {
  const candidates = tickers
    .filter(t => t.last_price >= MIN_PRICE && t.addv >= MIN_ADDV * 0.5 && t.sector !== "")
    .slice(0, 600);

  const batchSize = 5;
  let enriched = 0;

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const promises = batch.map(async (t) => {
      try {
        const data = await polygonFetch(
          `https://api.polygon.io/v3/snapshot/options/${t.ticker}?limit=1`
        );
        const results = data.results ?? [];
        if (results.length > 0 || (data.results_count ?? 0) > 0) {
          t.has_options = true;
          t.options_volume = Math.max(data.results_count ?? 0, MIN_OPTIONS_VOLUME);
          t.options_oi = results.reduce((sum: number, r: any) => sum + (r.open_interest ?? 0), MIN_OPTIONS_OI);
          enriched++;
        }
      } catch {
        if (t.market_cap > 2_000_000_000) {
          t.has_options = true;
          t.options_volume = MIN_OPTIONS_VOLUME;
          t.options_oi = MIN_OPTIONS_OI;
        }
      }
    });

    await Promise.all(promises);

    if (i + batchSize < candidates.length) {
      await new Promise(r => setTimeout(r, 250));
    }
  }

  logger.info({ enriched, totalCandidates: candidates.length }, "Universe builder: options data enrichment complete");
}

function applyBaseFilters(tickers: TickerInfo[]): TickerInfo[] {
  return tickers.filter(t => {
    if (t.last_price < MIN_PRICE) return false;
    if (t.addv < MIN_ADDV) return false;
    if (!t.has_options) return false;
    if (t.options_volume < MIN_OPTIONS_VOLUME && t.options_oi < MIN_OPTIONS_OI) return false;
    if (!t.sector || t.sector === "") return false;
    return true;
  });
}

function buildSectorUniverse(filtered: TickerInfo[]): { symbols: string[]; bySector: Record<string, string[]>; sectorCounts: Record<string, number> } {
  const bySector: Record<string, TickerInfo[]> = {};
  for (const t of filtered) {
    const sector = t.sector;
    if (!SECTOR_TARGETS[sector]) continue;
    if (!bySector[sector]) bySector[sector] = [];
    bySector[sector].push(t);
  }

  for (const sector of Object.keys(bySector)) {
    bySector[sector].sort((a, b) => {
      if (a.market_cap > 0 && b.market_cap > 0) {
        const capDiff = b.market_cap - a.market_cap;
        if (Math.abs(capDiff) > 1_000_000_000) return capDiff;
      }
      return b.addv - a.addv;
    });
  }

  const selected: Record<string, string[]> = {};
  const selectedSet = new Set<string>();

  for (const [sector, target] of Object.entries(SECTOR_TARGETS)) {
    const candidates = bySector[sector] ?? [];
    const take = Math.min(target, candidates.length);
    selected[sector] = candidates.slice(0, take).map(t => t.ticker);
    for (const sym of selected[sector]) selectedSet.add(sym);
  }

  let total = selectedSet.size;

  if (total > TARGET_UNIVERSE_SIZE) {
    const maxPerSector = Math.floor(TARGET_UNIVERSE_SIZE * MAX_SECTOR_PCT);
    for (const sector of Object.keys(selected)) {
      while (selected[sector].length > maxPerSector && selected[sector].length > MIN_PER_SECTOR && total > TARGET_UNIVERSE_SIZE) {
        const removed = selected[sector].pop()!;
        selectedSet.delete(removed);
        total--;
      }
    }

    const sectorsBySize = Object.entries(selected).sort((a, b) => b[1].length - a[1].length);
    for (const [, syms] of sectorsBySize) {
      while (syms.length > MIN_PER_SECTOR && total > TARGET_UNIVERSE_SIZE) {
        const removed = syms.pop()!;
        selectedSet.delete(removed);
        total--;
      }
    }
  }

  if (total < TARGET_UNIVERSE_SIZE) {
    const remainder = filtered
      .filter(t => !selectedSet.has(t.ticker) && SECTOR_TARGETS[t.sector])
      .sort((a, b) => b.addv - a.addv || b.market_cap - a.market_cap);

    for (const t of remainder) {
      if (total >= TARGET_UNIVERSE_SIZE) break;
      const sector = t.sector;
      const sectorList = selected[sector] ?? [];
      const maxForSector = Math.floor(TARGET_UNIVERSE_SIZE * MAX_SECTOR_PCT);
      if (sectorList.length >= maxForSector) continue;

      if (!selected[sector]) selected[sector] = [];
      selected[sector].push(t.ticker);
      selectedSet.add(t.ticker);
      total++;
    }
  }

  const symbols = [...selectedSet].sort();
  const sectorCounts: Record<string, number> = {};
  for (const [sector, syms] of Object.entries(selected)) {
    sectorCounts[sector] = syms.length;
  }

  return { symbols, bySector: selected, sectorCounts };
}

function buildSubSectorBuckets(filtered: TickerInfo[]): Record<string, string[]> {
  const buckets: Record<string, string[]> = {};

  for (const [key, config] of Object.entries(SUB_SECTOR_BUCKETS)) {
    const matches = filtered.filter(t => {
      for (const pat of config.sic_patterns) {
        if (t.sic_description.includes(pat)) return true;
      }
      for (const pat of config.gics_patterns) {
        if (t.industry.includes(pat)) return true;
      }
      return false;
    });

    matches.sort((a, b) => {
      if (a.market_cap > 0 && b.market_cap > 0) return b.market_cap - a.market_cap;
      return b.addv - a.addv;
    });
    buckets[key] = matches.slice(0, config.maxSize).map(t => t.ticker);
  }

  return buckets;
}

export async function buildCoreOptionsUniverse(): Promise<UniverseSnapshot> {
  if (buildInProgress) {
    logger.warn("Universe builder: build already in progress, skipping");
    if (currentSnapshot) return currentSnapshot;
    throw new Error("Build in progress and no cached snapshot");
  }

  buildInProgress = true;
  const startTime = Date.now();

  try {
    logger.info("Universe builder: starting Core Balanced 383 build");

    const barsMap = await fetchGroupedBars();

    const namesMap = await fetchTickerNames();

    const tickers: TickerInfo[] = [];
    for (const [ticker, bar] of barsMap) {
      tickers.push({
        ticker,
        name: namesMap.get(ticker) ?? "",
        market_cap: 0,
        sic_description: "",
        sector: "",
        industry: "",
        addv: bar.addv,
        last_price: bar.close,
        options_volume: 0,
        options_oi: 0,
        has_options: false,
      });
    }

    tickers.sort((a, b) => b.addv - a.addv);

    logger.info({ totalCandidates: tickers.length }, "Universe builder: merged bars + names");

    await enrichTickerDetails(tickers);

    const withSector = tickers.filter(t => t.sector !== "").length;
    logger.info({ withSector, withoutSector: tickers.length - withSector }, "Universe builder: sector classification summary");

    await enrichOptionsData(tickers);

    const filtered = applyBaseFilters(tickers);
    logger.info({ passedFilters: filtered.length }, "Universe builder: base filters applied");

    const { symbols, bySector, sectorCounts } = buildSectorUniverse(filtered);

    const subSectorBuckets = buildSubSectorBuckets(filtered);

    const previousSymbols = currentSnapshot?.symbols ?? [];
    const previousSet = new Set(previousSymbols);
    const currentSet = new Set(symbols);
    const added = symbols.filter(s => !previousSet.has(s));
    const removed = previousSymbols.filter(s => !currentSet.has(s));

    const snapshot: UniverseSnapshot = {
      symbols,
      bySector,
      sectorCounts,
      subSectorBuckets,
      buildTimestamp: new Date().toISOString(),
      totalCandidates: filtered.length,
      changesFromPrevious: previousSymbols.length > 0 ? { added, removed } : undefined,
    };

    currentSnapshot = snapshot;

    const elapsed = Date.now() - startTime;

    const sectorSummary = Object.entries(sectorCounts)
      .map(([s, c]) => `${SECTOR_SHORTHAND[s] ?? s}=${c}`)
      .join(", ");

    const bucketSummary = Object.entries(subSectorBuckets)
      .map(([k, v]) => `${k}=${v.length}`)
      .join(", ");

    logger.info(
      { totalSymbols: symbols.length, sectorCounts, subSectorBuckets: Object.fromEntries(Object.entries(subSectorBuckets).map(([k, v]) => [k, v.length])), elapsedMs: elapsed },
      `Universe builder: Core Balanced build complete — ${symbols.length} symbols`
    );
    logger.info(`Universe sectors: ${sectorSummary} | total=${symbols.length}`);
    logger.info(`Universe sub-sectors: ${bucketSummary}`);

    if (snapshot.changesFromPrevious) {
      logger.info({ added: added.length, removed: removed.length, addedSymbols: added.slice(0, 20), removedSymbols: removed.slice(0, 20) }, "Universe builder: changes from previous build");
    }

    emitTelemetry("SCANNER", "INFO", `Universe build complete: CORE_383_BALANCED — ${symbols.length} symbols`, {
      type: "UNIVERSE_BUILD",
      name: "CORE_383_BALANCED",
      totalCount: symbols.length,
      sectorCounts,
      buildTimestamp: snapshot.buildTimestamp,
      elapsedMs: elapsed,
      symbols: symbols.slice().sort(),
    });

    return snapshot;
  } catch (err: any) {
    logger.error({ err: err.message }, "Universe builder: build failed");
    emitTelemetry("SCANNER", "ERROR", `Universe build failed: ${err.message}`, { error: err.message });
    throw err;
  } finally {
    buildInProgress = false;
  }
}

let rebuildInterval: ReturnType<typeof setInterval> | null = null;

export function startUniverseRebuildSchedule() {
  buildCoreOptionsUniverse().catch(err => {
    logger.error({ err: err.message }, "Universe builder: initial build failed");
  });

  const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000;
  rebuildInterval = setInterval(() => {
    buildCoreOptionsUniverse().catch(err => {
      logger.error({ err: err.message }, "Universe builder: scheduled rebuild failed");
    });
  }, WEEKLY_MS);

  logger.info("Universe builder: weekly rebuild schedule started");
}

export function stopUniverseRebuildSchedule() {
  if (rebuildInterval) {
    clearInterval(rebuildInterval);
    rebuildInterval = null;
  }
}
