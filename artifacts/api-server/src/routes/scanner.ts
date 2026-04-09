import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { scannerWatchlistsTable, scannerScreensTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { runFmpScreen, type ScreenFilters } from "../lib/fmpScreener.js";
import { runDynamicScreener } from "../lib/schwabDynamicScreener.js";
import { getBestAccessToken } from "../lib/tokenStore.js";
import { getAuth } from "@clerk/express";

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
  sp100: {
    label: "S&P 100",
    description: "100 largest US stocks by market cap",
    symbols: [
      "AAPL","ABBV","ABT","ACN","ADBE","AMD","AMGN","AMZN","AVGO","AXP",
      "BA","BAC","BK","BKNG","BLK","BMY","BRK.B","C","CAT","CHTR",
      "CL","CMCSA","COF","COP","COST","CRM","CSCO","CVS","CVX","DE",
      "DHR","DIS","DOW","DUK","EMR","EXC","F","FDX","GD","GE",
      "GILD","GM","GOOG","GOOGL","GS","HD","HON","IBM","INTC","INTU",
      "JNJ","JPM","KHC","KO","LIN","LLY","LMT","LOW","MA","MCD",
      "MDLZ","MDT","MET","META","MMM","MO","MRK","MS","MSFT","NEE",
      "NFLX","NKE","NOC","NVDA","ORCL","PEP","PFE","PG","PM","PYPL",
      "QCOM","RTX","SBUX","SCHW","SO","SPG","T","TGT","TMO","TMUS",
      "TXN","UNH","UNP","UPS","USB","V","VZ","WBA","WFC","WMT",
    ],
  },
  sp500: {
    label: "S&P 500",
    description: "Full S&P 500 membership",
    symbols: [
      "AAPL","ABBV","ABT","ABNB","ACN","ADBE","ADI","ADM","ADP","ADSK",
      "AEE","AEP","AES","AFL","AIG","AIZ","AJG","AKAM","ALB","ALGN",
      "ALK","ALL","ALLE","AMAT","AMCR","AMD","AME","AMGN","AMP","AMT",
      "AMZN","ANET","ANSS","AON","AOS","APA","APD","APH","APTV","ARE",
      "ATO","ATVI","AVGO","AVY","AWK","AXP","AZO","BA","BAC","BAX",
      "BBWI","BBY","BDX","BEN","BF.B","BG","BIIB","BIO","BK","BKNG",
      "BKR","BLK","BMY","BR","BRK.B","BRO","BSX","BWA","BXP","C",
      "CAG","CAH","CARR","CAT","CB","CBOE","CBRE","CCI","CCL","CDAY",
      "CDNS","CDW","CE","CEG","CF","CFG","CHD","CHRW","CHTR","CI",
      "CINF","CL","CLX","CMA","CMCSA","CME","CMG","CMI","CMS","CNC",
      "CNP","COF","COO","COP","COST","CPB","CPRT","CPT","CRL","CRM",
      "CSCO","CSGP","CSX","CTAS","CTLT","CTRA","CTSH","CTVA","CVS","CVX",
      "CZR","D","DAL","DD","DE","DFS","DG","DGX","DHI","DHR",
      "DIS","DISH","DLR","DLTR","DOV","DOW","DPZ","DRI","DTE","DUK",
      "DVA","DVN","DXC","DXCM","EA","EBAY","ECL","ED","EFX","EIX",
      "EL","EMN","EMR","ENPH","EOG","EPAM","EQIX","EQR","EQT","ES",
      "ESS","ETN","ETR","ETSY","EVRG","EW","EXC","EXPD","EXPE","EXR",
      "F","FANG","FAST","FBHS","FCX","FDS","FDX","FE","FFIV","FIS",
      "FISV","FITB","FLT","FMC","FOX","FOXA","FRC","FRT","FTNT","FTV",
      "GD","GE","GEHC","GEN","GILD","GIS","GL","GLW","GM","GNRC",
      "GOOG","GOOGL","GPC","GPN","GRMN","GS","GWW","HAL","HAS","HBAN",
      "HCA","HD","HOLX","HON","HPE","HPQ","HRL","HSIC","HST","HSY",
      "HUM","HWM","IBM","ICE","IDXX","IEX","IFF","ILMN","INCY","INTC",
      "INTU","INVH","IP","IPG","IQV","IR","IRM","ISRG","IT","ITW",
      "IVZ","J","JBHT","JCI","JKHY","JNJ","JNPR","JPM","K","KDP",
      "KEY","KEYS","KHC","KIM","KLAC","KMB","KMI","KMX","KO","KR",
      "L","LDOS","LEN","LH","LHX","LIN","LKQ","LLY","LMT","LNC",
      "LNT","LOW","LRCX","LUMN","LUV","LVS","LW","LYB","LYV","MA",
      "MAA","MAR","MAS","MCD","MCHP","MCK","MCO","MDLZ","MDT","MET",
      "META","MGM","MHK","MKC","MKTX","MLM","MMC","MMM","MNST","MO",
      "MOH","MOS","MPC","MPWR","MRK","MRNA","MRO","MS","MSCI","MSFT",
      "MSI","MTB","MTCH","MTD","MU","NCLH","NDAQ","NDSN","NEE","NEM",
      "NFLX","NI","NKE","NOC","NOW","NRG","NSC","NTAP","NTRS","NUE",
      "NVDA","NVR","NWL","NWS","NWSA","NXPI","O","ODFL","OGN","OKE",
      "OMC","ON","ORCL","ORLY","OTIS","OXY","PARA","PAYC","PAYX","PCAR",
      "PCG","PEAK","PEG","PEP","PFE","PFG","PG","PGR","PH","PHM",
      "PKG","PKI","PLD","PM","PNC","PNR","PNW","POOL","PPG","PPL",
      "PRU","PSA","PSX","PTC","PVH","PWR","PXD","PYPL","QCOM","QRVO",
      "RCL","RE","REG","REGN","RF","RHI","RJF","RL","RMD","ROK",
      "ROL","ROP","ROST","RSG","RTX","RVTY","SBAC","SBNY","SBUX","SCHW",
      "SEE","SHW","SIVB","SJM","SLB","SNA","SNPS","SO","SPG","SPGI",
      "SRE","STE","STT","STX","STZ","SWK","SWKS","SYF","SYK","SYY",
      "T","TAP","TDG","TDY","TECH","TEL","TER","TFC","TFX","TGT",
      "TJX","TMO","TMUS","TPR","TRGP","TRMB","TROW","TRV","TSCO","TSLA",
      "TSN","TT","TTWO","TXN","TXT","TYL","UAL","UDR","UHS","ULTA",
      "UNH","UNP","UPS","URI","USB","V","VFC","VICI","VLO","VMC",
      "VRSK","VRSN","VRTX","VTR","VTRS","VZ","WAB","WAT","WBA","WBD",
      "WDC","WEC","WELL","WFC","WHR","WM","WMB","WMT","WRB","WRK",
      "WST","WTW","WY","WYNN","XEL","XOM","XRAY","XYL","YUM","ZBH",
      "ZBRA","ZION","ZTS",
    ],
  },
  ndx100: {
    label: "Nasdaq 100",
    description: "100 largest Nasdaq-listed stocks",
    symbols: [
      "AAPL","ABNB","ADBE","ADI","ADP","ADSK","AEP","AMAT","AMGN","AMZN",
      "ANSS","APP","ARM","ASML","AVGO","AZN","BIIB","BKNG","BKR","CCEP",
      "CDNS","CDW","CEG","CHTR","CMCSA","COIN","COST","CPRT","CRWD","CSCO",
      "CSGP","CTAS","CTSH","DASH","DDOG","DLTR","DXCM","EA","ENPH","EXC",
      "FANG","FAST","FTNT","GEHC","GFS","GILD","GOOG","GOOGL","HON","IDXX",
      "ILMN","INTC","INTU","ISRG","KDP","KHC","KLAC","LRCX","LULU","MAR",
      "MCHP","MDB","MDLZ","MELI","META","MNST","MRNA","MRVL","MSFT","MU",
      "NFLX","NVDA","NXPI","ODFL","ON","ORLY","PANW","PAYX","PCAR","PDD",
      "PEP","PLTR","PYPL","QCOM","REGN","RIVN","ROST","SBUX","SIRI","SMCI",
      "SNPS","SPLK","TEAM","TMUS","TSLA","TTD","TTWO","TXN","VRSK","VRTX",
      "WBD","WDAY","XEL","ZM","ZS",
    ],
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

function loadPresets() {
  return PRESET_UNIVERSES;
}

router.get("/universes", (_req, res) => {
  const presets = loadPresets();
  const result: Record<string, { label: string; description: string; count: number }> = {};
  for (const [key, val] of Object.entries(presets)) {
    result[key] = { label: val.label, description: val.description, count: val.symbols.length };
  }
  res.json({ presets: result });
});

router.get("/universes/:key/symbols", (req, res) => {
  const presets = loadPresets();
  const preset = presets[req.params.key];
  if (!preset) return res.status(404).json({ error: "Preset not found" });
  res.json({ key: req.params.key, label: preset.label, symbols: preset.symbols });
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
  return PRESET_UNIVERSES.sp500?.symbols ?? [];
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

const AUTO_UNIVERSE_KEY = "sp500";

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

const ALL_SYMBOLS_SET = new Set<string>();
for (const preset of Object.values(PRESET_UNIVERSES)) {
  for (const sym of preset.symbols) ALL_SYMBOLS_SET.add(sym);
}
const ALL_SYMBOLS_SORTED = [...ALL_SYMBOLS_SET].sort();

router.get("/search", (req, res) => {
  const q = (req.query.q as string ?? "").trim().toUpperCase();
  const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
  if (!q) return res.json({ results: [] });

  const exact: Array<{ symbol: string; name: string }> = [];
  const prefix: Array<{ symbol: string; name: string }> = [];
  const contains: Array<{ symbol: string; name: string }> = [];

  for (const sym of ALL_SYMBOLS_SORTED) {
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
