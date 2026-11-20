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
import { heatSampleLightsBadge, resolveHeatSampleMs } from "./atLadderHeatSample";
import {
  reduceRestBadge,
  restBadgeFresh,
  upstreamQuoteTimeMs,
  wsSampleFresh,
  type RestBadge,
} from "./atLadderRestFreshness";

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

  const quoteMs = chain?.quoteTimeMs ?? null;
  const quoteFresh = restBadgeFresh({ quoteTimeMs: quoteMs }, now);
  if (volFresh && !coarseCadence && quoteFresh) {
    return {
      label: `Live · ~${Math.round(pollMs / 1000)}s poll`,
      sourceFresh: true,
    };
  }
  if (quoteFresh && quoteMs != null) {
    const ageSec = Math.max(0, Math.round((now - quoteMs) / 1000));
    const cadenceSec = Math.round(cadenceMs / 1000);
    return {
      label: `Snapshot · ${ageSec}s old · ~${cadenceSec}s`,
      sourceFresh: true,
    };
  }
  return { label: "", sourceFresh: false };
}

function recordRestPoll(
  engine: AtLadderVolumeHeatEngine,
  badge: RestBadge,
  outcome:
    | { ok: false }
    | { ok: true; matched: number; quoteTimeMs: number | null; receiptMs: number; ttlMs: number },
): RestBadge {
  if (!outcome.ok) {
    engine.setPollChainMeta(null);
    return reduceRestBadge(badge, { type: "error" });
  }
  if (outcome.matched === 0) return reduceRestBadge(badge, { type: "no-match" });
  const next = reduceRestBadge(badge, { type: "sample", quoteTimeMs: outcome.quoteTimeMs });
  engine.setPollChainMeta({
    fetchedAt: outcome.receiptMs,
    ttlMs: outcome.ttlMs,
    quoteTimeMs: next.quoteTimeMs,
  });
  return next;
}

type RestChainLeg = {
  streamKey?: string;
  schwabSymbol?: string;
  bid?: number | null;
  ask?: number | null;
  last?: number | null;
  volume?: number | null;
  volumeSampledAt?: number;
  quoteTimeMs?: number | null;
  openInterest?: number | null;
  iv?: number | null;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
};

const OCC_SUFFIX = /^\d{6}[CP]\d{8}$/;

/** Root plus the 15-character OCC suffix, so spacing cannot hide the same contract. */
export function canonicalOccSymbol(symbol: string | null | undefined): string | null {
  if (!symbol) return null;
  let raw = symbol.trim().toUpperCase();
  if (raw.startsWith(".")) raw = raw.slice(1);
  raw = raw.replace(/\s+/g, "");
  if (raw.length < 15) return null;
  const suffix = raw.slice(-15);
  if (!OCC_SUFFIX.test(suffix)) return null;
  const root = raw.slice(0, -15);
  if (!/^[A-Z][A-Z0-9]{0,5}$/.test(root)) return null;
  return `${root}${suffix}`;
}

function occKeyIndex(want: Set<string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const key of want) {
    const occ = canonicalOccSymbol(key);
    if (!occ || map.has(occ)) continue;
    map.set(occ, key);
  }
  return map;
}

function wantedContractKey(
  raw: string | null | undefined,
  want: Set<string>,
  occToKey: Map<string, string>,
): string | null {
  if (!raw) return null;
  const occ = canonicalOccSymbol(raw);
  if (occ) return occToKey.get(occ) ?? null;
  if (want.has(raw)) return raw;
  const trimmed = raw.trim();
  return trimmed !== raw && want.has(trimmed) ? trimmed : null;
}

function legContractKey(
  leg: RestChainLeg,
  want: Set<string>,
  occToKey: Map<string, string>,
): string | null {
  return (
    wantedContractKey(leg.streamKey, want, occToKey) ??
    wantedContractKey(leg.schwabSymbol, want, occToKey)
  );
}

export function applyRestQuotes(
  engine: AtLadderVolumeHeatEngine,
  legs: RestChainLeg[],
  want: Set<string>,
  receiptMs: number,
): { matched: number; quoteTimeMs: number | null } {
  const batch: OptionTick[] = [];
  const quoteTimes: Array<number | null> = [];
  const occToKey = occKeyIndex(want);
  const ticks = useOptionsStreamStore.getState().ticks;
  for (const leg of legs) {
    const key = legContractKey(leg, want, occToKey);
    if (!key) continue;
    const quoteTime = upstreamQuoteTimeMs(leg.quoteTimeMs);
    if (quoteTime != null) {
      const existing = ticks[key];
      const existingQuote = upstreamQuoteTimeMs(existing?.quoteTime) ?? upstreamQuoteTimeMs(existing?.ts);
      // A successful poll is not a refresh. A newer socket quote stays.
      if (existingQuote != null && quoteTime < existingQuote) continue;
    }
    quoteTimes.push(quoteTime);
    if (quoteTime == null) continue;
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
      quoteTime,
      tradeTime: null,
      ts: receiptMs,
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
  const known = quoteTimes.filter((q): q is number => q != null);
  const quoteTimeMs = quoteTimes.length > 0 && known.length === quoteTimes.length ? Math.min(...known) : null;
  return { matched: quoteTimes.length, quoteTimeMs };
}

export type LadderRestWindow = {
  fromDate: string;
  toDate: string;
  strikeCount: number;
  range: string;
  /** OCC root for the selected series, when the expiry distinguishes one. */
  series?: string;
};

function restWindowPath(symbol: string, window: LadderRestWindow): string {
  const q = new URLSearchParams({
    symbol: symbol.replace(/^\$/, ""),
    strikeCount: String(window.strikeCount),
    contractType: "ALL",
    range: window.range,
    fromDate: window.fromDate,
    toDate: window.toDate,
    ladderHeat: "1",
  });
  const series = window.series?.trim();
  if (series) q.set("series", series);
  return `/api/market/options?${q.toString()}`;
}

function sameLadderExpiry(a: LadderRestWindow | undefined, b: LadderRestWindow | undefined): boolean {
  return !!a && !!b
    && a.fromDate === b.fromDate
    && a.toDate === b.toDate
    && (a.series ?? "") === (b.series ?? "");
}

function ladderContractKeys(streamKeys: readonly string[], seedKeys: readonly string[]): Set<string> {
  const want = new Set<string>();
  for (const key of streamKeys) if (key) want.add(key);
  for (const key of seedKeys) if (key) want.add(key);
  return want;
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
  /** Selected expiry, series, and strike window. The quote fallback polls this book. */
  restWindow?: LadderRestWindow;
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
  const restBadgeRef = useRef<RestBadge>({ quoteTimeMs: null });
  const restWindowRef = useRef(input.restWindow);
  restWindowRef.current = input.restWindow;
  const seedKeysRef = useRef<string[]>([]);
  seedKeysRef.current = (input.seedContracts ?? []).map((c) => c.key).filter((key) => key.length > 0);
  const [restActive, setRestActive] = useState(false);

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
      const wsFresh = wsSampleFresh(rx, now);
      const restFresh = restBadgeFresh(restBadgeRef.current, now);
      const usingRest = !wsFresh && restFresh;
      const quoteFresh = wsFresh || restFresh;
      const sourceFresh = quoteFresh && heatSampleLightsBadge(lastSourceRxMs, now);
      return {
        kind: usingRest ? "poll" : "stream",
        label: sourceFresh ? (usingRest ? "REST" : "WS") : "",
        sourceFresh,
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
      engine.setVolumeMode("rolling");
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
      const rx = resolveHeatSampleMs(c.volumeSampledAt, now);
      if (rx == null) continue;
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
          const rx = resolveHeatSampleMs(sample.tradeTimeMs, nowMs);
          if (rx == null) continue;
          const sig = `${sample.cumulativeVol}|${sample.tradeTimeMs}`;
          if (volumeSigRef.current.get(key) === sig) continue;
          volumeSigRef.current.set(key, sig);
          engine.ingestCumulative(key, sample.cumulativeVol, rx);
          streamVolRxRef.current = rx;
          ingested = true;
          continue;
        }
        if (t.volume != null && Number.isFinite(t.volume) && t.volume >= 0) {
          const rx = resolveHeatSampleMs(t.tradeTime ?? t.ts, nowMs);
          if (rx == null) continue;
          const sig = `vol|${t.volume}`;
          if (volumeSigRef.current.get(key) === sig) continue;
          volumeSigRef.current.set(key, sig);
          engine.ingestCumulative(key, t.volume, rx);
          streamVolRxRef.current = rx;
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
          const rx = resolveHeatSampleMs(sample.tradeTimeMs, nowMs);
          if (rx == null) continue;
          const sig = `${sample.cumulativeVol}|${sample.tradeTimeMs}`;
          volumeSigRef.current.set(key, sig);
          engine.ingestCumulative(key, sample.cumulativeVol, rx);
          streamVolRxRef.current = rx;
          ingested = true;
          continue;
        }
        if (
          curr.volume != null &&
          Number.isFinite(curr.volume) &&
          curr.volume >= 0 &&
          curr.volume !== prevTick?.volume
        ) {
          const rx = resolveHeatSampleMs(curr.tradeTime ?? curr.ts, nowMs);
          if (rx == null) continue;
          const sig = `vol|${curr.volume}`;
          volumeSigRef.current.set(key, sig);
          engine.ingestCumulative(key, curr.volume, rx);
          streamVolRxRef.current = rx;
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
    let inFlight = false;
    const engine = engineRef.current!;

    const poll = async () => {
      const requested = restWindowRef.current;
      if (!requested?.fromDate || !requested.toDate || inFlight) return;
      inFlight = true;
      try {
        const res = await fetchWithAuth(restWindowPath(input.symbol, requested), {
          clerkTokenTimeoutMs: 4_000,
        });
        if (cancelled || !sameLadderExpiry(requested, restWindowRef.current)) return;
        if (!res.ok) {
          restBadgeRef.current = recordRestPoll(engine, restBadgeRef.current, { ok: false });
          return;
        }
        const data = (await res.json()) as {
          cacheTtlMs?: number;
          calls?: RestChainLeg[];
          puts?: RestChainLeg[];
        };
        if (cancelled || !sameLadderExpiry(requested, restWindowRef.current)) return;
        const receiptMs = Date.now();
        const want = ladderContractKeys(streamKeysRef.current, seedKeysRef.current);
        restWriteRef.current = true;
        let summary = { matched: 0, quoteTimeMs: null as number | null };
        try {
          summary = applyRestQuotes(engine, [...(data.calls ?? []), ...(data.puts ?? [])], want, receiptMs);
        } finally {
          restWriteRef.current = false;
        }
        restBadgeRef.current = recordRestPoll(engine, restBadgeRef.current, {
          ok: true,
          matched: summary.matched,
          quoteTimeMs: summary.quoteTimeMs,
          receiptMs,
          ttlMs: data.cacheTtlMs ?? 25_000,
        });
        schedulePaintRef.current?.();
      } catch {
        if (!cancelled && sameLadderExpiry(requested, restWindowRef.current)) {
          restBadgeRef.current = recordRestPoll(engine, restBadgeRef.current, { ok: false });
        }
      } finally {
        inFlight = false;
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), AT_LADDER_HEAT_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [
    mode,
    input.skipNetwork,
    input.symbol,
    input.restWindow?.fromDate,
    input.restWindow?.toDate,
    input.restWindow?.range,
    input.restWindow?.strikeCount,
    input.restWindow?.series,
  ]);

  useEffect(() => {
    if (mode !== "stream" || input.skipNetwork) {
      setRestActive(false);
      return;
    }
    let cancelled = false;
    const armedAt = Date.now();

    const poll = async () => {
      const windowQuery = restWindowRef.current;
      if (!windowQuery?.fromDate || !windowQuery.toDate) return;
      try {
        const res = await fetchWithAuth(restWindowPath(input.symbol, windowQuery), {
          clerkTokenTimeoutMs: 4_000,
        });
        if (cancelled || !sameLadderExpiry(windowQuery, restWindowRef.current)) return;
        const engine = engineRef.current!;
        if (!res.ok) {
          restBadgeRef.current = recordRestPoll(engine, restBadgeRef.current, { ok: false });
          if (!cancelled) setRestActive(false);
          return;
        }
        const data = (await res.json()) as {
          cacheTtlMs?: number;
          calls?: RestChainLeg[];
          puts?: RestChainLeg[];
        };
        if (cancelled || !sameLadderExpiry(windowQuery, restWindowRef.current)) return;
        const receiptMs = Date.now();
        restWriteRef.current = true;
        let summary = { matched: 0, quoteTimeMs: null as number | null };
        try {
          summary = applyRestQuotes(
            engine,
            [...(data.calls ?? []), ...(data.puts ?? [])],
            ladderContractKeys(streamKeysRef.current, seedKeysRef.current),
            receiptMs,
          );
        } finally {
          restWriteRef.current = false;
        }
        restBadgeRef.current = recordRestPoll(engine, restBadgeRef.current, {
          ok: true,
          matched: summary.matched,
          quoteTimeMs: summary.quoteTimeMs,
          receiptMs,
          ttlMs: data.cacheTtlMs ?? 1_000,
        });
        if (!cancelled) setRestActive(restBadgeFresh(restBadgeRef.current, receiptMs));
        schedulePaintRef.current?.();
      } catch {
        if (cancelled || !sameLadderExpiry(windowQuery, restWindowRef.current)) return;
        const engine = engineRef.current;
        if (engine) restBadgeRef.current = recordRestPoll(engine, restBadgeRef.current, { ok: false });
        if (!cancelled) setRestActive(false);
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
    input.restWindow?.series,
  ]);

  return { heatStore, source };
}
