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
  const raw = [
    "NVDA","AAPL","MSFT","AMZN","GOOGL","GOOG","META","AVGO","TSLA","LLY",
    "JPM","WMT","V","UNH","MA","NFLX","COST","ORCL","HD","JNJ",
    "PG","ABBV","CRM","BAC","ADBE","CVX","MRK","TMUS","KO","AMD",
    "CSCO","PEP","WFC","TMO","LIN","ACN","MCD","NOW","ABT","ISRG",
    "GE","IBM","INTU","PM","GS","CAT","QCOM","TXN","AMGN","VZ",
    "DHR","BLK","BKNG","AXP","PFE","MS","SPGI","RTX","LOW","T",
    "NEE","BA","DE","UNP","SYK","SCHW","C","BMY","AMAT","PLD",
    "MDLZ","ADI","GILD","INTC","CB","MMC","LRCX","ADP","BSX","CME",
    "ETN","CI","REGN","NKE","VRTX","ICE","MU","KLAC","SHW","DUK",
    "PYPL","SO","CMG","CDNS","SNPS","MO","BDX","MCO","PGR","CL",
    "ITW","PH","COP","APH","TGT","FDX","ABNB","MCK","EQIX","MSI",
    "AON","ZTS","NOC","EMR","TDG","WM","APD","CTAS","HCA","MCHP",
    "GD","HUM","CVS","NXPI","SLB","ORLY","AJG","DXCM","GM","F",
    "OXY","SRE","AEP","MAR","ROP","PCAR","EL","STZ","DLR","AFL",
    "MPC","AIG","ADSK","PSA","CARR","CHTR","DG","EW","TFC","PSX",
    "ROST","FTNT","TEL","MNST","D","CTSH","NSC","KMB","DHI","CCI",
    "BIIB","ECL","KHC","IDXX","WMB","DOW","YUM","O","PAYX","AMT",
    "DD","MRNA","GIS","LEN","CPRT","IQV","MSCI","CMI","PCG","ON",
    "EXC","BKR","VLO","RSG","KDP","GWW","CTVA","COF","CDW","URI",
    "PRU","PPG","FAST","JCI","ODFL","NUE","FANG","HAL","EIX","GEHC",
    "KEYS","DAL","HPQ","BAX","AMP","CBRE","WBD","EFX","LYB","HBAN",
    "STT","CCL","VMC","IRM","LUV","DRI","MPWR","SYY","BR","CFG",
    "VRSK","CLX","MKC","PKG","EXPE","IFF","AES","FMC","HOLX","NTRS",
    "JBHT","SYF","TER","POOL","PFG","KMI","BRO","RF","MGM","INCY",
    "CF","ATO","MAS","KEY","CNP","NTAP","CAG","BBY","CMA","CAH",
    "MOS","FCX","WDC","DVN","CSX","UAL","FIS","FISV","DELL","WDAY",
    "PANW","ARM","CRWD","DDOG","SNOW","NET","SPOT","DASH","COIN","PLTR",
    "SOFI","UBER","RBLX","MRVL","SMCI","MSTR","APP","SHOP","TEAM",
    "TTD","DKNG","OKLO","HIMS","HOOD","AFRM","IOT","ENPH","RUN",
    "RIVN","CELH","ONON","SNAP","U","ROKU","ZS","VEEV","MNDY",
    "NTNX","VRT","CRDO","GTLB","DOCN","FSLY","PINS","CHWY",
    "NU","AAL","NCLH","RCL","ALK","BABA","TSM","NVO","PDD","JD",
    "HDB","INFY","CRH","CPNG","BP","SHEL","EQNR","SAN","BCS","TD","DB",
    "AA","NEM","VALE","SM","AR","CTRA","EOG","EQT","APA","OKE",
    "XOM","PBR","SU","CNQ","CVE",
    "SBUX","DIS","LVS","WYNN","HLT","UPS",
    "LMT","HON","DFS",
  ];
  const seen = new Set<string>();
  return raw.filter(s => { const u = s.toUpperCase(); if (seen.has(u)) return false; seen.add(u); return true; });
}

export default router;
