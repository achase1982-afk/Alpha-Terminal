import { useEffect, useMemo, useRef, useState } from "react";
import {
  AtLadderVolumeHeatEngine,
  AT_LADDER_HEAT_WINDOW_MS,
  type LadderHeatCellView,
} from "./atLadderVolumeHeatEngine";
import { getAtFixtureOverride } from "./atFixtureBridge";
import { isIndexSymbol } from "./atGlanceMode";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useOptionsStreamStore } from "@/lib/options-stream-store";
import {
  ladderVolumeHeatFixtureSamples,
  type AtLadderVolumeHeatFixtureScene,
} from "./atLadderVolumeHeatFixture";

/** Single-name chain poll — ~1 Hz (Schwab-safe while AT ladder is open). */
export const AT_LADDER_HEAT_POLL_MS = 1_000;

/** Cap React paints so quote ticks do not thrash the ladder (~10 Hz). */
const HEAT_PAINT_MIN_MS = 100;

export type AtLadderHeatSourceMeta = {
  kind: "stream" | "poll" | "fixture" | "off";
  /** Shown in glance header only while the feed is credibly fresh. */
  label: string;
  sourceFresh: boolean;
  lastSourceRxMs: number | null;
  pollMs?: number;
};

function formatPollBadge(
  engine: AtLadderVolumeHeatEngine,
  now: number,
  pollMs: number,
): { label: string; sourceFresh: boolean } {
  const chain = engine.getPollChainMeta();
  const volRx = engine.getSourceLastRxMs();
  const volFresh = volRx != null && now - volRx <= 12_000;
  const cadenceMs = chain?.ttlMs ?? 25_000;
  const coarseCadence = cadenceMs >= AT_LADDER_HEAT_WINDOW_MS - 500;

  if (volFresh && !coarseCadence) {
    return {
      label: `Live · ~${Math.round(pollMs / 1000)}s poll`,
      sourceFresh: true,
    };
  }
  if (chain?.fetchedAt != null) {
    const ageSec = Math.max(0, Math.round((now - chain.fetchedAt) / 1000));
    const cadenceSec = Math.round(cadenceMs / 1000);
    const withinTtl = now - chain.fetchedAt <= cadenceMs + 12_000;
    return {
      label: withinTtl ? `Snapshot · ${ageSec}s old · ~${cadenceSec}s` : "",
      sourceFresh: withinTtl,
    };
  }
  return { label: "", sourceFresh: false };
}

function heatMapsEqual(
  a: Record<string, LadderHeatCellView>,
  b: Record<string, LadderHeatCellView>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const x = a[k];
    const y = b[k];
    if (!x || !y) return false;
    if (x.availability !== y.availability) return false;
    if (Math.abs(x.intensity - y.intensity) > 0.015) return false;
    if (x.contracts30s !== y.contracts30s) return false;
  }
  return true;
}

type RestChainLeg = {
  streamKey?: string;
  schwabSymbol?: string;
  bid?: number | null;
  ask?: number | null;
  last?: number | null;
  volume?: number | null;
  volumeSampledAt?: number;
  openInterest?: number | null;
  iv?: number | null;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
};

function applyRestQuotes(engine: AtLadderVolumeHeatEngine, legs: RestChainLeg[], want: Set<string>, now: number): void {
  for (const leg of legs) {
    const key = (leg.streamKey ?? leg.schwabSymbol ?? "").trim();
    if (!key || (want.size > 0 && !want.has(key))) continue;
    useOptionsStreamStore.getState().mergeTick({
      key,
      bid: leg.bid ?? null,
      ask: leg.ask ?? null,
      last: leg.last ?? null,
      bidSize: null,
      askSize: null,
      volume: leg.volume ?? null,
      openInterest: leg.openInterest ?? null,
      iv: leg.iv ?? null,
      delta: leg.delta ?? null,
      gamma: leg.gamma ?? null,
      theta: leg.theta ?? null,
      vega: leg.vega ?? null,
      mark: null,
      change: null,
      lastSize: null,
      underlyingPrice: null,
      quoteTime: now,
      tradeTime: null,
      ts: now,
      volumeSample: null,
    });
    if (
      leg.volume != null &&
      Number.isFinite(leg.volume) &&
      leg.volumeSampledAt != null &&
      leg.volumeSampledAt > 0
    ) {
      engine.ingestCumulative(key, leg.volume, leg.volumeSampledAt);
    }
  }
}

function restWindowPath(
  symbol: string,
  window: { fromDate: string; toDate: string; strikeCount: number; range: string },
): string {
  const q = new URLSearchParams({
    symbol: symbol.replace(/^\$/, ""),
    strikeCount: String(window.strikeCount),
    contractType: "ALL",
    range: window.range,
    fromDate: window.fromDate,
    toDate: window.toDate,
    ladderHeat: "1",
  });
  return `/api/market/options?${q.toString()}`;
}

export function useAtLadderVolumeHeat(input: {
  symbol: string;
  streamKeys: string[];
  skipNetwork?: boolean;
  /** Visible expiry window. Polled about once a second only when the stream goes quiet. */
  restWindow?: { fromDate: string; toDate: string; strikeCount: number; range: string };
}): { heatByKey: Record<string, LadderHeatCellView>; source: AtLadderHeatSourceMeta } {
  const engineRef = useRef(new AtLadderVolumeHeatEngine({ scaleFloorContracts: 150 }));
  const [heatByKey, setHeatByKey] = useState<Record<string, LadderHeatCellView>>({});
  const [tick, setTick] = useState(0);
  const streamKeysRef = useRef(input.streamKeys);
  streamKeysRef.current = input.streamKeys;
  const volumeSigRef = useRef(new Map<string, string>());
  const streamRxRef = useRef<number | null>(null);
  const restWriteRef = useRef(false);
  const restWindowRef = useRef(input.restWindow);
  restWindowRef.current = input.restWindow;
  const [restActive, setRestActive] = useState(false);

  const fx = getAtFixtureOverride();
  const scene =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("scene") : null;
  const heatScene = (scene ?? "") as AtLadderVolumeHeatFixtureScene;

  const mode: AtLadderHeatSourceMeta["kind"] = useMemo(() => {
    if (fx && heatScene.startsWith("heat-")) return "fixture";
    if (input.skipNetwork) return "off";
    return isIndexSymbol(input.symbol) ? "stream" : "poll";
  }, [fx, heatScene, input.skipNetwork, input.symbol]);

  const schedulePaintRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const engine = engineRef.current;
    const live = mode === "stream" || mode === "poll" || mode === "fixture";
    engine.setSourceLive(live);
  }, [mode]);

  useEffect(() => {
    let raf = 0;
    let paintPending = false;
    let lastPaintMs = 0;

    const flushPaint = (now: number) => {
      raf = 0;
      if (!paintPending) return;
      if (now - lastPaintMs < HEAT_PAINT_MIN_MS) {
        raf = requestAnimationFrame(flushPaint);
        return;
      }
      paintPending = false;
      lastPaintMs = now;
      const keys = streamKeysRef.current;
      engineRef.current.setNowMs(now);
      const next = engineRef.current.snapshot(keys);
      setHeatByKey((prev) => (heatMapsEqual(prev, next) ? prev : next));
      setTick((n) => n + 1);
    };

    const requestPaint = () => {
      paintPending = true;
      if (!raf) raf = requestAnimationFrame(flushPaint);
    };

    schedulePaintRef.current = requestPaint;

    const decay = window.setInterval(() => {
      if (mode === "off") return;
      requestPaint();
    }, HEAT_PAINT_MIN_MS);

    return () => {
      schedulePaintRef.current = null;
      if (raf) cancelAnimationFrame(raf);
      window.clearInterval(decay);
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== "fixture" || !heatScene.startsWith("heat-")) return;
    const engine = engineRef.current;
    const samples = ladderVolumeHeatFixtureSamples(heatScene);
    const base = Date.now();
    let lastRx = base;
    for (const s of samples) {
      const rx = s.sampleMs ?? base + (s.offsetMs ?? 0);
      lastRx = Math.max(lastRx, rx);
      engine.setNowMs(lastRx);
      engine.ingestCumulative(s.contract, s.cumulativeVol, rx);
    }
    engine.setNowMs(Math.max(Date.now(), lastRx + 50));
    schedulePaintRef.current?.();
  }, [mode, heatScene]);

  useEffect(() => {
    if (mode !== "stream") return;
    const engine = engineRef.current;

    const ingestVolumeSamples = () => {
      const ticks = useOptionsStreamStore.getState().ticks;
      const keys = streamKeysRef.current;
      let ingested = false;
      for (const key of keys) {
        const sample = ticks[key]?.volumeSample;
        if (!sample) continue;
        const sig = `${sample.cumulativeVol}|${sample.tradeTimeMs}`;
        if (volumeSigRef.current.get(key) === sig) continue;
        volumeSigRef.current.set(key, sig);
        engine.ingestCumulative(key, sample.cumulativeVol, sample.tradeTimeMs);
        ingested = true;
      }
      return ingested;
    };

    ingestVolumeSamples();
    const now = Date.now();
    const ticksNow = useOptionsStreamStore.getState().ticks;
    for (const key of streamKeysRef.current) {
      const ts = ticksNow[key]?.ts;
      if (ts && now - ts <= 12_000) {
        streamRxRef.current = ts;
        break;
      }
    }

    const unsub = useOptionsStreamStore.subscribe((state, prev) => {
      if (restWriteRef.current) return;
      const keys = streamKeysRef.current;
      for (const key of keys) {
        const ts = state.ticks[key]?.ts;
        if (ts && ts !== prev.ticks[key]?.ts) {
          streamRxRef.current = Date.now();
          break;
        }
      }
      let ingested = false;
      for (const key of keys) {
        const sample = state.ticks[key]?.volumeSample;
        const prevSample = prev.ticks[key]?.volumeSample;
        if (
          !sample ||
          (prevSample?.cumulativeVol === sample.cumulativeVol &&
            prevSample?.tradeTimeMs === sample.tradeTimeMs)
        ) {
          continue;
        }
        const sig = `${sample.cumulativeVol}|${sample.tradeTimeMs}`;
        volumeSigRef.current.set(key, sig);
        engine.ingestCumulative(key, sample.cumulativeVol, sample.tradeTimeMs);
        ingested = true;
      }
      if (ingested) schedulePaintRef.current?.();
    });

    return () => unsub();
  }, [mode, input.streamKeys.join("|")]);

  useEffect(() => {
    if (mode !== "poll" || input.skipNetwork) return;
    let cancelled = false;
    const engine = engineRef.current;
    const sym = input.symbol.replace(/^\$/, "");

    const poll = async () => {
      try {
        const res = await fetchWithAuth(
          `/api/market/options?symbol=${encodeURIComponent(sym)}&strikeCount=40&contractType=ALL&ladderHeat=1`,
          { clerkTokenTimeoutMs: 4_000 },
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          fetchedAt?: number;
          cacheTtlMs?: number;
          calls?: RestChainLeg[];
          puts?: RestChainLeg[];
        };
        const chainFetchedAt = data.fetchedAt ?? Date.now();
        const cacheTtlMs = data.cacheTtlMs ?? 25_000;
        engine.setPollChainMeta({ fetchedAt: chainFetchedAt, ttlMs: cacheTtlMs });
        const want = new Set(input.streamKeys);
        restWriteRef.current = true;
        try {
          applyRestQuotes(engine, [...(data.calls ?? []), ...(data.puts ?? [])], want, Date.now());
        } finally {
          restWriteRef.current = false;
        }
        schedulePaintRef.current?.();
      } catch {
        /* next poll */
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), AT_LADDER_HEAT_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [mode, input.skipNetwork, input.symbol, input.streamKeys.join("|")]);

  useEffect(() => {
    if (mode !== "stream" || input.skipNetwork) {
      setRestActive(false);
      return;
    }
    let cancelled = false;
    const armedAt = Date.now();

    const poll = async () => {
      const windowQuery = restWindowRef.current;
      if (!windowQuery) return;
      try {
        const res = await fetchWithAuth(restWindowPath(input.symbol, windowQuery), {
          clerkTokenTimeoutMs: 4_000,
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          fetchedAt?: number;
          cacheTtlMs?: number;
          calls?: RestChainLeg[];
          puts?: RestChainLeg[];
        };
        const engine = engineRef.current;
        engine.setPollChainMeta({
          fetchedAt: data.fetchedAt ?? Date.now(),
          ttlMs: data.cacheTtlMs ?? 1_000,
        });
        restWriteRef.current = true;
        try {
          applyRestQuotes(
            engine,
            [...(data.calls ?? []), ...(data.puts ?? [])],
            new Set(streamKeysRef.current),
            Date.now(),
          );
        } finally {
          restWriteRef.current = false;
        }
        if (!cancelled) setRestActive(true);
        schedulePaintRef.current?.();
      } catch {
        /* next poll */
      }
    };

    const id = window.setInterval(() => {
      const now = Date.now();
      const rx = streamRxRef.current;
      const wsFresh = rx != null && now - rx <= 12_000;
      if (wsFresh) {
        setRestActive(false);
        return;
      }
      if (rx == null && now - armedAt < 4_000) return;
      void poll();
    }, AT_LADDER_HEAT_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [
    mode,
    input.skipNetwork,
    input.symbol,
    input.streamKeys.join("|"),
    input.restWindow?.fromDate,
    input.restWindow?.toDate,
    input.restWindow?.range,
    input.restWindow?.strikeCount,
  ]);

  const source: AtLadderHeatSourceMeta = useMemo(() => {
    const engine = engineRef.current;
    const now = Date.now();
    engine.setNowMs(now);
    const lastSourceRxMs = engine.getSourceLastRxMs();

    if (mode === "stream") {
      const rx = streamRxRef.current;
      const wsFresh = rx != null && now - rx <= 12_000;
      const usingRest = !wsFresh && restActive;
      return {
        kind: usingRest ? "poll" : "stream",
        label: usingRest ? "REST" : "WS",
        sourceFresh: wsFresh || usingRest || rx == null,
        lastSourceRxMs,
        pollMs: usingRest ? AT_LADDER_HEAT_POLL_MS : undefined,
      };
    }

    if (mode === "poll") {
      const { sourceFresh } = formatPollBadge(engine, now, AT_LADDER_HEAT_POLL_MS);
      return {
        kind: mode,
        label: sourceFresh ? "REST" : "",
        sourceFresh,
        lastSourceRxMs,
        pollMs: AT_LADDER_HEAT_POLL_MS,
      };
    }

    if (mode === "fixture") {
      const sourceFresh = engine.isSourceFresh(now);
      return {
        kind: mode,
        label: sourceFresh ? "Live · stream" : "",
        sourceFresh,
        lastSourceRxMs,
      };
    }

    return {
      kind: mode,
      label: "",
      sourceFresh: false,
      lastSourceRxMs,
    };
  }, [heatByKey, mode, tick, restActive]);

  return { heatByKey, source };
}