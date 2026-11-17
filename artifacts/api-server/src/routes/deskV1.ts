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
import { deskFetchAlpacaNews } from "../lib/desk/deskAlpacaNews.js";
import { getDeskTapeSince, registerDeskSpxSse } from "../lib/desk/deskSpxTape.js";
import { deskPersistSnapshot } from "../lib/desk/deskSnapshotStore.js";
import { deskAsofEtIso, deskSessionDateEt } from "../lib/desk/deskEt.js";
import { refreshDeskUwLiveFeeds } from "../lib/desk/deskUwLiveFeeds.js";
import { getDeskRawTapeHealth, streamDeskRawTapeNdjson } from "../lib/desk/deskSpxTapeRaw.js";
import { getDeskTapeUniverseHealth } from "../lib/desk/deskTapeUniverse.js";
import { deskResolveSource } from "../lib/desk/deskSources.js";

const router: IRouter = Router();

router.use(deskBearerAuth);

router.get("/health", async (_req, res) => {
  await refreshDeskUwLiveFeeds().catch(() => undefined);
  const now = Date.now();
  const feeds = buildDeskHealthFeeds(now);
  const tape = getDeskRawTapeHealth();
  const body = {
    feeds,
    schwab_streamer: {
      frames: tape.frames,
      bytes: tape.bytes,
      last_frame_ns: tape.last_frame_ns,
      last_frame_utc_ms: tape.last_frame_utc_ms,
      buffer_frames: tape.buffer_frames,
    },
    desk_tape_universe: getDeskTapeUniverseHealth(),
    session_date: deskSessionDateEt(new Date(now)),
    asof_et: deskAsofEtIso(new Date(now)),
  };
  void deskPersistSnapshot("health", body);
  res.json(deskEnvelope(body, "desk_health", now));
});

router.get("/quotes", async (req, res) => {
  const resolved = deskResolveSource(req.query["source"] as string | undefined, ["schwab", "tradier"] as const, "schwab");
  if ("error" in resolved) {
    res.status(400).json({ error: resolved.error, source: resolved.source, allowed: resolved.allowed });
    return;
  }

  const raw = (req.query["symbols"] as string) ?? "SPY,QQQ,$SPX";
  const symbols = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const session_date = deskSessionDateEt();

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

  const { quotes, asOfMs } = await deskFetchSchwabQuotes(symbols);
  const payload = { quotes, session_date };
  void deskPersistSnapshot("quotes", payload);
  res.json(deskEnvelope(payload, "schwab", asOfMs, "schwab_quotes_rest"));
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
  const resolved = deskResolveSource(req.query["source"] as string | undefined, ["schwab"] as const, "schwab");
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

router.get("/flow", async (req, res) => {
  const resolved = deskResolveSource(
    req.query["source"] as string | undefined,
    ["unusual_whales"] as const,
    "unusual_whales",
  );
  if ("error" in resolved) {
    res.status(400).json({ error: resolved.error, source: resolved.source, allowed: resolved.allowed });
    return;
  }

  const symbol = req.query["symbol"] as string | undefined;
  const result = await deskFetchUwFlow({ symbol });
  const session_date = deskSessionDateEt(new Date(result.asOfMs));

  if (!result.ok) {
    const status = result.error === "not_configured" ? 503 : result.status && result.status >= 400 ? result.status : 502;
    res.status(status).json({
      error: result.error ?? "uw_flow_fetch_failed",
      source: "unusual_whales",
    });
    return;
  }

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
  const resolved = deskResolveSource(
    req.query["source"] as string | undefined,
    ["finnhub", "alpaca_news"] as const,
    "finnhub",
  );
  if ("error" in resolved) {
    res.status(400).json({ error: resolved.error, source: resolved.source, allowed: resolved.allowed });
    return;
  }

  const raw = (req.query["symbols"] as string) ?? "";
  const symbols = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const syms = symbols.length ? symbols : ["SPY"];

  if (resolved.source === "alpaca_news") {
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

export default router;