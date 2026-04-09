import { Router } from "express";
import { runFullSnapshot, getSnapshotStatus, collectEquitySnapshots, collectPolygonFlowFromAPI, computeFlowAggregates } from "../lib/dailySnapshot";
import { logger } from "../lib/logger";

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

function getDefaultUniverse(): string[] {
  return [
    "AAPL","MSFT","NVDA","AMZN","META","GOOGL","TSLA","AVGO","NFLX","AMD",
    "CRM","ORCL","ADBE","INTU","NOW","QCOM","TXN","AMAT","MU","LRCX",
    "PANW","KLAC","SNPS","CDNS","INTC","CSCO",
    "JPM","BAC","WFC","GS","MS","SCHW","C","BLK","V","MA","AXP",
    "UNH","LLY","ABBV","MRK","PFE","JNJ","ABT","TMO","ISRG","AMGN",
    "XOM","CVX","SLB","COP","EOG",
    "PG","KO","PEP","COST","WMT",
    "MCD","HD","LOW","TGT","NKE",
    "DIS","CMCSA","VZ","T","TMUS",
    "CAT","HON","RTX","DE","GE","UPS",
    "NEE","DUK","SO",
    "PLD","AMT",
    "LIN","SHW",
  ];
}

export default router;
