import { Router, type IRouter, type Response } from "express";
import { deskBearerAuth } from "../middleware/deskBearerAuth.js";
import { buildDeskHealthFeeds, deskSummarizeFeedsHealth } from "../lib/desk/deskFeedFreshness.js";
import { deskEnvelope } from "../lib/desk/deskEnvelope.js";
import { deskFetchSchwabQuotes } from "../lib/desk/deskSchwabQuotes.js";
import { deskFetchSchwabChain } from "../lib/desk/deskSchwabChains.js";
import { deskFetchSchwabBars } from "../lib/desk/deskSchwabBars.js";
import { deskTradierQuotes, getTradierToken } from "../lib/desk/deskTradier.js";
import { deskFetchNews } from "../lib/desk/deskNews.js";
import { deskFetchAlpacaNews } from "../lib/desk/deskAlpacaNews.js";
import { deskAlpacaPaperQuotes } from "../lib/desk/deskAlpacaPaper.js";
import { deskTastytradeQuotes } from "../lib/desk/deskTastytrade.js";
import { deskFetchEodhdBars } from "../lib/desk/deskEodhd.js";
import { deskAlpacaPaperBars } from "../lib/desk/deskAlpacaPaper.js";
import { deskFetchAlphaVantageNews, deskFetchAlphaVantageOverview } from "../lib/desk/deskAlphaVantage.js";
import { deskFetchMarketauxNews } from "../lib/desk/deskMarketaux.js";
import { deskFetchStocknews } from "../lib/desk/deskStocknews.js";
import { getDeskTapeSince, registerDeskSpxSse } from "../lib/desk/deskSpxTape.js";
import { deskPersistSnapshot } from "../lib/desk/deskSnapshotStore.js";
import { deskAsofEtIso, deskSessionDateEt } from "../lib/desk/deskEt.js";
import {
  deskGetCachedLiveGamma,
  deskGetCachedLiveGamma0dte,
  deskGetCachedNetPremTicks,
  deskGetCachedUwFlow,
  deskParseSinceFromQuery,
  deskValidateMarketDate,
  deskValidateUwTicker,
  deskUwRouteErrorForFeed,
  deskUwLastHttpStatus,
  deskUwAddonEnabled,
} from "../lib/desk/addons/unusualWhales/index.js";
import { getDeskRawTapeHealth, streamDeskRawTapeNdjson } from "../lib/desk/deskSpxTapeRaw.js";
import { getDeskTapeUniverseHealth } from "../lib/desk/deskTapeUniverse.js";
import { getDeskEquityFieldsSeen } from "../lib/desk/deskStreamerTap.js";
import { deskAlpacaMarketBars, deskAlpacaMarketQuotes } from "../lib/desk/deskAlpacaData.js";
import { deskResolveSource } from "../lib/desk/deskSources.js";
import { deskSchwabRestAppFromDeskSource } from "../lib/desk/deskSchwabRestCredential.js";
import { buildDeskSchwabOAuthHealth } from "../lib/desk/deskSchwabOAuthHealth.js";

const router: IRouter = Router();

router.use(deskBearerAuth);

router.get("/health", (_req, res) => {
  const now = Date.now();
  const feeds = buildDeskHealthFeeds(now);
  const feeds_summary = deskSummarizeFeedsHealth(feeds);
  const tape = getDeskRawTapeHealth();
  const body = {
    feeds,
    feeds_summary,
    schwab_streamer: {
      frames: tape.frames,
      bytes: tape.bytes,
      last_frame_ns: tape.last_frame_ns,
      last_frame_utc_ms: tape.last_frame_utc_ms,
      buffer_frames: tape.buffer_frames,
    },
    desk_tape_universe: getDeskTapeUniverseHealth(),
    desk_equity_fields_seen: getDeskEquityFieldsSeen(),
    schwab_oauth: buildDeskSchwabOAuthHealth(),
    session_date: deskSessionDateEt(new Date(now)),
    asof_et: deskAsofEtIso(new Date(now)),
  };
  void deskPersistSnapshot("health", body);
  res.json(deskEnvelope(body, "desk_health", now));
});

router.get("/quotes", async (req, res) => {
  const resolved = deskResolveSource(req.query["source"] as string | undefined, [
    "schwab",
    "schwab2",
    "tradier",
    "alpaca_paper",
    "alpaca",
    "tastytrade",
  ] as const);
  if ("error" in resolved) {
    res.status(400).json({ error: resolved.error, source: resolved.source, allowed: resolved.allowed });
    return;
  }

  const raw = (req.query["symbols"] as string) ?? "SPY,QQQ,$SPX";
  const symbols = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const session_date = deskSessionDateEt();

  if (resolved.source === "alpaca") {
    const r = await deskAlpacaMarketQuotes(symbols);
    if (!r.ok) {
      const status = r.error === "not_configured" ? 503 : r.status && r.status >= 400 ? r.status : 502;
      res.status(status).json({ error: r.error ?? "alpaca_fetch_failed", source: r.source });
      return;
    }
    const payload = { quotes: r.quotes, session_date };
    void deskPersistSnapshot("quotes", payload);
    res.json(deskEnvelope(payload, r.source, r.asOfMs, "alpaca_paper"));
    return;
  }

  if (resolved.source === "alpaca_paper") {
    const r = await deskAlpacaPaperQuotes(symbols);
    if (!r.ok) {
      const status = r.error === "not_configured" ? 503 : r.status && r.status >= 400 ? r.status : 502;
      res.status(status).json({ error: r.error ?? "alpaca_paper_fetch_failed", source: "alpaca_paper" });
      return;
    }
    const payload = { quotes: r.quotes, session_date };
    void deskPersistSnapshot("quotes", payload);
    res.json(deskEnvelope(payload, "alpaca_paper", r.asOfMs, "alpaca_paper"));
    return;
  }

  if (resolved.source === "tastytrade") {
    const r = await deskTastytradeQuotes(symbols);
    if (!r.ok) {
      const status = r.error === "not_configured" ? 503 : r.status && r.status >= 400 ? r.status : 502;
      res.status(status).json({ error: r.error ?? "tastytrade_fetch_failed", source: "tastytrade" });
      return;
    }
    const payload = { quotes: r.quotes, session_date };
    void deskPersistSnapshot("quotes", payload);
    res.json(deskEnvelope(payload, "tastytrade", r.asOfMs, "tastytrade"));
    return;
  }

  if (resolved.source === "tradier") {
    const t = await deskTradierQuotes(symbols);
    if (!t.ok) {
      res.status(t.status >= 400 && t.status < 600 ? t.status : 502).json({
        error: t.error ?? "tradier_fetch_failed",
        source: "tradier",
      });
      return;
    }
    const payload = { quotes: t.quotes, session_date };
    void deskPersistSnapshot("quotes", payload);
    res.json(deskEnvelope(payload, "tradier", t.asOfMs, "tradier"));
    return;
  }

  const schwabApp = deskSchwabRestAppFromDeskSource(resolved.source);
  const { quotes, asOfMs, app } = await deskFetchSchwabQuotes(symbols, schwabApp);
  const payload = { quotes, session_date };
  void deskPersistSnapshot("quotes", payload);
  const sourceLabel = app === "app2" ? "schwab2" : "schwab";
  const feed = app === "app2" ? "schwab2_rest" : "schwab_quotes_rest";
  res.json(deskEnvelope(payload, sourceLabel, asOfMs, feed));
});

router.get("/tape/spx/stream", (_req, res) => {
  registerDeskSpxSse(res as Response);
});

router.get("/tape/spx/raw", async (req, res) => {
  const session_date = (req.query["session_date"] as string) ?? deskSessionDateEt();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(session_date)) {
    res.status(400).json({ error: "session_date required (YYYY-MM-DD)" });
    return;
  }

  const sinceProvided = req.query["since_ns"] != null && String(req.query["since_ns"]).trim() !== "";
  const sinceRaw = sinceProvided ? String(req.query["since_ns"]) : "0";
  let sinceNs = 0n;
  try {
    sinceNs = BigInt(sinceRaw);
  } catch {
    res.status(400).json({ error: "since_ns must be an integer nanosecond string" });
    return;
  }

  const tape = getDeskRawTapeHealth();
  const chunks: string[] = [];

  try {
    const n = await streamDeskRawTapeNdjson(session_date, sinceNs, (line) => {
      chunks.push(line);
    });

    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("X-Session-Date", session_date);
    res.setHeader("X-Lines-Emitted", String(n));
    res.setHeader("X-Buffer-Frames-Available", String(tape.buffer_frames));
    res.setHeader("X-Live-Session-Date", deskSessionDateEt());
    res.status(200);
    if (chunks.length > 0) res.write(chunks.join(""));
    res.end();
  } catch {
    if (!res.headersSent) res.status(500).json({ error: "raw_tape_stream_failed", source: "schwab" });
    else res.end();
  }
});

router.get("/tape/spx", (req, res) => {
  const since = req.query["since"] as string | undefined;
  const ticks = getDeskTapeSince(since);
  const asOfMs = ticks.length ? ticks[ticks.length - 1]!.ts_ms : Date.now();
  res.json(
    deskEnvelope(
      { ticks, session_date: deskSessionDateEt(new Date(asOfMs)) },
      "schwab",
      asOfMs,
      "schwab_streamer",
    ),
  );
});

router.get("/chains", async (req, res) => {
  const resolved = deskResolveSource(req.query["source"] as string | undefined, ["schwab", "schwab2"] as const);
  if ("error" in resolved) {
    res.status(400).json({ error: resolved.error, source: resolved.source, allowed: resolved.allowed });
    return;
  }

  const symbol = ((req.query["symbol"] as string) ?? "SPX").toUpperCase();
  const expiration = req.query["expiration"] as string;
  if (!expiration || !/^\d{4}-\d{2}-\d{2}/.test(expiration)) {
    res.status(400).json({ error: "expiration required (YYYY-MM-DD)", source: "schwab" });
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
  const schwabApp = deskSchwabRestAppFromDeskSource(resolved.source);
  const chain = await deskFetchSchwabChain(symbol, expiration, chainOpts, schwabApp);
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
  const sourceLabel = chain.app === "app2" ? "schwab2" : "schwab";
  const feed = chain.app === "app2" ? "schwab2_rest" : "schwab_chains";
  res.json(deskEnvelope(payload, sourceLabel, chain.asOfMs, feed));
});

router.get("/flow", async (req, res) => {
  const rawSource = req.query["source"] as string | undefined;
  const resolved =
    rawSource == null || String(rawSource).trim() === ""
      ? deskUwAddonEnabled()
        ? { source: "unusual_whales" as const }
        : null
      : deskResolveSource(rawSource, ["unusual_whales"] as const);
  if (resolved === null) {
    const body: Record<string, unknown> = {
      error: deskUwRouteErrorForFeed("uw_flow", "not_configured"),
      source: "unusual_whales",
    };
    const lastUwStatus = deskUwLastHttpStatus();
    if (lastUwStatus != null) body.lastUwStatus = lastUwStatus;
    res.status(503).json(body);
    return;
  }
  if ("error" in resolved) {
    res.status(400).json({ error: resolved.error, source: resolved.source, allowed: resolved.allowed });
    return;
  }

  const symbol = req.query["symbol"] as string | undefined;
  const result = deskGetCachedUwFlow(symbol);
  if (!result) {
    const body: Record<string, unknown> = {
      error: deskUwRouteErrorForFeed("uw_flow", "uw_flow_snapshot_unavailable"),
      source: "unusual_whales",
    };
    const lastUwStatus = deskUwLastHttpStatus();
    if (lastUwStatus != null) body.lastUwStatus = lastUwStatus;
    res.status(503).json(body);
    return;
  }

  const session_date = deskSessionDateEt(new Date(result.asOfMs));
  res.json(
    deskEnvelope(
      { alerts: result.alerts, symbol: result.symbol ?? symbol ?? null, session_date },
      "unusual_whales",
      result.asOfMs,
      "uw_flow",
    ),
  );
});

router.get("/bars", async (req, res) => {
  const resolved = deskResolveSource(req.query["source"] as string | undefined, [
    "schwab",
    "schwab2",
    "eodhd",
    "alpaca_paper",
    "alpaca",
  ] as const);
  if ("error" in resolved) {
    res.status(400).json({ error: resolved.error, source: resolved.source, allowed: resolved.allowed });
    return;
  }

  const symbol = ((req.query["symbol"] as string) ?? "SPY").toUpperCase();
  const timeframe = (req.query["timeframe"] as string) ?? "1d";
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "100"), 10) || 100, 500);
  const session_date = deskSessionDateEt();

  if (resolved.source === "eodhd") {
    const r = await deskFetchEodhdBars(symbol, limit);
    if (!r.ok) {
      const status = r.error === "not_configured" ? 503 : r.status && r.status >= 400 ? r.status : 502;
      res.status(status).json({ error: r.error ?? "eodhd_fetch_failed", source: "eodhd" });
      return;
    }
    res.json(
      deskEnvelope({ symbol, timeframe: "eod", bars: r.bars, session_date }, "eodhd", r.asOfMs, "eodhd"),
    );
    return;
  }

  if (resolved.source === "alpaca") {
    const r = await deskAlpacaMarketBars(symbol, timeframe, limit);
    if (!r.ok) {
      const status = r.error === "not_configured" ? 503 : r.status && r.status >= 400 ? r.status : 502;
      res.status(status).json({ error: r.error ?? "alpaca_bars_failed", source: r.source });
      return;
    }
    res.json(
      deskEnvelope(
        { symbol, timeframe, bars: r.bars, session_date },
        r.source,
        r.asOfMs,
        "alpaca_paper",
      ),
    );
    return;
  }

  if (resolved.source === "alpaca_paper") {
    const r = await deskAlpacaPaperBars(symbol, timeframe, limit);
    if (!r.ok) {
      const status = r.error === "not_configured" ? 503 : r.status && r.status >= 400 ? r.status : 502;
      res.status(status).json({ error: r.error ?? "alpaca_paper_bars_failed", source: "alpaca_paper" });
      return;
    }
    res.json(
      deskEnvelope(
        { symbol, timeframe, bars: r.bars, session_date },
        "alpaca_paper",
        r.asOfMs,
        "alpaca_paper",
      ),
    );
    return;
  }

  const schwabApp = deskSchwabRestAppFromDeskSource(resolved.source);
  const { bars, asOfMs, app } = await deskFetchSchwabBars(symbol, timeframe, limit, schwabApp);
  const sourceLabel = app === "app2" ? "schwab2" : "schwab";
  const feed = app === "app2" ? "schwab2_rest" : "schwab_quotes_rest";
  res.json(
    deskEnvelope({ symbol, timeframe, bars, session_date: deskSessionDateEt(new Date(asOfMs)) }, sourceLabel, asOfMs, feed),
  );
});

router.get("/fundamentals", async (req, res) => {
  const resolved = deskResolveSource(req.query["source"] as string | undefined, ["alphavantage"] as const);
  if ("error" in resolved) {
    res.status(400).json({ error: resolved.error, source: resolved.source, allowed: resolved.allowed });
    return;
  }
  const symbol = ((req.query["symbol"] as string) ?? "SPY").toUpperCase();
  const r = await deskFetchAlphaVantageOverview(symbol);
  if (!r.ok) {
    const status =
      r.error === "not_configured" ? 503 : r.error === "alphavantage_daily_cap" ? 429 : r.status && r.status >= 400 ? r.status : 502;
    res.status(status).json({ error: r.error ?? "fundamentals_fetch_failed", source: "alphavantage" });
    return;
  }
  res.json(
    deskEnvelope(
      { symbol, overview: r.data, session_date: deskSessionDateEt(new Date(r.asOfMs)) },
      "alphavantage",
      r.asOfMs,
      "alphavantage",
    ),
  );
});

router.get("/news", async (req, res) => {
  const resolved = deskResolveSource(req.query["source"] as string | undefined, [
    "finnhub",
    "alpaca_news",
    "alpaca",
    "alphavantage",
    "marketaux",
    "stocknews",
  ] as const);
  if ("error" in resolved) {
    res.status(400).json({ error: resolved.error, source: resolved.source, allowed: resolved.allowed });
    return;
  }

  const raw = (req.query["symbols"] as string) ?? "";
  const symbols = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const syms = symbols.length ? symbols : ["SPY"];

  if (resolved.source === "alphavantage") {
    const r = await deskFetchAlphaVantageNews(syms);
    if (!r.ok) {
      const status =
        r.error === "not_configured" ? 503 : r.error === "alphavantage_daily_cap" ? 429 : r.status && r.status >= 400 ? r.status : 502;
      res.status(status).json({ error: r.error ?? "alphavantage_news_failed", source: "alphavantage" });
      return;
    }
    res.json(
      deskEnvelope(
        { articles: r.articles, session_date: deskSessionDateEt(new Date(r.asOfMs)) },
        "alphavantage",
        r.asOfMs,
        "alphavantage",
      ),
    );
    return;
  }

  if (resolved.source === "marketaux") {
    const r = await deskFetchMarketauxNews(syms);
    if (!r.ok) {
      const status = r.error === "not_configured" ? 503 : r.status && r.status >= 400 ? r.status : 502;
      res.status(status).json({ error: r.error ?? "marketaux_news_failed", source: "marketaux" });
      return;
    }
    res.json(
      deskEnvelope(
        { articles: r.articles, session_date: deskSessionDateEt(new Date(r.asOfMs)) },
        "marketaux",
        r.asOfMs,
        "marketaux",
      ),
    );
    return;
  }

  if (resolved.source === "stocknews") {
    const r = await deskFetchStocknews(syms);
    if (!r.ok) {
      const status = r.error === "not_configured" ? 503 : r.status && r.status >= 400 ? r.status : 502;
      res.status(status).json({ error: r.error ?? "stocknews_failed", source: "stocknews" });
      return;
    }
    res.json(
      deskEnvelope(
        { articles: r.articles, session_date: deskSessionDateEt(new Date(r.asOfMs)) },
        "stocknews",
        r.asOfMs,
        "stocknews",
      ),
    );
    return;
  }

  if (resolved.source === "alpaca_news" || resolved.source === "alpaca") {
    const r = await deskFetchAlpacaNews(syms);
    if (!r.ok) {
      const status = r.error === "not_configured" ? 503 : r.status && r.status >= 400 ? r.status : 502;
      res.status(status).json({ error: r.error ?? "alpaca_news_fetch_failed", source: "alpaca_news" });
      return;
    }
    res.json(
      deskEnvelope(
        { articles: r.articles, session_date: deskSessionDateEt(new Date(r.asOfMs)) },
        "alpaca_news",
        r.asOfMs,
        "alpaca",
      ),
    );
    return;
  }

  const { articles, asOfMs } = await deskFetchNews(syms);
  res.json(
    deskEnvelope(
      { articles, session_date: deskSessionDateEt(new Date(asOfMs)) },
      "finnhub",
      asOfMs,
      "news",
    ),
  );
});

const gammaHandler =
  (feed: "live_gamma_0dte" | "live_gamma") =>
  async (req: import("express").Request, res: import("express").Response) => {
    const rawSource = req.query["source"] as string | undefined;
    const resolved =
      rawSource == null || String(rawSource).trim() === ""
        ? { source: "unusual_whales" as const }
        : deskResolveSource(rawSource, ["unusual_whales"] as const);
    if ("error" in resolved) {
      res.status(400).json({ error: resolved.error, source: resolved.source, allowed: resolved.allowed });
      return;
    }
    const defaultDate = deskSessionDateEt();
    const marketDate = deskValidateMarketDate(req.query["expiry"] as string | undefined, defaultDate);
    if (!marketDate) {
      res.status(400).json({ error: "invalid_expiry", source: "unusual_whales", feed });
      return;
    }
    const ticker = deskValidateUwTicker(req.query["ticker"] as string | undefined);
    if (!ticker) {
      res.status(400).json({ error: "invalid_ticker", source: "unusual_whales", feed });
      return;
    }
    const snap =
      feed === "live_gamma_0dte"
        ? deskGetCachedLiveGamma0dte(marketDate, ticker)
        : deskGetCachedLiveGamma(marketDate, ticker);
    if (!snap) {
      const body: Record<string, unknown> = {
        error: deskUwRouteErrorForFeed(feed, "gamma_snapshot_unavailable"),
        source: "unusual_whales",
        feed,
      };
      const lastUwStatus = deskUwLastHttpStatus();
      if (lastUwStatus != null) body.lastUwStatus = lastUwStatus;
      res.status(503).json(body);
      return;
    }
    res.json(
      deskEnvelope(
        {
          feed,
          date: snap.date,
          ...(snap.expiry ? { expiry: snap.expiry } : {}),
          ticker: snap.ticker,
          row_count: snap.row_count,
          data: snap.data,
          session_date: deskSessionDateEt(new Date(snap.asOfMs)),
        },
        "unusual_whales",
        snap.asOfMs,
        feed,
      ),
    );
  };

router.get("/gamma/live_gamma_0dte", gammaHandler("live_gamma_0dte"));
router.get("/gamma/live_gamma", gammaHandler("live_gamma"));

router.get("/net_prem/ticks", async (req, res) => {
  const rawSource = req.query["source"] as string | undefined;
  const resolved =
    rawSource == null || String(rawSource).trim() === ""
      ? { source: "unusual_whales" as const }
      : deskResolveSource(rawSource, ["unusual_whales"] as const);
  if ("error" in resolved) {
    res.status(400).json({ error: resolved.error, source: resolved.source, allowed: resolved.allowed });
    return;
  }
  const ticker = deskValidateUwTicker(req.query["ticker"] as string | undefined);
  if (!ticker) {
    res.status(400).json({ error: "invalid_ticker", source: "unusual_whales" });
    return;
  }
  const sinceParsed = deskParseSinceFromQuery({
    since: req.query["since"],
    since_ms: req.query["since_ms"],
  });
  if (!sinceParsed.ok) {
    res.status(400).json({ error: sinceParsed.error, source: "unusual_whales" });
    return;
  }
  const marketDate = deskSessionDateEt();
  const cached = deskGetCachedNetPremTicks(ticker, marketDate, sinceParsed.ms);
  if (!cached) {
    const body: Record<string, unknown> = {
      error: deskUwRouteErrorForFeed("live_net_prem", "net_prem_snapshot_unavailable"),
      source: "unusual_whales",
    };
    const lastUwStatus = deskUwLastHttpStatus();
    if (lastUwStatus != null) body.lastUwStatus = lastUwStatus;
    res.status(503).json(body);
    return;
  }
  res.json(
    deskEnvelope(
      {
        ticker: cached.ticker,
        ticks: cached.ticks,
        since_ms: sinceParsed.ms,
        date: marketDate,
        row_count: cached.ticks.length,
        session_date: deskSessionDateEt(new Date(cached.asOfMs)),
      },
      "unusual_whales",
      cached.asOfMs,
      "live_net_prem",
    ),
  );
});

export default router;
