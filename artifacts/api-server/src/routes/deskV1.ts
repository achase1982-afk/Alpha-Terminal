import { Router, type IRouter, type Response } from "express";
import { deskBearerAuth } from "../middleware/deskBearerAuth.js";
import { buildDeskHealthFeeds } from "../lib/desk/deskFeedFreshness.js";
import { deskEnvelope } from "../lib/desk/deskEnvelope.js";
import { deskFetchSchwabQuotes } from "../lib/desk/deskSchwabQuotes.js";
import { deskFetchSchwabChain } from "../lib/desk/deskSchwabChains.js";
import { deskFetchSchwabBars } from "../lib/desk/deskSchwabBars.js";
import { deskFetchUwFlow } from "../lib/desk/deskUnusualWhales.js";
import { deskTradierQuotes, getTradierToken } from "../lib/desk/deskTradier.js";
import { deskAlpacaQuotes, getAlpacaKeys } from "../lib/desk/deskAlpaca.js";
import { deskFetchNews } from "../lib/desk/deskNews.js";
import { getDeskTapeSince, registerDeskSpxSse } from "../lib/desk/deskSpxTape.js";

const router: IRouter = Router();

router.use(deskBearerAuth);

router.get("/health", (_req, res) => {
  const now = Date.now();
  const feeds = buildDeskHealthFeeds(now);
  res.json(
    deskEnvelope(
      { feeds },
      "desk_health",
      now,
    ),
  );
});

router.get("/quotes", async (req, res) => {
  const raw = (req.query["symbols"] as string) ?? "SPY,QQQ,$SPX";
  const symbols = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const { quotes, asOfMs } = await deskFetchSchwabQuotes(symbols);

  const { keyId, secret } = getAlpacaKeys();
  let fallback: Record<string, unknown>[] | undefined;
  if (getTradierToken()) {
    const t = await deskTradierQuotes(symbols);
    fallback = t.quotes;
  }
  if (keyId && secret) {
    const a = await deskAlpacaQuotes(symbols);
    fallback = [...(fallback ?? []), ...a.quotes];
  }

  res.json(
    deskEnvelope(
      { quotes, fallback_quotes: fallback ?? [] },
      "schwab",
      asOfMs,
      "schwab_quotes",
    ),
  );
});

router.get("/tape/spx/stream", (req, res) => {
  registerDeskSpxSse(res as Response);
});

router.get("/tape/spx", (req, res) => {
  const since = req.query["since"] as string | undefined;
  const ticks = getDeskTapeSince(since);
  const asOfMs = ticks.length ? Date.parse(ticks[ticks.length - 1]!.ts) : Date.now();
  res.json(
    deskEnvelope({ ticks }, "schwab_spx_tape", asOfMs, "spx_tape"),
  );
});

router.get("/chains", async (req, res) => {
  const symbol = ((req.query["symbol"] as string) ?? "SPX").toUpperCase();
  const expiration = req.query["expiration"] as string;
  if (!expiration || !/^\d{4}-\d{2}-\d{2}/.test(expiration)) {
    res.status(400).json({ error: "expiration required (YYYY-MM-DD)" });
    return;
  }
  const { underlying_price, contracts, asOfMs } = await deskFetchSchwabChain(symbol, expiration);
  res.json(
    deskEnvelope(
      { symbol, expiration: expiration.slice(0, 10), underlying_price, contracts },
      "schwab",
      asOfMs,
      "schwab_chains",
    ),
  );
});

router.get("/flow", async (_req, res) => {
  const { alerts, asOfMs } = await deskFetchUwFlow();
  res.json(deskEnvelope({ alerts }, "unusual_whales", asOfMs, "uw_flow"));
});

router.get("/bars", async (req, res) => {
  const symbol = ((req.query["symbol"] as string) ?? "SPY").toUpperCase();
  const timeframe = (req.query["timeframe"] as string) ?? "1d";
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "100"), 10) || 100, 500);
  const { bars, asOfMs } = await deskFetchSchwabBars(symbol, timeframe, limit);
  res.json(deskEnvelope({ symbol, timeframe, bars }, "schwab", asOfMs, "schwab_quotes"));
});

router.get("/news", async (req, res) => {
  const raw = (req.query["symbols"] as string) ?? "";
  const symbols = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const { articles, asOfMs } = await deskFetchNews(symbols.length ? symbols : ["SPY"]);
  res.json(deskEnvelope({ articles }, "finnhub", asOfMs, "news"));
});

export default router;