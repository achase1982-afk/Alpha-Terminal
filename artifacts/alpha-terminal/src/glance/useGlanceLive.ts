import { useEffect, useRef, useState } from "react";
import { useQuote } from "@/hooks/useQuote";
import { useDeskFlowStream } from "@/hooks/useDeskFlowStream";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { computeHighZoneBottom, computeLowZoneTop } from "@/lib/active-trader/spxRefZone";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import type { DeskFlowMinute, DeskIndexFlowTotals } from "@/lib/active-trader/deskFlowAggregator";
import { formatEtMinute, pathStats, type GrossQuad } from "./math";

export type MinuteBar = { t: number; o: number; h: number; l: number; c: number };

export type LiveLevels = {
  zones: ZoneModel | null;
  asOfMs: number | null;
};

const EMPTY: GrossQuad = { cb: null, cs: null, pb: null, ps: null };

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseBars(body: unknown): MinuteBar[] {
  const rows = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { bars?: unknown }).bars)
      ? (body as { bars: unknown[] }).bars
      : body && typeof body === "object" && Array.isArray((body as { candles?: unknown }).candles)
        ? (body as { candles: unknown[] }).candles
        : [];
  const out: MinuteBar[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const ts =
      typeof r.ts === "string"
        ? Date.parse(r.ts)
        : typeof r.datetime === "string"
          ? Date.parse(r.datetime)
          : null;
    const t = num(r.t) ?? num(r.ts) ?? num(r.time) ?? num(r.datetime) ?? (ts != null && Number.isFinite(ts) ? ts : null);
    const o = num(r.o) ?? num(r.open);
    const h = num(r.h) ?? num(r.high);
    const l = num(r.l) ?? num(r.low);
    const c = num(r.c) ?? num(r.close);
    if (t == null || o == null || h == null || l == null || c == null) continue;
    out.push({ t, o, h, l, c });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

function etParts(ms: number): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: hour * 60 + minute };
}

export function sessionBars(bars: readonly MinuteBar[]): MinuteBar[] {
  if (bars.length === 0) return [];
  let latest = "";
  for (const bar of bars) {
    const p = etParts(bar.t);
    if (p.minutes >= 9 * 60 + 30 && p.minutes < 16 * 60 && p.date > latest) latest = p.date;
  }
  if (!latest) return [];
  return bars.filter((bar) => {
    const p = etParts(bar.t);
    return p.date === latest && p.minutes >= 9 * 60 + 30 && p.minutes < 16 * 60;
  });
}

export function sessionExtremes(bars: readonly MinuteBar[]): {
  open: number | null;
  openIsRth: boolean;
  high: number | null;
  highMinute: string | null;
  low: number | null;
  lowMinute: string | null;
  closes: number[];
} {
  const session = sessionBars(bars);
  if (session.length === 0) {
    return { open: null, openIsRth: false, high: null, highMinute: null, low: null, lowMinute: null, closes: [] };
  }
  const first = session[0]!;
  const firstEt = etParts(first.t);
  const openIsRth = firstEt.minutes === 9 * 60 + 30;
  let high = first.h;
  let highT = first.t;
  let low = first.l;
  let lowT = first.t;
  for (const bar of session) {
    if (bar.h > high) {
      high = bar.h;
      highT = bar.t;
    }
    if (bar.l < low) {
      low = bar.l;
      lowT = bar.t;
    }
  }
  return {
    open: openIsRth ? first.o : null,
    openIsRth,
    high,
    highMinute: formatEtMinute(highT),
    low,
    lowMinute: formatEtMinute(lowT),
    closes: session.map((bar) => bar.c),
  };
}

function quadFrom(index: DeskIndexFlowTotals | null, window: "1" | "5" | "15" | "day"): GrossQuad {
  if (!index) return EMPTY;
  if (window === "1") return { cb: index.callBuy1m, cs: index.callSell1m, pb: index.putBuy1m, ps: index.putSell1m };
  if (window === "5") return { cb: index.callBuy5m, cs: index.callSell5m, pb: index.putBuy5m, ps: index.putSell5m };
  if (window === "15") return { cb: index.callBuy15m, cs: index.callSell15m, pb: index.putBuy15m, ps: index.putSell15m };
  return { cb: index.callBuyDay, cs: index.callSellDay, pb: index.putBuyDay, ps: index.putSellDay };
}

function historySide(minutes: readonly DeskFlowMinute[], key: "callSell" | "callBuy" | "putSell" | "putBuy"): (number | null)[] {
  const values = minutes.map((minute) => minute[key]);
  const missing = Array<number | null>(Math.max(0, 15 - values.length)).fill(null);
  return [...missing, ...values].slice(-15);
}

export function useGlanceLive() {
  const spx = useQuote("$SPX");
  const vix = useQuote("$VIX");
  const flow = useDeskFlowStream("$SPX", true);
  const [now, setNow] = useState(() => Date.now());
  const [bars, setBars] = useState<MinuteBar[]>([]);
  const [zones, setZones] = useState<ZoneModel | null>(null);
  const [zonesAsOf, setZonesAsOf] = useState<number | null>(null);
  const [gammaSource, setGammaSource] = useState<string | null>(null);
  const indexRef = useRef<DeskIndexFlowTotals | null>(null);
  const spotRef = useRef(spx.data);
  spotRef.current = spx.data;
  const vixRef = useRef(vix.data);
  vixRef.current = vix.data;
  const [paintedSpot, setPaintedSpot] = useState(spx.data?.last ?? null);
  const [paintedVix, setPaintedVix] = useState(vix.data?.last ?? null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setPaintedSpot(spotRef.current?.last ?? null);
      setPaintedVix(vixRef.current?.last ?? null);
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    void fetchWithAuth("/api/stream/symbols", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: ["$SPX", "$VIX", "SPY", "QQQ", "IWM"] }),
      clerkTokenTimeoutMs: 1500,
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const url = "/api/market/history?symbol=%24SPX&periodType=day&period=1&frequencyType=minute&frequency=1";
        const res = await fetchWithAuth(url, { clerkTokenTimeoutMs: 1500 });
        if (!res.ok || stop) return;
        const body = await res.json();
        if (!stop) setBars(parseBars(body));
      } catch {
        /* keep the last bars */
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const url = "/api/market/at-gamma-glance?symbol=%24SPX";
        const res = await fetchWithAuth(url, { clerkTokenTimeoutMs: 1500 });
        if (!res.ok || stop) return;
        const body = (await res.json()) as { zones?: ZoneModel; asOfMs?: number; source?: string };
        if (stop || !body.zones) return;
        setZones(body.zones);
        setGammaSource(body.source ?? body.zones.levelSource ?? "gamma");
        if (typeof body.asOfMs === "number") setZonesAsOf(body.asOfMs);
      } catch {
        /* keep the last snapshot */
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, []);

  const extremes = sessionExtremes(bars);
  const windowMove = (minutes: number) => {
    const need = minutes + 1;
    if (extremes.closes.length < need) return null;
    return pathStats(extremes.closes.slice(-need));
  };
  const quote = spx.data;
  if (flow.aggregate.connection === "live" && flow.aggregate.index) indexRef.current = flow.aggregate.index;
  const flowIndex = flow.aggregate.connection === "live" ? flow.aggregate.index : indexRef.current;
  const flowObserved = flowIndex != null;
  const flowEnd = flow.aggregate.observationEndMs;
  const flowAgeSec = flowEnd != null ? Math.max(0, (now - flowEnd) / 1000) : null;
  const spotAgeSec = quote?.tradeTimeMs != null ? Math.max(0, (now - quote.tradeTimeMs) / 1000) : null;
  const vixAgeSec = vix.data?.tradeTimeMs != null ? Math.max(0, (now - vix.data.tradeTimeMs) / 1000) : null;
  const lowZone = extremes.low != null ? computeLowZoneTop(extremes.low) : null;
  const highZone = extremes.high != null ? computeHighZoneBottom(extremes.high) : null;
  const session = sessionBars(bars);
  const lastBar = session.length ? session[session.length - 1]! : null;
  const traceBars = lastBar ? session.filter((bar) => bar.t >= lastBar.t - 30 * 60_000) : [];
  const minutes = flow.aggregate.recentMinutes;

  return {
    spot: paintedSpot ?? quote?.last ?? null,
    lastClose: lastBar?.c ?? null,
    lastCloseMinute: lastBar ? formatEtMinute(lastBar.t) : null,
    previousClose: quote?.close ?? null,
    dayPoints: quote?.change ?? null,
    dayPct: quote?.changePct ?? null,
    open: extremes.open,
    high: extremes.high,
    highMinute: extremes.highMinute,
    low: extremes.low,
    lowMinute: extremes.lowMinute,
    closes: extremes.closes,
    traceBars,
    spotAgeSec,
    vix: paintedVix ?? vix.data?.last ?? null,
    vixOpen: null as number | null,
    vixLow: vix.data?.low ?? null,
    vixHigh: vix.data?.high ?? null,
    vixAgeSec,
    flow1: quadFrom(flowObserved ? flowIndex : null, "1"),
    flow5: quadFrom(flowObserved ? flowIndex : null, "5"),
    flow15: quadFrom(flowObserved ? flowIndex : null, "15"),
    flowSession: quadFrom(flowObserved ? flowIndex : null, "day"),
    flowHist: {
      cs: historySide(minutes, "callSell"),
      cb: historySide(minutes, "callBuy"),
      ps: historySide(minutes, "putSell"),
      pb: historySide(minutes, "putBuy"),
    },
    flowAgeSec,
    flowConnection: flow.aggregate.connection,
    gammaSource,
    zones,
    zonesAsOf,
    zonesAgeSec: zonesAsOf != null ? Math.max(0, (now - zonesAsOf) / 1000) : null,
    lowZone,
    highZone,
    windows: {
      m1: windowMove(1)?.move ?? null,
      m5: windowMove(5)?.move ?? null,
      m10: windowMove(10)?.move ?? null,
      m15: windowMove(15)?.move ?? null,
      m20: windowMove(20)?.move ?? null,
    },
    m10: windowMove(10),
    m15: windowMove(15),
  };
}
