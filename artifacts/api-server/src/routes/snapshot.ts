import { Router } from "express";
import { runFullSnapshot, getSnapshotStatus, collectEquitySnapshots, collectPolygonFlowFromAPI, computeFlowAggregates, backfillEquityHistory, backfillPolygonFlow } from "../lib/dailySnapshot";
import { getBestAccessToken } from "../lib/tokenStore";
import { logger } from "../lib/logger";
import { db } from "@workspace/db";
import { optionsFlowPerStrikeTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

router.get("/status", async (_req, res) => {
  try {
    const status = await getSnapshotStatus();
    res.json({ ok: true, snapshots: status });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

router.post("/collect", async (req, res) => {
  const { symbols, date } = req.body as { symbols?: string[]; date?: string };
  const accessToken = req.headers["x-access-token"] as string | undefined;

  if (!accessToken) {
    return res.status(400).json({ ok: false, error: "Missing x-access-token header" });
  }

  const scanSymbols = symbols ?? getDefaultUniverse();

  res.json({ ok: true, message: "Snapshot collection started", symbols: scanSymbols.length, date: date ?? new Date().toISOString().slice(0, 10) });

  runFullSnapshot(scanSymbols, accessToken, date).catch(e => {
    logger.error({ error: (e as Error).message }, "Background snapshot collection failed");
  });
});

router.post("/equity-only", async (req, res) => {
  const { symbols, date } = req.body as { symbols?: string[]; date?: string };
  const accessToken = req.headers["x-access-token"] as string | undefined;

  if (!accessToken) {
    return res.status(400).json({ ok: false, error: "Missing x-access-token header" });
  }

  const scanSymbols = symbols ?? getDefaultUniverse();

  res.json({ ok: true, message: "Equity snapshot started", symbols: scanSymbols.length });

  collectEquitySnapshots(scanSymbols, accessToken, date).catch(e => {
    logger.error({ error: (e as Error).message }, "Background equity snapshot failed");
  });
});

router.post("/flow-only", async (req, res) => {
  const { symbols, date } = req.body as { symbols?: string[]; date?: string };
  const accessToken = req.headers["x-access-token"] as string | undefined;

  if (!accessToken) {
    return res.status(400).json({ ok: false, error: "Missing x-access-token header" });
  }

  const scanSymbols = symbols ?? getDefaultUniverse();

  res.json({ ok: true, message: "Flow collection started", symbols: scanSymbols.length });

  collectPolygonFlowFromAPI(scanSymbols, date)
    .then(({ strikeRows }) => computeFlowAggregates(scanSymbols, date).then(aggRows => {
      logger.info({ strikeRows, aggRows }, "Flow-only collection complete");
    }))
    .catch(e => {
      logger.error({ error: (e as Error).message }, "Background flow collection failed");
    });
});

router.post("/backfill", async (req, res) => {
  const accessToken = (req.headers["x-access-token"] as string | undefined) ?? getBestAccessToken();
  if (!accessToken) {
    return res.status(400).json({ ok: false, error: "No Schwab access token available" });
  }

  const { symbols } = req.body as { symbols?: string[] };
  const scanSymbols = symbols ?? getDefaultUniverse();

  res.json({ ok: true, message: "Equity history backfill started", symbols: scanSymbols.length });

  backfillEquityHistory(scanSymbols, accessToken).catch(e => {
    logger.error({ error: (e as Error).message }, "Background backfill failed");
  });
});

router.post("/recompute-aggregates", async (req, res) => {
  try {
    const dateRows = await db
      .selectDistinct({ date: optionsFlowPerStrikeTable.date })
      .from(optionsFlowPerStrikeTable)
      .orderBy(optionsFlowPerStrikeTable.date);
    const dates = dateRows.map(r => r.date);

    const symRows = await db
      .selectDistinct({ sym: optionsFlowPerStrikeTable.underlyingSymbol })
      .from(optionsFlowPerStrikeTable);
    const symbols = symRows.map(r => r.sym);

    res.json({ ok: true, message: `Recomputing aggregates for ${dates.length} dates, ${symbols.length} symbols`, dates: dates.length, symbols: symbols.length });

    (async () => {
      let processed = 0;
      for (const d of dates) {
        await computeFlowAggregates(symbols, d);
        processed++;
        if (processed % 10 === 0) {
          logger.info({ processed, total: dates.length }, "Recompute aggregates progress");
        }
      }
      logger.info({ processed, symbols: symbols.length }, "Recompute aggregates complete");
    })().catch(e => logger.error({ error: (e as Error).message }, "Recompute aggregates failed"));
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

router.post("/backfill-flow", async (req, res) => {
  const { symbols, daysBack } = req.body as { symbols?: string[]; daysBack?: number };
  const scanSymbols = symbols ?? getDefaultUniverse();
  const days = daysBack ?? 60;

  res.json({ ok: true, message: `Polygon flow backfill started — ${days} days`, symbols: scanSymbols.length, daysBack: days });

  backfillPolygonFlow(scanSymbols, days).catch(e => {
    logger.error({ error: (e as Error).message }, "Background Polygon flow backfill failed");
  });
});

function getDefaultUniverse(): string[] {
  return [
    "INTC","NVDA","AAL","TSLA","NU","PLTR","SOFI","F","WULF","CCL","PBR","AMZN",
    "MU","T","VG","ET","AAPL","APLD","BMNR","BAC","CIFR","AMD","IREN","RKT",
    "VZ","PFE","GOOGL","BNL","MSFT","HOOD","META","RIVN","SMCI","AVGO","XOM","NFLX",
    "NCLH","NKE","MRVL","RIOT","PCG","DOW","RKLB","HBAN","OXY","HAL","RGTI","VALE",
    "ORCL","PATH","CNQ","CMCSA","PTEN","CPNG","CDE","QBTS","AG","TTD","PR","SLB",
    "GOOG","DAL","KVUE","FCX","WMT","IONQ","HIMS","NOW","CSCO","CRWV","PSKY","CNH",
    "HPE","WBD","AXTI","BP","HPQ","NBIS","DVN","LUNR","BABA","CVX","MSTR","CSX",
    "SNDK","UAL","LYFT","DOCN","TSM","C","HL","PL","PYPL","FIG","APA","GLW",
    "KHC","KMI","OSCR","WFC","AAOI","BSX","CORZ","AGNC","ATMU","SLNO","PINS","RCAT",
    "NVO","TFC","LYB","UBER","MCHP","CRM","CVE","CMG","CRGY","INFY","TERN","FSLY",
    "HDB","GTLB","U","MDT","COP","KEY","SAN","QCOM","B","KO","PANW","QXO",
    "LUV","BCS","ANET","EQX","JD","FIS","KGC","SNXX","BMY","LEVI","ASTS","EQNR",
    "HUT","RF","ACI","LRCX","BKR","HST","JHX","PG","AESI","DIS","MO","AEHR",
    "SCHW","BE","EQT","JPM","CRCL","STM","CHWY","SHEL","CAG","UUUU","DKNG","VICI",
    "ALK","ON","COIN","CPB","IP","TETH","FLY","UEC","UNH","GIS","CX","ERIC",
    "DRAM","LGN","ABT","VLY","MOS","MRK","FNB","WDC","BN","CTRA","SBSW","BKNG",
    "WMB","SM","JNJ","XP","ASX","CASY","KDP","OKLO","ONON","NEM","O","BTDR",
    "ARCC","SBUX","BX","VFC","USB","MDLZ","AR","OKE","NLY","BBWI","SHOP","FITB",
    "IAG","FISV","RUN","MS","AMAT","HBM","HUN","S","TOST","NOV","TEAM","KMB",
    "TXN","FAST","CELH","GEN","CF","WDAY","GM","COHR","IBN","DELL","KR","VGNT",
    "AA","TMUS","APH","FSM","XYZ","M","LITE","VIAV","MDLN","PDD","ZETA","AS",
    "NEE","INVH","V","PEP","CWAN","AMPX","MP","GME","CVS","RBLX","COF","SSRM",
    "CAR","AEO","CNC","VTRS","AES","ARM","EXC","GE","CPRT","IOT","VISN","BAX",
    "KLAR","NXE","CRH","HMY","BA","TD","ARES","SATS","TSCO","ENPH","TEVA","IVZ",
    "CRDO","MKC","GAP","PAAS","CSGP","AFRM","SYY","CARR","FTNT","APP","CTVA","UPS",
    "ALM","PTIR","FHN","CRBG","EOG","DB","CL","SU","TER","SO","HYAC","FPS",
    "NTNX","IRE","VRT","AKAM","RLAY","DAR","HD","LOW","TGT","COST","ISRG","REGN",
    "VRTX","DXCM","LLY","ABBV","DHR","SYK","ZTS","AMGN","HCA","PLD","AMT","EQIX",
    "HON","RTX","DE","CAT","UNP","NSC","FDX","MA","AXP","GS","BLK","ICE",
    "SPGI","CME","PGR","DUK","SHW","ECL","LIN","INTU","ADBE","SNPS","CDNS","KLAC",
    "ABNB","DASH","SPOT","CRWD","ZS","SNOW","DDOG","NET","MNDY","VEEV",
  ];
}

export default router;
