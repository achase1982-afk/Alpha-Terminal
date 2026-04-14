import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { scannerWatchlistsTable, scannerScreensTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { runFmpScreen, type ScreenFilters } from "../lib/fmpScreener.js";
import { runDynamicScreener } from "../lib/schwabDynamicScreener.js";
import { getBestAccessToken } from "../lib/tokenStore.js";
import { getAuth } from "@clerk/express";
import { getUniverseSnapshot, buildCoreOptionsUniverse, type UniverseSnapshot } from "../lib/universeBuilder.js";
import { LIQUID_CORE_SYMBOLS } from "../data/liquidCore130.js";

const router: IRouter = Router();

const DEV_BYPASS = process.env.DEV_BYPASS_AUTH === "true";
const DEV_USER_ID = "dev_user";

function getUserId(req: any): string {
  if (DEV_BYPASS) return DEV_USER_ID;
  try {
    const auth = getAuth(req);
    return auth?.userId ?? DEV_USER_ID;
  } catch {
    return DEV_USER_ID;
  }
}

const PRESET_UNIVERSES: Record<string, { label: string; description: string; symbols: string[] }> = {
  liquidCore130: {
    label: "Liquid Core 130",
    description: "130 ultra-liquid, options-tradable names across 9 sectors — primary scan universe",
    symbols: [...LIQUID_CORE_SYMBOLS],
  },
  midcap200: {
    label: "Mid-Cap 200",
    description: "~200 options-liquid mid-cap stocks ($2B–$10B market cap)",
    symbols: [
      // Tech / SaaS / Growth
      "AFRM","ALTR","AMBA","ASAN","BILL","BRZE","CFLT","DOCN","DOMO","DUOL",
      "ESTC","FROG","GTLB","HIMS","INST","JAMF","MNDY","NCNO","PCOR","QLYS",
      "Q2","RELY","ROKU","RAMP","SNAP","SOFI","STEP","TOST","WK","WIX",
      "ZI","ALKT","LMND","OPEN","SEMR","SITM","SMTC","YEXT","PEGA","EVBG",
      // Healthcare / Biotech
      "ACAD","ALNY","ARWR","AXSM","BHVN","BMRN","CLDX","DNLI","EXAS","EXEL",
      "GKOS","HALO","IMVT","INSP","INSM","IRTC","KRTX","LGND","MGNX","NBIX",
      "NTRA","NVCR","PCVX","PRCT","RARE","RCUS","RXRX","SMMT","SRPT","TMDX",
      "VKTX","VRDN","VERV","NKTR","CGEM","ROIV","SNDX","KRYS","LIVN","OMCL",
      // Consumer / Retail / Leisure
      "BROS","CAVA","CHEF","DKNG","ELF","ETSY","FNKO","GO","JACK","LEVI",
      "SFM","XPOF","ARKO","CAKE","DENN","FIVE","HRB","PTON","DKS","RCII",
      "MODV","SHLS","NCLH","WINGSTOP","PRKS","BJRI","EXPR","COUR","PLBY","ACMR",
      // Finance / Insurance / Fintech
      "CBSH","FNB","SNV","WBS","ESNT","RDN","MTG","PFSI","CADE","CFR",
      "PNFP","WSFS","NBHC","BANR","ONB","HWC","BOKF","BXMT","HCI","KNSL",
      // Industrials / Defense / Aerospace
      "KTOS","BWXT","DRS","MOOG","TGI","VSE","IRDM","ITRI","GNTX","ITT",
      "NOVT","TREX","EXPO","STRL","IESC","ICFI","AAON","GFF","BEPC","SKYW",
      // Energy / Materials
      "ARCH","CHRD","CIVI","MNRL","NOG","RRC","SM","WTTR","WFRD","VTLE",
      "WHD","REPX","PTEN","DINO","GPOR","CRK","MGY","CC","CMC","OLN",
      // Real Estate
      "COLD","NNN","SKT","APLE","CTRE","INN","PDM","PEB","SAFE","SVC",
      // Additional options-liquid mid-caps
      "NVST","GMED","IDCC","MSA","MEDP","MHO","LGIH","CWH","MGNI","RSKD",
      "IPGP","IOVA","TRS","KWR","TROX","BCO","TMHC","MTH","CARG","KVYO",
    ],
  },
};

const SECTOR_SHORTHAND_REVERSE: Record<string, string> = {
  "Information Technology": "TOP_TECH",
  "Health Care": "TOP_HEALTHCARE",
  "Financials": "TOP_FINANCIALS",
  "Industrials": "TOP_INDUSTRIALS",
  "Energy": "TOP_ENERGY",
  "Consumer Discretionary": "TOP_CONS_DISC",
  "Consumer Staples": "TOP_CONS_STAPLES",
  "Communication Services": "TOP_COMM_SVCS",
  "Materials": "TOP_MATERIALS",
  "Utilities": "TOP_UTILITIES",
  "Real Estate": "TOP_REAL_ESTATE",
};

const SECTOR_LABELS: Record<string, string> = {
  "Information Technology": "Top Tech",
  "Health Care": "Top Healthcare",
  "Financials": "Top Financials",
  "Industrials": "Top Industrials",
  "Energy": "Top Energy",
  "Consumer Discretionary": "Top Consumer Disc.",
  "Consumer Staples": "Top Consumer Staples",
  "Communication Services": "Top Comm. Services",
  "Materials": "Top Materials",
  "Utilities": "Top Utilities",
  "Real Estate": "Top Real Estate",
};

function loadPresets(): Record<string, { label: string; description: string; symbols: string[] }> {
  const combined: Record<string, { label: string; description: string; symbols: string[] }> = { ...PRESET_UNIVERSES };

  const snap = getUniverseSnapshot();
  if (snap && snap.symbols.length > 0) {
    combined.core383 = {
      label: "Core Balanced 383",
      description: `${snap.symbols.length} sector-balanced, options-liquid stocks (built ${new Date(snap.buildTimestamp).toLocaleDateString()})`,
      symbols: snap.symbols,
    };

    for (const [sector, syms] of Object.entries(snap.bySector)) {
      const key = SECTOR_SHORTHAND_REVERSE[sector];
      if (key && syms.length > 0) {
        combined[key.toLowerCase()] = {
          label: SECTOR_LABELS[sector] ?? sector,
          description: `${syms.length} top options-liquid ${sector} stocks`,
          symbols: syms,
        };
      }
    }

    for (const [key, syms] of Object.entries(snap.subSectorBuckets)) {
      if (syms.length > 0) {
        const label = key.replace("TOP_", "Top ").replace(/_/g, " ");
        combined[key.toLowerCase()] = {
          label,
          description: `${syms.length} top ${label.toLowerCase()} stocks by market cap`,
          symbols: syms,
        };
      }
    }
  }

  return combined;
}

router.get("/universes", (_req, res) => {
  const presets = loadPresets();
  const result: Record<string, { label: string; description: string; count: number }> = {};
  for (const [key, val] of Object.entries(presets)) {
    result[key] = { label: val.label, description: val.description, count: val.symbols.length };
  }
  res.json({ presets: result });
});

const PRESET_ALIASES: Record<string, string> = {
  sp500: "liquidCore130",
  sp100: "liquidCore130",
  ndx100: "liquidCore130",
};

router.get("/universes/:key/symbols", (req, res) => {
  const presets = loadPresets();
  const resolvedKey = PRESET_ALIASES[req.params.key] ?? req.params.key;
  const preset = presets[resolvedKey];
  if (!preset) return res.status(404).json({ error: "Preset not found" });
  res.json({ key: resolvedKey, label: preset.label, symbols: preset.symbols });
});

router.get("/universe/snapshot", (_req, res) => {
  const snap = getUniverseSnapshot();
  if (!snap) return res.json({ built: false, message: "Universe not yet built" });
  res.json({
    built: true,
    totalSymbols: snap.symbols.length,
    sectorCounts: snap.sectorCounts,
    subSectorCounts: Object.fromEntries(Object.entries(snap.subSectorBuckets).map(([k, v]) => [k, v.length])),
    buildTimestamp: snap.buildTimestamp,
    totalCandidates: snap.totalCandidates,
    changesFromPrevious: snap.changesFromPrevious,
  });
});

router.post("/universe/rebuild", async (req, res) => {
  const adminKey = process.env.ADMIN_API_KEY;
  if (adminKey && req.headers["x-admin-key"] !== adminKey) {
    return res.status(403).json({ error: "Unauthorized" });
  }
  try {
    const snap = await buildCoreOptionsUniverse();
    res.json({
      ok: true,
      totalSymbols: snap.symbols.length,
      sectorCounts: snap.sectorCounts,
      buildTimestamp: snap.buildTimestamp,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


router.post("/watchlists/seed", async (req, res) => {
  const userId = getUserId(req);
  try {
    const existing = await db.select().from(scannerWatchlistsTable).where(eq(scannerWatchlistsTable.userId, userId));
    const existingNames = new Set(existing.map(w => w.name));

    const seedWatchlists = [
      { name: "Earnings Plays", symbols: ["AAPL", "TSLA", "NVDA"] },
      { name: "High Volatility", symbols: ["INTU", "DOW", "AMZN", "ACN", "INTC", "CRM", "BKNG", "ORCL", "LOW", "COP", "ADBE", "CHTR", "IBM", "CVX", "GE", "CSCO", "AMGN", "HD", "HON", "NKE"] },
      { name: "Top Movers Today", symbols: ["AAPL", "ABBV", "ABT", "ABNB", "ACN", "ADBE", "ADI", "ADM", "ADP", "ADSK", "AEE", "AEP", "AES", "AFL", "AIG", "AIZ", "AJG", "AKAM", "ALB", "ALGN", "ALK", "ALL", "ALLE", "AMAT", "AMCR", "AMD", "AME", "AMGN", "AMP", "AMT", "AMZN", "ANET", "AON", "AOS", "APA", "APD", "APH", "APTV", "ARE", "ATO", "AVGO", "AVY", "AWK", "AXP", "AZO", "BA", "BAC", "BAX", "BBWI", "BBY"] },
      { name: "Volume Surge", symbols: ["INTC", "NVDA", "MU", "TSLA", "NKE", "AMZN", "MSFT", "NOW", "ORCL", "OXY", "GLW", "GOOGL", "AMD", "AVGO", "NFLX", "OGN", "AAPL", "META", "CCL", "GOOG", "XOM", "NEM", "PFE", "PYPL", "WDC", "LRCX", "CVX", "T", "ABT", "AMAT", "TER", "CRM", "LUMN", "ADBE", "FCX", "GIS", "MOS", "FTNT", "APA", "VZ", "STX", "BAC", "UNH", "QCOM", "NCLH", "INTU", "WMT", "KO", "ANET", "MRNA"] },
    ];

    const created: string[] = [];
    for (const wl of seedWatchlists) {
      if (existingNames.has(wl.name)) continue;
      await db.insert(scannerWatchlistsTable).values({
        userId,
        name: wl.name,
        symbols: wl.symbols,
        isProtected: false,
      });
      created.push(wl.name);
    }

    res.json({ seeded: created, skipped: seedWatchlists.filter(w => existingNames.has(w.name)).map(w => w.name) });
  } catch (err: any) {
    logger.error({ err }, "Failed to seed watchlists");
    res.status(500).json({ error: err.message });
  }
});

router.get("/watchlists", async (req, res) => {
  const userId = getUserId(req);
  try {
    const rows = await db.select().from(scannerWatchlistsTable).where(eq(scannerWatchlistsTable.userId, userId));
    if (rows.length === 0) {
      const [fav] = await db.insert(scannerWatchlistsTable).values({
        userId,
        name: "Favorites",
        symbols: [],
        isProtected: true,
      }).returning();
      return res.json({ watchlists: [fav] });
    }
    res.json({ watchlists: rows });
  } catch (err) {
    logger.error({ err }, "Failed to fetch watchlists");
    res.status(500).json({ error: "Failed to fetch watchlists" });
  }
});

router.post("/watchlists", async (req, res) => {
  const userId = getUserId(req);
  const { name, symbols } = req.body;
  if (!name || typeof name !== "string") return res.status(400).json({ error: "Name required" });
  try {
    const [wl] = await db.insert(scannerWatchlistsTable).values({
      userId,
      name: name.trim(),
      symbols: Array.isArray(symbols) ? symbols : [],
      isProtected: false,
    }).returning();
    res.json({ watchlist: wl });
  } catch (err) {
    logger.error({ err }, "Failed to create watchlist");
    res.status(500).json({ error: "Failed to create watchlist" });
  }
});

router.patch("/watchlists/:id", async (req, res) => {
  const userId = getUserId(req);
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

  try {
    const [existing] = await db.select().from(scannerWatchlistsTable)
      .where(and(eq(scannerWatchlistsTable.id, id), eq(scannerWatchlistsTable.userId, userId)));
    if (!existing) return res.status(404).json({ error: "Watchlist not found" });

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (req.body.name && typeof req.body.name === "string" && !existing.isProtected) {
      updates.name = req.body.name.trim();
    }
    if (Array.isArray(req.body.symbols)) {
      updates.symbols = req.body.symbols;
    }

    const [updated] = await db.update(scannerWatchlistsTable)
      .set(updates)
      .where(and(eq(scannerWatchlistsTable.id, id), eq(scannerWatchlistsTable.userId, userId)))
      .returning();
    res.json({ watchlist: updated });
  } catch (err) {
    logger.error({ err }, "Failed to update watchlist");
    res.status(500).json({ error: "Failed to update watchlist" });
  }
});

router.post("/watchlists/:id/symbols", async (req, res) => {
  const userId = getUserId(req);
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  const { symbol } = req.body;
  if (!symbol || typeof symbol !== "string") return res.status(400).json({ error: "Symbol required" });

  try {
    const [existing] = await db.select().from(scannerWatchlistsTable)
      .where(and(eq(scannerWatchlistsTable.id, id), eq(scannerWatchlistsTable.userId, userId)));
    if (!existing) return res.status(404).json({ error: "Watchlist not found" });

    const syms = existing.symbols as string[];
    const upper = symbol.toUpperCase().trim();
    if (syms.includes(upper)) return res.json({ watchlist: existing });

    const [updated] = await db.update(scannerWatchlistsTable)
      .set({ symbols: [...syms, upper], updatedAt: new Date() })
      .where(and(eq(scannerWatchlistsTable.id, id), eq(scannerWatchlistsTable.userId, userId)))
      .returning();
    res.json({ watchlist: updated });
  } catch (err) {
    logger.error({ err }, "Failed to add symbol");
    res.status(500).json({ error: "Failed to add symbol" });
  }
});

router.delete("/watchlists/:id/symbols/:symbol", async (req, res) => {
  const userId = getUserId(req);
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

  try {
    const [existing] = await db.select().from(scannerWatchlistsTable)
      .where(and(eq(scannerWatchlistsTable.id, id), eq(scannerWatchlistsTable.userId, userId)));
    if (!existing) return res.status(404).json({ error: "Watchlist not found" });

    const syms = (existing.symbols as string[]).filter(s => s !== req.params.symbol.toUpperCase());
    const [updated] = await db.update(scannerWatchlistsTable)
      .set({ symbols: syms, updatedAt: new Date() })
      .where(and(eq(scannerWatchlistsTable.id, id), eq(scannerWatchlistsTable.userId, userId)))
      .returning();
    res.json({ watchlist: updated });
  } catch (err) {
    logger.error({ err }, "Failed to remove symbol");
    res.status(500).json({ error: "Failed to remove symbol" });
  }
});

router.delete("/watchlists/:id", async (req, res) => {
  const userId = getUserId(req);
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

  try {
    const [existing] = await db.select().from(scannerWatchlistsTable)
      .where(and(eq(scannerWatchlistsTable.id, id), eq(scannerWatchlistsTable.userId, userId)));
    if (!existing) return res.status(404).json({ error: "Watchlist not found" });
    if (existing.isProtected) return res.status(400).json({ error: "Cannot delete protected watchlist" });

    await db.delete(scannerWatchlistsTable)
      .where(and(eq(scannerWatchlistsTable.id, id), eq(scannerWatchlistsTable.userId, userId)));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to delete watchlist");
    res.status(500).json({ error: "Failed to delete watchlist" });
  }
});


const DEFAULT_SCREENS: Array<{ name: string; filters: ScreenFilters }> = [
  {
    name: "Large Cap Liquid",
    filters: {
      marketCapMin: 10_000_000_000,
      volumeMin: 2_000_000,
      optionsVolumeMin: 500,
      priceMin: 20,
      country: "US",
      maxResults: 200,
    },
  },
  {
    name: "Mid Cap Movers",
    filters: {
      marketCapMin: 2_000_000_000,
      marketCapMax: 10_000_000_000,
      volumeMin: 1_000_000,
      priceMin: 10,
      country: "US",
      maxResults: 200,
    },
  },
  {
    name: "High IV Opportunity",
    filters: {
      marketCapMin: 5_000_000_000,
      volumeMin: 1_000_000,
      country: "US",
      maxResults: 200,
    },
  },
];

function getPresetSymbolsForFilters(filters: ScreenFilters): string[] {
  const marketCapMax = filters.marketCapMax ?? Infinity;
  const marketCapMin = filters.marketCapMin ?? 0;
  if (marketCapMax <= 12_000_000_000 && marketCapMin <= 10_000_000_000) {
    return PRESET_UNIVERSES.midcap200?.symbols ?? [];
  }
  return PRESET_UNIVERSES.liquidCore130?.symbols ?? [];
}

async function runScreenWithFallback(
  filters: ScreenFilters,
): Promise<{ symbols: string[]; error?: string; usedFallback?: boolean }> {
  const fmpResult = await runFmpScreen(filters);
  if (fmpResult.error === "FMP_API_KEY not configured") {
    const accessToken = getBestAccessToken();
    if (!accessToken) {
      return { symbols: [], error: "FMP_API_KEY not configured and no Schwab access token available" };
    }
    const baseSymbols = getPresetSymbolsForFilters(filters);
    const maxResults = filters.maxResults ?? 100;
    const dynResult = await runDynamicScreener(baseSymbols, accessToken, maxResults);
    const combined = [...new Set([...dynResult.topMovers, ...dynResult.volumeSurge, ...dynResult.highVolatility])];
    logger.info({ count: combined.length, baseCount: baseSymbols.length }, "Dynamic screen used Schwab fallback (FMP_API_KEY not set)");
    return { symbols: combined.slice(0, maxResults), usedFallback: true };
  }
  return fmpResult;
}

async function ensureDefaultScreens(userId: string) {
  const existing = await db.select().from(scannerScreensTable)
    .where(and(eq(scannerScreensTable.userId, userId), eq(scannerScreensTable.isDefault, true)));
  if (existing.length > 0) return existing;

  const created = [];
  for (const def of DEFAULT_SCREENS) {
    const [s] = await db.insert(scannerScreensTable).values({
      userId,
      name: def.name,
      filters: def.filters,
      isDefault: true,
    }).returning();
    created.push(s);
  }
  return created;
}

router.get("/screens", async (req, res) => {
  const userId = getUserId(req);
  try {
    let rows = await db.select().from(scannerScreensTable).where(eq(scannerScreensTable.userId, userId));
    if (rows.length === 0) {
      rows = await ensureDefaultScreens(userId);
    }
    res.json({
      screens: rows.map(s => ({
        ...s,
        cachedCount: Array.isArray(s.cachedSymbols) ? (s.cachedSymbols as string[]).length : null,
      })),
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch screens");
    res.status(500).json({ error: "Failed to fetch screens" });
  }
});

router.post("/screens", async (req, res) => {
  const userId = getUserId(req);
  const { name, filters } = req.body;
  if (!name || typeof name !== "string") return res.status(400).json({ error: "Name required" });
  if (!filters || typeof filters !== "object") return res.status(400).json({ error: "Filters required" });

  try {
    const [screen] = await db.insert(scannerScreensTable).values({
      userId,
      name: name.trim(),
      filters,
      isDefault: false,
    }).returning();
    res.json({ screen });
  } catch (err) {
    logger.error({ err }, "Failed to create screen");
    res.status(500).json({ error: "Failed to create screen" });
  }
});

router.patch("/screens/:id", async (req, res) => {
  const userId = getUserId(req);
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

  try {
    const [existing] = await db.select().from(scannerScreensTable)
      .where(and(eq(scannerScreensTable.id, id), eq(scannerScreensTable.userId, userId)));
    if (!existing) return res.status(404).json({ error: "Screen not found" });

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (req.body.name && typeof req.body.name === "string") updates.name = req.body.name.trim();
    if (req.body.filters && typeof req.body.filters === "object") updates.filters = req.body.filters;

    const [updated] = await db.update(scannerScreensTable)
      .set(updates)
      .where(and(eq(scannerScreensTable.id, id), eq(scannerScreensTable.userId, userId)))
      .returning();
    res.json({ screen: updated });
  } catch (err) {
    logger.error({ err }, "Failed to update screen");
    res.status(500).json({ error: "Failed to update screen" });
  }
});

router.delete("/screens/:id", async (req, res) => {
  const userId = getUserId(req);
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

  try {
    await db.delete(scannerScreensTable)
      .where(and(eq(scannerScreensTable.id, id), eq(scannerScreensTable.userId, userId)));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to delete screen");
    res.status(500).json({ error: "Failed to delete screen" });
  }
});

router.post("/screens/:id/run", async (req, res) => {
  const userId = getUserId(req);
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

  try {
    const [screen] = await db.select().from(scannerScreensTable)
      .where(and(eq(scannerScreensTable.id, id), eq(scannerScreensTable.userId, userId)));
    if (!screen) return res.status(404).json({ error: "Screen not found" });

    const result = await runScreenWithFallback(screen.filters as ScreenFilters);
    if (result.error) {
      return res.json({ symbols: result.symbols, error: result.error, cachedAt: null });
    }

    const now = new Date();
    await db.update(scannerScreensTable)
      .set({ cachedSymbols: result.symbols, cachedAt: now, updatedAt: now })
      .where(eq(scannerScreensTable.id, id));

    res.json({ symbols: result.symbols, count: result.symbols.length, cachedAt: now.toISOString(), usedFallback: result.usedFallback ?? false });
  } catch (err) {
    logger.error({ err }, "Failed to run screen");
    res.status(500).json({ error: "Failed to run screen" });
  }
});

router.post("/screens/preview", async (req, res) => {
  const { filters } = req.body;
  if (!filters || typeof filters !== "object") return res.status(400).json({ error: "Filters required" });

  try {
    const result = await runFmpScreen(filters);
    res.json({ count: result.symbols.length, symbols: result.symbols.slice(0, 20), error: result.error });
  } catch (err) {
    logger.error({ err }, "Failed to preview screen");
    res.status(500).json({ error: "Failed to preview screen" });
  }
});

router.get("/screens/:id/symbols", async (req, res) => {
  const userId = getUserId(req);
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

  try {
    const [screen] = await db.select().from(scannerScreensTable)
      .where(and(eq(scannerScreensTable.id, id), eq(scannerScreensTable.userId, userId)));
    if (!screen) return res.status(404).json({ error: "Screen not found" });

    if (screen.cachedSymbols && Array.isArray(screen.cachedSymbols)) {
      return res.json({
        symbols: screen.cachedSymbols,
        count: (screen.cachedSymbols as string[]).length,
        cachedAt: screen.cachedAt?.toISOString() ?? null,
      });
    }

    const result = await runScreenWithFallback(screen.filters as ScreenFilters);
    if (result.symbols.length > 0) {
      const now = new Date();
      await db.update(scannerScreensTable)
        .set({ cachedSymbols: result.symbols, cachedAt: now, updatedAt: now })
        .where(eq(scannerScreensTable.id, id));
    }

    res.json({
      symbols: result.symbols,
      count: result.symbols.length,
      cachedAt: result.symbols.length > 0 ? new Date().toISOString() : null,
      error: result.error,
      usedFallback: result.usedFallback ?? false,
    });
  } catch (err) {
    logger.error({ err }, "Failed to get screen symbols");
    res.status(500).json({ error: "Failed to get screen symbols" });
  }
});

const AUTO_WATCHLIST_NAMES = {
  topMovers: "Top Movers Today",
  volumeSurge: "Volume Surge",
  highVolatility: "High Volatility",
} as const;

const AUTO_UNIVERSE_KEY = "liquidCore130";

router.post("/refresh-auto-watchlists", async (req, res) => {
  const userId = getUserId(req);
  const accessToken = getBestAccessToken();
  if (!accessToken) {
    return res.status(503).json({ error: "No Schwab access token available" });
  }

  const preset = PRESET_UNIVERSES[AUTO_UNIVERSE_KEY];
  if (!preset) {
    return res.status(500).json({ error: "Universe not found" });
  }

  try {
    logger.info({ universe: AUTO_UNIVERSE_KEY, count: preset.symbols.length }, "Running dynamic screener for auto-watchlists");
    const result = await runDynamicScreener(preset.symbols, accessToken, 50);

    if (result.error && !result.topMovers.length && !result.volumeSurge.length && !result.highVolatility.length) {
      return res.status(500).json({ error: result.error });
    }

    const categories: Array<{ key: keyof typeof AUTO_WATCHLIST_NAMES; symbols: string[] }> = [
      { key: "topMovers", symbols: result.topMovers },
      { key: "volumeSurge", symbols: result.volumeSurge },
      { key: "highVolatility", symbols: result.highVolatility },
    ];

    const updated: Array<{ name: string; count: number }> = [];

    for (const cat of categories) {
      const name = AUTO_WATCHLIST_NAMES[cat.key];
      if (cat.symbols.length === 0) continue;

      const [existing] = await db
        .select()
        .from(scannerWatchlistsTable)
        .where(and(eq(scannerWatchlistsTable.userId, userId), eq(scannerWatchlistsTable.name, name)));

      if (existing) {
        await db
          .update(scannerWatchlistsTable)
          .set({ symbols: cat.symbols, updatedAt: new Date() })
          .where(eq(scannerWatchlistsTable.id, existing.id));
        updated.push({ name, count: cat.symbols.length });
      } else {
        await db.insert(scannerWatchlistsTable).values({
          userId,
          name,
          symbols: cat.symbols,
          isProtected: false,
        });
        updated.push({ name, count: cat.symbols.length });
      }

      logger.info({ name, count: cat.symbols.length, symbols: cat.symbols.slice(0, 5) }, "Auto-watchlist updated");
    }

    const rows = await db.select().from(scannerWatchlistsTable).where(eq(scannerWatchlistsTable.userId, userId));
    res.json({ updated, watchlists: rows });
  } catch (err) {
    logger.error({ err }, "Failed to refresh auto-watchlists");
    res.status(500).json({ error: "Failed to refresh auto-watchlists" });
  }
});

function getAllSymbolsSorted(): string[] {
  const set = new Set<string>();
  for (const preset of Object.values(PRESET_UNIVERSES)) {
    for (const sym of preset.symbols) set.add(sym);
  }
  const snap = getUniverseSnapshot();
  if (snap) {
    for (const sym of snap.symbols) set.add(sym);
  }
  return [...set].sort();
}

router.get("/search", (req, res) => {
  const q = (req.query.q as string ?? "").trim().toUpperCase();
  const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
  if (!q) return res.json({ results: [] });

  const allSymbols = getAllSymbolsSorted();
  const exact: Array<{ symbol: string; name: string }> = [];
  const prefix: Array<{ symbol: string; name: string }> = [];
  const contains: Array<{ symbol: string; name: string }> = [];

  for (const sym of allSymbols) {
    if (sym === q) exact.push({ symbol: sym, name: sym });
    else if (sym.startsWith(q)) prefix.push({ symbol: sym, name: sym });
    else if (sym.includes(q)) contains.push({ symbol: sym, name: sym });
    if (exact.length + prefix.length + contains.length >= limit) break;
  }

  res.json({ results: [...exact, ...prefix, ...contains].slice(0, limit) });
});

export default router;

export async function runDailyScreenRefresh() {
  logger.info("Running daily screen refresh for all users");
  try {
    const screens = await db.select().from(scannerScreensTable);
    for (const screen of screens) {
      try {
        const result = await runScreenWithFallback(screen.filters as ScreenFilters);
        if (result.symbols.length > 0) {
          const now = new Date();
          await db.update(scannerScreensTable)
            .set({ cachedSymbols: result.symbols, cachedAt: now, updatedAt: now })
            .where(eq(scannerScreensTable.id, screen.id));
          logger.info({ screenId: screen.id, name: screen.name, count: result.symbols.length }, "Screen refreshed");
        }
      } catch (err) {
        logger.error({ err, screenId: screen.id }, "Failed to refresh screen");
      }
    }
  } catch (err) {
    logger.error({ err }, "Daily screen refresh failed");
  }
}
