import { useEffect, useRef, useState } from "react";
import { useQuote } from "@/hooks/useQuote";
import { useDeskFlowStream } from "@/hooks/useDeskFlowStream";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { computeHighZoneBottom, computeLowZoneTop } from "@/lib/active-trader/spxRefZone";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import type { DeskIndexFlowTotals } from "@/lib/active-trader/deskFlowAggregator";
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

function quadFrom(index: DeskIndexFlowTotals | null, observed: boolean, window: "1" | "5" | "15"): GrossQuad {
  if (!index || !observed) return EMPTY;
  if (window === "1") return { cb: index.callBuy1m, cs: index.callSell1m, pb: index.putBuy1m, ps: index.putSell1m };
  if (window === "5") return { cb: index.callBuy5m, cs: index.callSell5m, pb: index.putBuy5m, ps: index.putSell5m };
  return { cb: index.callBuy15m, cs: index.callSell15m, pb: index.putBuy15m, ps: index.putSell15m };
}

export function useGlanceLive() {
  const spx = useQuote("$SPX");
  const vix = useQuote("$VIX");
  const flow = useDeskFlowStream("$SPX", true);
  const [now, setNow] = useState(() => Date.now());
  const [bars, setBars] = useState<MinuteBar[]>([]);
  const [zones, setZones] = useState<ZoneModel | null>(null);
  const [zonesAsOf, setZonesAsOf] = useState<number | null>(null);
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
    let stop = false;
    const load = async () => {
      try {
        const url = "/api/desk/v1/bars?source=schwab&symbol=%24SPX&timeframe=1m&limit=500";
        let res = await fetchWithAuth(url, { clerkTokenTimeoutMs: 1500 });
        if (!res.ok) res = await fetch(url);
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
        let res = await fetchWithAuth(url, { clerkTokenTimeoutMs: 1500 });
        if (!res.ok) res = await fetch(url);
        if (!res.ok || stop) return;
        const body = (await res.json()) as { zones?: ZoneModel; asOfMs?: number };
        if (stop || !body.zones) return;
        setZones(body.zones);
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
  const observedFlow = flow.aggregate.lastRxMs != null && (flow.aggregate.connection === "live" || flow.aggregate.connection === "no_prints");
  const flowAgeSec = flow.aggregate.lastRxMs != null ? Math.max(0, (now - flow.aggregate.lastRxMs) / 1000) : null;
  const spotAgeSec = quote?.tradeTimeMs != null ? Math.max(0, (now - quote.tradeTimeMs) / 1000) : null;
  const vixAgeSec = vix.data?.tradeTimeMs != null ? Math.max(0, (now - vix.data.tradeTimeMs) / 1000) : null;
  const lowZone = extremes.low != null ? computeLowZoneTop(extremes.low) : null;
  const highZone = extremes.high != null ? computeHighZoneBottom(extremes.high) : null;

  return {
    spot: paintedSpot ?? quote?.last ?? null,
    previousClose: quote?.close ?? null,
    dayPoints: quote?.change ?? null,
    dayPct: quote?.changePct ?? null,
    open: extremes.open,
    high: extremes.high,
    highMinute: extremes.highMinute,
    low: extremes.low,
    lowMinute: extremes.lowMinute,
    closes: extremes.closes,
    spotAgeSec,
    vix: paintedVix ?? vix.data?.last ?? null,
    vixOpen: null as number | null,
    vixLow: vix.data?.low ?? null,
    vixHigh: vix.data?.high ?? null,
    vixAgeSec,
    flow1: quadFrom(flow.aggregate.index, observedFlow, "1"),
    flow5: quadFrom(flow.aggregate.index, observedFlow, "5"),
    flow15: quadFrom(flow.aggregate.index, observedFlow, "15"),
    flowSession: EMPTY,
    flowAgeSec,
    flowConnection: flow.aggregate.connection,
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
