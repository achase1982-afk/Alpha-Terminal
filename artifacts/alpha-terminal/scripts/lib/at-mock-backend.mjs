/**
 * Local stand-in for the API server, for Active Trader ladder checks.
 *
 * Serves a production build plus the REST, SSE and WebSocket endpoints the
 * Options tab talks to, from scripts/fixtures/spx-0dte-close-2026-11-18.json.
 * No request leaves this machine and no brokerage is involved.
 *
 * The page clock is shifted into the options session (the ladder disables
 * quote cells outside it), and the same shifted clock stamps every quote.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE = path.resolve(HERE, "../fixtures/spx-0dte-close-2026-11-18.json");
const DEFAULT_DIST = path.resolve(HERE, "../../dist/public");

/** 14:30 ET on the fixture's trading day. */
export const AT_MOCK_SESSION_START_ISO = "2026-11-18T19:30:00Z";
const SESSION_CLOSE_ISO = "2026-11-18T21:00:00Z";
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const STRIKE_STEP = 5;
const UNIVERSE_HALF_WIDTH = 85;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json; charset=utf-8",
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

function blackScholes(spot, strike, years, sigma, isCall) {
  const sq = sigma * Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + 0.5 * sigma * sigma * years) / sq;
  const d2 = d1 - sq;
  const pdf = 0.3989422804 * Math.exp((-d1 * d1) / 2);
  const call = spot * normCdf(d1) - strike * normCdf(d2);
  const price = isCall ? call : call - spot + strike;
  return {
    price: Math.max(price, Math.max(0, isCall ? spot - strike : strike - spot)),
    delta: isCall ? normCdf(d1) : normCdf(d1) - 1,
    gamma: pdf / (spot * sq),
    theta: (-(spot * pdf * sigma) / (2 * Math.sqrt(years))) / 365,
    vega: (spot * pdf * Math.sqrt(years)) / 100,
  };
}

const r2 = (n) => Math.round(n * 100) / 100;

function osiKey(ymd, type, strike) {
  const [y, m, d] = ymd.split("-");
  return `${"SPXW".padEnd(6, " ")}${y.slice(2)}${m}${d}${type}${String(Math.round(strike * 1000)).padStart(8, "0")}`;
}

function businessDaysFrom(ymd, count) {
  const out = [];
  const d = new Date(`${ymd}T12:00:00Z`);
  while (out.length < count) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function createSim(fixture, clockOffsetMs, seed) {
  const rand = mulberry32(seed);
  const gauss = () => {
    let u = 0;
    while (u === 0) u = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  const now = () => Date.now() + clockOffsetMs;
  const closeMs = Date.parse(SESSION_CLOSE_ISO);
  const spotCenter = fixture.underlyingPrice;
  const state = { spot: spotCenter, high: spotCenter + 20.7, low: spotCenter - 33.0, prevClose: spotCenter - 20.2 };

  const fixtureByStrike = new Map(fixture.rows.map((r) => [r[0], r]));
  const fixtureStrikes = fixture.rows.map((r) => r[0]);
  const fxLo = Math.min(...fixtureStrikes);
  const fxHi = Math.max(...fixtureStrikes);
  const atm = Math.round(spotCenter / STRIKE_STEP) * STRIKE_STEP;
  const strikes = [];
  for (let i = -UNIVERSE_HALF_WIDTH; i <= UNIVERSE_HALF_WIDTH; i++) strikes.push(atm + i * STRIKE_STEP);

  const expirations = businessDaysFrom(fixture.expirationYmd, 5).map((ymd, i) => ({
    ymd,
    iso: `${ymd}T21:00:00.000+00:00`,
    dte: Math.round((Date.parse(`${ymd}T12:00:00Z`) - Date.parse(`${fixture.expirationYmd}T12:00:00Z`)) / 86_400_000),
    index: i,
  }));

  /** @type {Map<string, any>} */
  const contracts = new Map();
  for (const exp of expirations) {
    for (const strike of strikes) {
      const fx = exp.index === 0 ? fixtureByStrike.get(strike) : undefined;
      const edge = strike < fxLo ? fxLo - strike : strike > fxHi ? strike - fxHi : 0;
      const decay = Math.exp(-edge / 40);
      for (const type of ["C", "P"]) {
        const isCall = type === "C";
        const edgeRow = fixtureByStrike.get(strike < fxLo ? fxLo : fxHi);
        let volume;
        let openInterest;
        let rate;
        if (fx) {
          volume = isCall ? fx[1] : fx[4];
          openInterest = isCall ? fx[2] : fx[5];
          rate = isCall ? fx[3] : fx[6];
        } else if (exp.index === 0) {
          volume = Math.round((isCall ? edgeRow[1] : edgeRow[4]) * decay);
          openInterest = Math.round((isCall ? edgeRow[2] : edgeRow[5]) * decay);
          rate = 0;
        } else {
          const dist = Math.abs(strike - spotCenter);
          volume = Math.round((1800 * Math.exp(-dist / 60)) / exp.index);
          openInterest = Math.round(4200 * Math.exp(-dist / 90));
          rate = 0;
        }
        const key = osiKey(exp.ymd, type, strike);
        contracts.set(key, {
          key,
          strike,
          type,
          isCall,
          exp,
          volume,
          openInterest,
          rate,
          phase: rand() * Math.PI * 2,
          carry: 0,
          lastUpdateMs: 0,
          tradeTime: now() - Math.round(rand() * 90_000) - 1_000,
          lastVolumeTradeTimeMs: null,
          jitter: 0,
          last: null,
          lastSize: 1,
        });
      }
    }
  }

  function advanceSpot() {
    state.spot += 0.03 * (spotCenter - state.spot) + 0.32 * gauss();
    state.spot = r2(state.spot);
    if (state.spot > state.high) state.high = state.spot;
    if (state.spot < state.low) state.low = state.spot;
  }

  function quoteFor(c, t) {
    const dte0 = c.exp.index === 0;
    const years = dte0
      ? Math.max(60_000, closeMs - t) / 31_557_600_000
      : (c.exp.dte * 86_400_000 + Math.max(60_000, closeMs - t)) / 31_557_600_000;
    const sigma = dte0 ? 0.2 + 0.8 * Math.abs(Math.log(c.strike / state.spot)) : 0.16;
    const g = blackScholes(state.spot, c.strike, years, sigma, c.isCall);
    const tick = g.price < 3 ? 0.05 : 0.1;
    const spreadTicks = Math.max(1, Math.round((g.price * 0.024) / tick));
    let bid = Math.floor((g.price - (spreadTicks * tick) / 2) / tick + 1e-9) * tick + c.jitter * tick;
    if (bid < 0) bid = 0;
    const ask = bid + spreadTicks * tick;
    return {
      bid: r2(bid),
      ask: r2(ask),
      mark: r2((bid + ask) / 2),
      iv: r2(sigma * 100),
      delta: Number(g.delta.toFixed(5)),
      gamma: Number(g.gamma.toFixed(6)),
      theta: Number(g.theta.toFixed(4)),
      vega: Number(g.vega.toFixed(5)),
    };
  }

  /** Cumulative volume grows at the fixture's real per-contract rate, in lumps. */
  function advanceVolume(c, t) {
    if (c.lastUpdateMs === 0) {
      c.lastUpdateMs = t;
      return 0;
    }
    const dt = Math.min(5, (t - c.lastUpdateMs) / 1000);
    c.lastUpdateMs = t;
    if (c.rate <= 0) return 0;
    const wave = 0.55 + 0.9 * Math.abs(Math.sin(t / 23_000 + c.phase));
    c.carry += c.rate * wave * dt;
    const lump = c.rate >= 3 ? 1 + Math.floor(rand() * 6) : 1;
    if (c.carry < lump) return 0;
    const n = Math.floor(c.carry);
    c.carry -= n;
    c.volume += n;
    c.lastSize = n;
    return n;
  }

  function tickFor(c) {
    const t = now();
    const r = rand();
    c.jitter = r < 0.2 ? -1 : r > 0.8 ? 1 : 0;
    const q = quoteFor(c, t);
    const traded = advanceVolume(c, t);
    let volumeSample = null;
    if (traded > 0) {
      c.tradeTime = t;
      c.lastVolumeTradeTimeMs = t;
      c.last = rand() < 0.5 ? q.bid : q.ask;
      volumeSample = { cumulativeVol: c.volume, tradeTimeMs: t };
    }
    return {
      key: c.key,
      bid: q.bid,
      ask: q.ask,
      last: c.last ?? q.mark,
      bidSize: 5 + Math.floor(rand() * 60),
      askSize: 5 + Math.floor(rand() * 60),
      volume: c.volume,
      openInterest: c.openInterest,
      iv: q.iv,
      delta: q.delta,
      gamma: q.gamma,
      theta: q.theta,
      vega: q.vega,
      mark: q.mark,
      change: 0,
      lastSize: c.lastSize,
      underlyingPrice: state.spot,
      quoteTime: t,
      tradeTime: c.tradeTime,
      lastVolumeTradeTimeMs: c.lastVolumeTradeTimeMs,
      volumeSample,
      ts: t,
    };
  }

  function restContract(c, t) {
    const q = quoteFor(c, t);
    return {
      strike: c.strike,
      expiration: c.exp.iso,
      schwabSymbol: c.key,
      bid: q.bid,
      ask: q.ask,
      last: c.last ?? q.mark,
      volume: c.volume,
      volumeSampledAt: c.lastVolumeTradeTimeMs ?? c.tradeTime,
      quoteTimeMs: t - Math.floor(rand() * 1500),
      openInterest: c.openInterest,
      iv: q.iv,
      delta: q.delta,
      gamma: q.gamma,
      theta: q.theta,
      vega: q.vega,
      dte: c.exp.dte,
    };
  }

  function chain({ strikeCount, fromDate, toDate }) {
    const t = now();
    const total = Math.max(1, Math.min(160, Math.round(strikeCount)));
    let atmIdx = 0;
    let best = Infinity;
    for (let i = 0; i < strikes.length; i++) {
      const d = Math.abs(strikes[i] - state.spot);
      if (d < best) {
        best = d;
        atmIdx = i;
      }
    }
    const lo = Math.max(0, atmIdx - Math.floor(total / 2));
    const picked = strikes.slice(lo, lo + total);
    const exps = expirations.filter((e) => (!fromDate || e.ymd >= fromDate) && (!toDate || e.ymd <= toDate));
    const calls = [];
    const puts = [];
    for (const exp of exps) {
      for (const strike of picked) {
        calls.push(restContract(contracts.get(osiKey(exp.ymd, "C", strike)), t));
        puts.push(restContract(contracts.get(osiKey(exp.ymd, "P", strike)), t));
      }
    }
    return {
      symbol: fixture.symbol,
      underlyingPrice: state.spot,
      calls,
      puts,
      fetchedAt: t,
      cacheTtlMs: 25_000,
      chainSource: fromDate ? "index-window" : "mock-chain",
    };
  }

  function underlyingQuote() {
    const t = now();
    return {
      symbol: fixture.symbol,
      last: state.spot,
      regularLast: state.spot,
      extendedLast: state.spot,
      bid: r2(state.spot - 0.6),
      ask: r2(state.spot + 0.6),
      bidSize: null,
      askSize: null,
      change: r2(state.spot - state.prevClose),
      changePct: r2(((state.spot - state.prevClose) / state.prevClose) * 100),
      volume: null,
      high: state.high,
      low: state.low,
      close: state.prevClose,
      ts: t,
      quoteSource: "SCHWAB",
    };
  }

  return { now, state, contracts, strikes, expirations, advanceSpot, tickFor, chain, underlyingQuote, rand };
}

function wsFrame(text) {
  const payload = Buffer.from(text);
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, len]);
  else if (len < 65_536) header = Buffer.from([0x81, 126, len >> 8, len & 0xff]);
  else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function clockShimTag(offsetMs) {
  return `<script>(function(){var o=${Math.round(offsetMs)};var R=Date;function D(){if(!new.target)return new R(R.now()+o).toString();var a=arguments;var d=a.length===0?new R(R.now()+o):new (Function.prototype.bind.apply(R,[null].concat([].slice.call(a))))();Object.setPrototypeOf(d,new.target.prototype);return d;}D.prototype=R.prototype;D.now=function(){return R.now()+o;};D.parse=R.parse;D.UTC=R.UTC;window.Date=D;window.__AT_MOCK_CLOCK_OFFSET_MS__=o;})();</script>`;
}

/**
 * @param {{ distDir?: string, port?: number, fixturePath?: string, optionUpdatesPerSec?: number,
 *   optionsDelayMs?: number, seed?: number, quiet?: boolean }} [opts]
 */
export async function startAtMockBackend(opts = {}) {
  const distDir = path.resolve(opts.distDir ?? DEFAULT_DIST);
  const fixture = JSON.parse(fs.readFileSync(opts.fixturePath ?? DEFAULT_FIXTURE, "utf8"));
  const clockOffsetMs = Date.parse(AT_MOCK_SESSION_START_ISO) - Date.now();
  const sim = createSim(fixture, clockOffsetMs, opts.seed ?? 20261118);
  const control = {
    optionUpdatesPerSec: opts.optionUpdatesPerSec ?? 200,
    optionsDelayMs: opts.optionsDelayMs ?? 250,
    glance: "live",
  };
  const counters = {
    optionUpdatesSent: 0,
    optionRequests: [],
    holdPosts: 0,
    unhandled: {},
    wsClients: 0,
    startedAt: Date.now(),
  };
  /** @type {Map<string, Set<string>>} */
  const holds = new Map();
  let heldKeys = [];
  let heldCursor = 0;
  const rebuildHeld = () => {
    const all = new Set();
    for (const set of holds.values()) for (const k of set) if (sim.contracts.has(k)) all.add(k);
    heldKeys = [...all];
    for (let i = heldKeys.length - 1; i > 0; i--) {
      const j = Math.floor(sim.rand() * (i + 1));
      [heldKeys[i], heldKeys[j]] = [heldKeys[j], heldKeys[i]];
    }
    heldCursor = 0;
  };

  const wsClients = new Set();
  const sseFlowClients = new Set();
  const broadcast = (event, data) => {
    if (wsClients.size === 0) return;
    const frame = wsFrame(JSON.stringify({ event, data }));
    for (const socket of wsClients) socket.write(frame);
  };

  const indexHtml = () => {
    const html = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
    return html.replace("<head>", `<head>${clockShimTag(clockOffsetMs)}`);
  };

  const json = (res, body, status = 200) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(text);
  };

  const readBody = (req) =>
    new Promise((resolve) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
        } catch {
          resolve({});
        }
      });
    });

  let flowSeq = 1000;
  let flowIdx = 0;
  const flowFrame = (t) => {
    const b = fixture.flow1s[flowIdx++ % fixture.flow1s.length];
    return {
      type: "flow_1s",
      sym: "SPX",
      bucket_ms: Math.floor(t / 1000) * 1000 - 1000,
      call_buy: b[0],
      call_sell: b[1],
      call_mid: b[2],
      put_buy: b[3],
      put_sell: b[4],
      put_mid: b[5],
      n_l1o_updates: b[6],
      n_increments: b[6],
      n_contracts: b[6],
      src: "schwab_l1o",
      label: "Schwab L1 est.",
      seq: flowSeq++,
      src_ts_ms: t - 1,
      rx_ts_ms: t,
    };
  };
  const uwFrame = (t, i) => {
    const b = fixture.uwNpBars[i % fixture.uwNpBars.length];
    return {
      type: "uw_np_bar",
      sym: "SPX",
      bar_start_ms: Math.floor(t / 60_000) * 60_000 - 60_000,
      call_prem_bought: null,
      call_prem_sold: null,
      put_prem_bought: null,
      put_prem_sold: null,
      net_call: b[0],
      net_put: b[1],
      call_volume_ask_side: b[2],
      call_volume_bid_side: b[3],
      put_volume_ask_side: b[4],
      put_volume_bid_side: b[5],
      polled_at_ms: t,
      src: "unusual_whales",
      badge: "delayed ~1m",
      seq: flowSeq++,
      src_ts_ms: Math.floor(t / 60_000) * 60_000 - 60_000,
      rx_ts_ms: t,
    };
  };
  const sseSend = (res, obj, event) => {
    res.write(`${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(obj)}\n\n`);
  };

  const glanceBody = () => {
    const asOfLabel = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
    }).format(sim.now());
    if (control.glance === "unavailable") {
      return {
        zones: { callWall: null, putWall: null, flip: null, netGexUsdPer1Pct: null, env: null, asOfLabel: "\u2014" },
        sessionClosed: false,
        unavailable: true,
      };
    }
    return {
      zones: {
        callWall: 7350,
        putWall: 7300,
        flip: control.glance === "no-flip" ? null : 7295,
        netGexUsdPer1Pct: 1.84e9,
        env: "damping",
        asOfLabel,
        wallsRollLabel: null,
        gammaPinStrike: null,
      },
      sessionClosed: false,
      unavailable: false,
    };
  };

  async function handleApi(req, res, url) {
    const p = url.pathname;
    if (p === "/api/health") return json(res, { ok: true });
    if (p === "/api/auth/server-tokens") {
      return json(res, { market: { connected: true, expiresAt: sim.now() + 3_600_000 }, trader: null });
    }
    if (p.includes("pending-session")) return json(res, { found: false });
    if (p === "/api/dashboard-layout") return json(res, { layout: null });
    if (p === "/api/watchlists") return json(res, { watchlists: [] });
    if (p === "/api/market/options") {
      const q = {
        strikeCount: Number(url.searchParams.get("strikeCount") ?? 10),
        fromDate: url.searchParams.get("fromDate"),
        toDate: url.searchParams.get("toDate"),
        range: url.searchParams.get("range"),
      };
      counters.optionRequests.push({ at: Date.now() - counters.startedAt, ...q });
      if (control.optionsDelayMs > 0) await new Promise((r) => setTimeout(r, control.optionsDelayMs));
      return json(res, sim.chain(q));
    }
    if (p === "/api/market/quote") {
      return json(res, {
        ...sim.underlyingQuote(),
        description: "S&P 500 INDEX",
        fiftyTwoWeekHigh: 7412.3,
        fiftyTwoWeekLow: 5876.1,
        peRatio: null,
      });
    }
    if (p === "/api/market/at-gamma-glance") return json(res, glanceBody());
    if (p === "/api/market/spx-keepaway-stats") {
      return json(res, {
        stats: {
          symbol: "SPX",
          n: 221,
          startYmd: "2026-01-01",
          endYmd: "2026-11-17",
          lowSide: { median: 29.5, mean: 36.6 },
          highSide: { median: 24.2, mean: 34.6 },
        },
      });
    }
    if (p === "/api/strategist/regime") return json(res, { directionalConviction: "neutral", degraded: false });
    if (p === "/api/market/at-flow-stream") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      res.write(": connected\n\n");
      sseSend(res, { sym: "SPX", sessionClosed: false, flowFeedStatus: "streaming" }, "meta");
      const t = sim.now();
      for (let i = 0; i < fixture.uwNpBars.length; i++) {
        const f = uwFrame(t - (fixture.uwNpBars.length - 1 - i) * 60_000, i);
        sseSend(res, f);
      }
      for (let i = 30; i >= 1; i--) sseSend(res, flowFrame(t - i * 1000));
      sseFlowClients.add(res);
      req.on("close", () => sseFlowClients.delete(res));
      return undefined;
    }
    if (p === "/api/stream/quotes") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" });
      res.write(": connected\n\n");
      return undefined;
    }
    if (p === "/api/stream/snapshot") return json(res, { quotes: [sim.underlyingQuote()], status: "connected" });
    if (p === "/api/stream/option-symbols" && req.method === "POST") {
      const body = await readBody(req);
      const clientId = body.clientId ?? req.headers["x-stream-client-id"] ?? "mock";
      const holderId =
        body.holderId ?? `stream:${clientId}:${body.purpose ?? "watchlist"}${body.viewId ? `:${body.viewId}` : ""}`;
      const symbols = Array.isArray(body.symbols) ? body.symbols.filter((s) => typeof s === "string") : [];
      holds.set(holderId, new Set(symbols));
      counters.holdPosts += 1;
      rebuildHeld();
      return json(res, { ok: true, holderId, clientId });
    }
    if (p === "/api/stream/release-holds" && req.method === "POST") {
      const body = await readBody(req);
      if (typeof body.holderId === "string") holds.delete(body.holderId);
      else if (typeof body.holderPrefix === "string") {
        for (const id of [...holds.keys()]) if (id.startsWith(body.holderPrefix)) holds.delete(id);
      }
      rebuildHeld();
      return json(res, { ok: true });
    }
    if (p.startsWith("/api/stream/")) return json(res, { ok: true, quotes: [] });
    counters.unhandled[p] = (counters.unhandled[p] ?? 0) + 1;
    return json(res, {});
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/__mock/stats") {
      const upSec = (Date.now() - counters.startedAt) / 1000;
      return json(res, {
        ...counters,
        upSec,
        control,
        heldContracts: heldKeys.length,
        holders: [...holds.entries()].map(([id, set]) => ({ id, symbols: set.size })),
        spot: sim.state.spot,
        simNowIso: new Date(sim.now()).toISOString(),
      });
    }
    if (url.pathname === "/__mock/control" && req.method === "POST") {
      return void readBody(req).then((body) => {
        for (const k of Object.keys(control)) if (k in body) control[k] = body[k];
        json(res, { ok: true, control });
      });
    }
    if (url.pathname.startsWith("/api/")) {
      return void handleApi(req, res, url).catch((err) => json(res, { error: String(err) }, 500));
    }
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = path.join(distDir, rel);
    if (rel && file.startsWith(distDir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      return void fs.createReadStream(file).pipe(res);
    }
    res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
    return void res.end(indexHtml());
  });

  server.on("upgrade", (req, socket) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const key = req.headers["sec-websocket-key"];
    if (url.pathname !== "/api/ws/prices" || typeof key !== "string") {
      socket.destroy();
      return;
    }
    const accept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.setNoDelay(true);
    wsClients.add(socket);
    counters.wsClients += 1;
    const drop = () => wsClients.delete(socket);
    socket.on("close", drop);
    socket.on("error", drop);
    socket.on("data", (buf) => {
      const opcode = buf[0] & 0x0f;
      if (opcode === 0x8) {
        socket.end(Buffer.from([0x88, 0x00]));
        drop();
      } else if (opcode === 0x9) {
        socket.write(Buffer.from([0x8a, 0x00]));
      }
    });
    socket.write(wsFrame(JSON.stringify({ event: "streamerStatus", data: { status: "connected" } })));
    socket.write(wsFrame(JSON.stringify({ event: "snapshot", data: [sim.underlyingQuote()] })));
  });

  let owed = 0;
  let lastPump = Date.now();
  const pump = setInterval(() => {
    const t = Date.now();
    owed += ((t - lastPump) / 1000) * control.optionUpdatesPerSec;
    lastPump = t;
    if (owed > control.optionUpdatesPerSec) owed = control.optionUpdatesPerSec;
    if (heldKeys.length === 0 || wsClients.size === 0) {
      owed = 0;
      return;
    }
    while (owed >= 1) {
      owed -= 1;
      const c = sim.contracts.get(heldKeys[heldCursor++ % heldKeys.length]);
      broadcast("optionQuote", sim.tickFor(c));
      counters.optionUpdatesSent += 1;
    }
  }, 5);

  const spotTimer = setInterval(() => {
    sim.advanceSpot();
    broadcast("quote", sim.underlyingQuote());
  }, 250);

  let uwIdx = fixture.uwNpBars.length;
  let lastUwMinute = Math.floor(sim.now() / 60_000);
  const flowTimer = setInterval(() => {
    if (sseFlowClients.size === 0) return;
    const t = sim.now();
    const px = {
      type: "px",
      sym: fixture.symbol,
      last: sim.state.spot,
      bid: r2(sim.state.spot - 0.6),
      ask: r2(sim.state.spot + 0.6),
      seq: flowSeq++,
      src_ts_ms: t - 1,
      rx_ts_ms: t,
    };
    const flow = flowFrame(t);
    const minute = Math.floor(t / 60_000);
    const uw = minute !== lastUwMinute ? uwFrame(t, uwIdx++) : null;
    lastUwMinute = minute;
    for (const res of sseFlowClients) {
      sseSend(res, px);
      sseSend(res, flow);
      if (uw) sseSend(res, uw);
    }
  }, 1000);

  const port = opts.port ?? 4517;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  if (!opts.quiet) {
    console.log(`[at-mock] http://127.0.0.1:${port}  dist=${distDir}  page clock ${new Date(sim.now()).toISOString()}`);
  }

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    clockOffsetMs,
    control,
    counters,
    heldCount: () => heldKeys.length,
    async close() {
      clearInterval(pump);
      clearInterval(spotTimer);
      clearInterval(flowTimer);
      for (const s of wsClients) s.destroy();
      for (const r of sseFlowClients) r.end();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : fallback;
  };
  await startAtMockBackend({
    distDir: arg("dist", DEFAULT_DIST),
    port: Number(arg("port", "4517")),
    optionUpdatesPerSec: Number(arg("rate", "200")),
  });
}
