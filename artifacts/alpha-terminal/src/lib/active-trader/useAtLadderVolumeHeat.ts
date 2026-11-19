import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AtLadderVolumeHeatEngine, AT_LADDER_HEAT_WINDOW_MS } from "./atLadderVolumeHeatEngine";
import {
  createAtLadderHeatStore,
  publishAtLadderHeat,
  type AtLadderHeatStore,
} from "./atLadderHeatStore";
import { getAtFixtureOverride } from "./atFixtureBridge";
import { isIndexSymbol } from "./atGlanceMode";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useOptionsStreamStore, type OptionTick } from "@/lib/options-stream-store";
import {
  defaultFixtureLadderVolumeSamples,
  ladderVolumeHeatFixtureSamples,
  type AtLadderVolumeHeatFixtureScene,
} from "./atLadderVolumeHeatFixture";
import { equityOptionsSessionEnded } from "@workspace/order-ticket-math";

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
  const batch: OptionTick[] = [];
  for (const leg of legs) {
    const rawKey = leg.streamKey ?? leg.schwabSymbol ?? "";
    const key = want.has(rawKey) ? rawKey : rawKey.trim();
    if (!key || (want.size > 0 && !want.has(key))) continue;
    batch.push({
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
  // One store write for the whole poll body, not one per contract.
  if (batch.length > 0) useOptionsStreamStore.getState().mergeTicks(batch);
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

export type AtLadderSeedContractVolume = {
  key: string;
  volume?: number | null;
  volumeSampledAt?: number | null;
};

export function useAtLadderVolumeHeat(input: {
  symbol: string;
  streamKeys: string[];
  skipNetwork?: boolean;
  /** Visible expiry window. Polled when the stream volume feed goes quiet. */
  restWindow?: { fromDate: string; toDate: string; strikeCount: number; range: string };
  /** Initial chain contract volumes so the first live tick computes a delta immediately. */
  seedContracts?: readonly AtLadderSeedContractVolume[];
}): { heatStore: AtLadderHeatStore; source: AtLadderHeatSourceMeta } {
  const engineRef = useRef<AtLadderVolumeHeatEngine | null>(null);
  if (engineRef.current == null) {
    engineRef.current = new AtLadderVolumeHeatEngine({ staleAfterMs: 35_000 });
  }
  const [heatStore] = useState(createAtLadderHeatStore);
  const streamKeysRef = useRef(input.streamKeys);
  streamKeysRef.current = input.streamKeys;
  const volumeSigRef = useRef(new Map<string, string>());
  const streamRxRef = useRef<number | null>(null);
  const streamVolRxRef = useRef<number | null>(null);
  const restWriteRef = useRef(false);
  const restWindowRef = useRef(input.restWindow);
  restWindowRef.current = input.restWindow;
  const [restActive, setRestActive] = useState(false);
  const restActiveRef = useRef(restActive);
  restActiveRef.current = restActive;

  const fx = getAtFixtureOverride();
  const scene =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("scene") : null;
  const heatScene = (scene ?? "") as AtLadderVolumeHeatFixtureScene;

  const mode: AtLadderHeatSourceMeta["kind"] = useMemo(() => {
    if (fx) return "fixture";
    if (input.skipNetwork) return "off";
    return isIndexSymbol(input.symbol) ? "stream" : "poll";
  }, [fx, input.skipNetwork, input.symbol]);

  const schedulePaintRef = useRef<(() => void) | null>(null);

  const readSource = useCallback((): AtLadderHeatSourceMeta => {
    const engine = engineRef.current!;
    const now = Date.now();
    engine.setNowMs(now);
    const lastSourceRxMs = engine.getSourceLastRxMs();

    if (mode === "stream") {
      const rx = streamRxRef.current;
      const wsFresh = rx != null && now - rx <= 12_000;
      const usingRest = !wsFresh && restActiveRef.current;
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
  }, [mode]);

  const [source, setSource] = useState<AtLadderHeatSourceMeta>(readSource);
  /** The header badge only re-renders when what it shows changes, not on every heat repaint. */
  const syncSource = useCallback(() => {
    const next = readSource();
    setSource((prev) =>
      prev.kind === next.kind &&
      prev.label === next.label &&
      prev.sourceFresh === next.sourceFresh &&
      prev.pollMs === next.pollMs
        ? prev
        : next,
    );
  }, [readSource]);

  useEffect(() => {
    syncSource();
  }, [syncSource, restActive]);

  useEffect(() => {
    const engine = engineRef.current!;
    const live = mode === "stream" || mode === "poll" || mode === "fixture";
    engine.setSourceLive(live);
  }, [mode]);

  useEffect(() => {
    let raf = 0;
    let paintPending = false;
    let lastPaintMs = 0;

    const flushPaint = (rafNow: number) => {
      raf = 0;
      if (!paintPending) return;
      if (rafNow - lastPaintMs < HEAT_PAINT_MIN_MS) {
        raf = requestAnimationFrame(flushPaint);
        return;
      }
      paintPending = false;
      lastPaintMs = rafNow;
      const keys = streamKeysRef.current;
      const engine = engineRef.current!;
      const now = Date.now();
      engine.setNowMs(now);
      engine.setVolumeMode(equityOptionsSessionEnded(now) ? "session" : "rolling");
      publishAtLadderHeat(heatStore, engine.snapshot(keys));
      syncSource();
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
  }, [mode, heatStore, syncSource]);

  useEffect(() => {
    if (mode !== "fixture") return;
    const engine = engineRef.current!;
    const isNamedHeatScene = heatScene.startsWith("heat-");
    const samples = isNamedHeatScene
      ? ladderVolumeHeatFixtureSamples(heatScene)
      : defaultFixtureLadderVolumeSamples();
    if (!samples.length) return;
    const cumByContract = new Map<string, number>();
    const deltaByContract = new Map<string, number>();
    const base = Date.now();
    let lastRx = base;
    for (const s of samples) {
      const rx = s.sampleMs ?? base + (s.offsetMs ?? 0);
      lastRx = Math.max(lastRx, rx);
      const prev = cumByContract.get(s.contract);
      if (prev != null && s.cumulativeVol > prev) {
        deltaByContract.set(s.contract, s.cumulativeVol - prev);
      }
      cumByContract.set(s.contract, s.cumulativeVol);
      engine.setNowMs(lastRx);
      engine.ingestCumulative(s.contract, s.cumulativeVol, rx);
    }
    engine.setNowMs(Math.max(Date.now(), lastRx + 50));
    schedulePaintRef.current?.();
    if (isNamedHeatScene) return;

    const id = window.setInterval(() => {
      const now = Date.now();
      engine.setNowMs(now);
      for (const [contract, step] of deltaByContract) {
        const nextCum = (cumByContract.get(contract) ?? 2_000) + Math.max(1, Math.round(step * 0.12));
        cumByContract.set(contract, nextCum);
        engine.ingestCumulative(contract, nextCum, now);
      }
      schedulePaintRef.current?.();
    }, 2_500);
    return () => window.clearInterval(id);
  }, [mode, heatScene]);

  useEffect(() => {
    if (mode === "off" || mode === "fixture" || !input.seedContracts?.length) return;
    const engine = engineRef.current!;
    const now = Date.now();
    let seeded = false;
    for (const c of input.seedContracts) {
      if (!c.key || c.volume == null || !Number.isFinite(c.volume) || c.volume < 0) continue;
      const rx = c.volumeSampledAt != null && c.volumeSampledAt > 0 ? c.volumeSampledAt : now;
      const sig = `seed|${c.volume}`;
      if (volumeSigRef.current.has(c.key)) continue;
      volumeSigRef.current.set(c.key, sig);
      engine.ingestCumulative(c.key, c.volume, rx);
      seeded = true;
    }
    if (seeded) schedulePaintRef.current?.();
  }, [mode, input.seedContracts]);

  useEffect(() => {
    if (mode !== "stream") return;
    const engine = engineRef.current!;

    const normalizeSampleMs = (rawMs: number | null | undefined, nowMs: number): number => {
      if (rawMs == null || !Number.isFinite(rawMs) || rawMs <= 0) return nowMs;
      return Math.min(nowMs, Math.max(rawMs, nowMs - 5_000));
    };

    const ingestVolumeSamples = () => {
      const ticks = useOptionsStreamStore.getState().ticks;
      const keys = streamKeysRef.current;
      const nowMs = Date.now();
      let ingested = false;
      for (const key of keys) {
        const t = ticks[key];
        if (!t) continue;
        const sample = t.volumeSample;
        if (sample) {
          const rx = normalizeSampleMs(sample.tradeTimeMs, nowMs);
          const sig = `${sample.cumulativeVol}|${sample.tradeTimeMs}`;
          if (volumeSigRef.current.get(key) === sig) continue;
          volumeSigRef.current.set(key, sig);
          engine.ingestCumulative(key, sample.cumulativeVol, rx);
          streamVolRxRef.current = nowMs;
          ingested = true;
          continue;
        }
        if (t.volume != null && Number.isFinite(t.volume) && t.volume >= 0) {
          const sig = `vol|${t.volume}`;
          if (volumeSigRef.current.get(key) === sig) continue;
          volumeSigRef.current.set(key, sig);
          const rx = normalizeSampleMs(t.tradeTime ?? t.ts, nowMs);
          engine.ingestCumulative(key, t.volume, rx);
          ingested = true;
        }
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
      const nowMs = Date.now();
      for (const key of keys) {
        const ts = state.ticks[key]?.ts;
        if (ts && ts !== prev.ticks[key]?.ts) {
          streamRxRef.current = nowMs;
          break;
        }
      }
      let ingested = false;
      for (const key of keys) {
        const curr = state.ticks[key];
        const prevTick = prev.ticks[key];
        if (!curr) continue;
        const sample = curr.volumeSample;
        const prevSample = prevTick?.volumeSample;
        if (
          sample &&
          (prevSample?.cumulativeVol !== sample.cumulativeVol ||
            prevSample?.tradeTimeMs !== sample.tradeTimeMs)
        ) {
          const sig = `${sample.cumulativeVol}|${sample.tradeTimeMs}`;
          volumeSigRef.current.set(key, sig);
          engine.ingestCumulative(key, sample.cumulativeVol, normalizeSampleMs(sample.tradeTimeMs, nowMs));
          streamVolRxRef.current = nowMs;
          ingested = true;
          continue;
        }
        if (
          curr.volume != null &&
          Number.isFinite(curr.volume) &&
          curr.volume >= 0 &&
          curr.volume !== prevTick?.volume
        ) {
          const sig = `vol|${curr.volume}`;
          volumeSigRef.current.set(key, sig);
          engine.ingestCumulative(key, curr.volume, normalizeSampleMs(curr.tradeTime ?? curr.ts, nowMs));
          streamVolRxRef.current = nowMs;
          ingested = true;
        }
      }
      if (ingested) schedulePaintRef.current?.();
    });

    return () => unsub();
  }, [mode, input.streamKeys.join("|")]);

  useEffect(() => {
    if (mode !== "poll" || input.skipNetwork) return;
    let cancelled = false;
    const engine = engineRef.current!;
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
        const engine = engineRef.current!;
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

    let lastRestPollAt = 0;
    const initialKick = window.setTimeout(() => {
      const now = Date.now();
      const volRx = streamVolRxRef.current;
      if (volRx != null && now - volRx <= 2_000) return;
      lastRestPollAt = now;
      void poll();
    }, 600);
    const id = window.setInterval(() => {
      const now = Date.now();
      const rx = streamRxRef.current;
      const volRx = streamVolRxRef.current;
      const wsFresh = rx != null && now - rx <= 12_000;
      const wsVolFresh = volRx != null && now - volRx <= 3_500;
      if (wsFresh && wsVolFresh) {
        setRestActive(false);
        return;
      }
      if (rx == null && now - armedAt < 800) return;
      const minGap = wsFresh ? 1_800 : AT_LADDER_HEAT_POLL_MS;
      if (now - lastRestPollAt < minGap) return;
      lastRestPollAt = now;
      if (wsFresh) setRestActive(false);
      void poll();
    }, AT_LADDER_HEAT_POLL_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(initialKick);
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

  return { heatStore, source };
}
