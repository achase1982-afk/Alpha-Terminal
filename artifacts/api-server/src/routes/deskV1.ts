import { Router, type IRouter, type Response } from "express";
import { deskBearerAuth } from "../middleware/deskBearerAuth.js";
import { buildDeskHealthFeeds } from "../lib/desk/deskFeedFreshness.js";
import { deskEnvelope } from "../lib/desk/deskEnvelope.js";
import { deskFetchSchwabQuotes } from "../lib/desk/deskSchwabQuotes.js";
import { deskFetchSchwabChain } from "../lib/desk/deskSchwabChains.js";
import { deskFetchSchwabBars } from "../lib/desk/deskSchwabBars.js";
import { deskFetchUwFlow } from "../lib/desk/deskUnusualWhales.js";
import { deskTradierQuotes, getTradierToken } from "../lib/desk/deskTradier.js";
import { deskFetchNews } from "../lib/desk/deskNews.js";
import { getDeskTapeSince, registerDeskSpxSse } from "../lib/desk/deskSpxTape.js";
import { deskPersistSnapshot } from "../lib/desk/deskSnapshotStore.js";
import { deskAsofEtIso, deskSessionDateEt } from "../lib/desk/deskEt.js";
import { refreshDeskUwLiveFeeds } from "../lib/desk/deskUwLiveFeeds.js";

const router: IRouter = Router();

router.use(deskBearerAuth);

router.get("/health", async (_req, res) => {
  await refreshDeskUwLiveFeeds().catch(() => undefined);
  const now = Date.now();
  const feeds = buildDeskHealthFeeds(now);
  const body = {
    feeds,
    session_date: deskSessionDateEt(new Date(now)),
    asof_et: deskAsofEtIso(new Date(now)),
  };
  void deskPersistSnapshot("health", body);
  res.json(deskEnvelope(body, "desk_health", now));
});

router.get("/quotes", async (req, res) => {
  const raw = (req.query["symbols"] as string) ?? "SPY,QQQ,$SPX";
  const symbols = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const { quotes, asOfMs, session_date } = await deskFetchSchwabQuotes(symbols);

  let fallback_tradier: Record<string, unknown>[] | undefined;
  if (getTradierToken()) {
    const t = await deskTradierQuotes(symbols);
    fallback_tradier = t.quotes;
  }

  const payload = { quotes, fallback_tradier, session_date };
  void deskPersistSnapshot("quotes", payload);
  res.json(deskEnvelope(payload, "schwab", asOfMs, "schwab_quotes_rest"));
});

router.get("/tape/spx/stream", (_req, res) => {
  registerDeskSpxSse(res as Response);
});

router.get("/tape/spx", (req, res) => {
  const since = req.query["since"] as string | undefined;
  const ticks = getDeskTapeSince(since);
  const asOfMs = ticks.length ? ticks[ticks.length - 1]!.ts_ms : Date.now();
  res.json(
    deskEnvelope(
      { ticks, session_date: deskSessionDateEt(new Date(asOfMs)) },
      "schwab_streamer",
      asOfMs,
      "schwab_streamer",
    ),
  );
});

router.get("/chains", async (req, res) => {
  const symbol = ((req.query["symbol"] as string) ?? "SPX").toUpperCase();
  const expiration = req.query["expiration"] as string;
  if (!expiration || !/^\d{4}-\d{2}-\d{2}/.test(expiration)) {
    res.status(400).json({ error: "expiration required (YYYY-MM-DD)" });
    return;
  }
  const strikeCountRaw = req.query["strikeCount"] as string | undefined;
  const strikeCount =
    strikeCountRaw != null && strikeCountRaw !== ""
      ? Math.min(parseInt(strikeCountRaw, 10) || 0, 500)
      : undefined;
  const range = req.query["range"] as string | undefined;
  const chainOpts =
    strikeCount != null || range
      ? { strikeCount: strikeCount && strikeCount > 0 ? strikeCount : undefined, range }
      : undefined;
  const chain = await deskFetchSchwabChain(symbol, expiration, chainOpts);
  const payload = {
    symbol,
    expiration: expiration.slice(0, 10),
    underlyingPrice: chain.underlyingPrice,
    contracts_raw: chain.raw,
    contracts: chain.normalized,
    truncated: chain.truncated,
    contract_count: chain.contract_count,
    session_date: chain.session_date,
  };
  void deskPersistSnapshot("chains", payload, symbol);
  res.json(deskEnvelope(payload, "schwab", chain.asOfMs, "schwab_chains"));
});

router.get("/flow", async (_req, res) => {
  const { alerts, asOfMs } = await deskFetchUwFlow();
  res.json(
    deskEnvelope(
      { alerts, session_date: deskSessionDateEt(new Date(asOfMs)) },
      "unusual_whales",
      asOfMs,
      "uw_flow",
    ),
  );
});

router.get("/bars", async (req, res) => {
  const symbol = ((req.query["symbol"] as string) ?? "SPY").toUpperCase();
  const timeframe = (req.query["timeframe"] as string) ?? "1d";
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "100"), 10) || 100, 500);
  const { bars, asOfMs } = await deskFetchSchwabBars(symbol, timeframe, limit);
  res.json(
    deskEnvelope(
      { symbol, timeframe, bars, session_date: deskSessionDateEt(new Date(asOfMs)) },
      "schwab",
      asOfMs,
      "schwab_quotes_rest",
    ),
  );
});

router.get("/news", async (req, res) => {
  const raw = (req.query["symbols"] as string) ?? "";
  const symbols = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const { articles, asOfMs } = await deskFetchNews(symbols.length ? symbols : ["SPY"]);
  res.json(
    deskEnvelope(
      { articles, session_date: deskSessionDateEt(new Date(asOfMs)) },
      "finnhub",
      asOfMs,
      "news",
    ),
  );
});

export default router;