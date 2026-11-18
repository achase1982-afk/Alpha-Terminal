import { useEffect, useMemo, useRef, useState } from "react";
import {
  AtLadderVolumeHeatEngine,
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

export type AtLadderHeatSourceMeta = {
  kind: "stream" | "poll" | "fixture" | "off";
  label: string;
  stale: boolean;
  pollMs?: number;
};

function heatSourceLabel(meta: AtLadderHeatSourceMeta): string {
  if (meta.stale) return "Stale · ladder heat";
  if (meta.kind === "stream") return "Live · stream";
  if (meta.kind === "poll") return `Live · ~${Math.round((meta.pollMs ?? AT_LADDER_HEAT_POLL_MS) / 1000)}s poll`;
  return "";
}

export function useAtLadderVolumeHeat(input: {
  symbol: string;
  streamKeys: string[];
  skipNetwork?: boolean;
}): { heatByKey: Record<string, LadderHeatCellView>; source: AtLadderHeatSourceMeta } {
  const engineRef = useRef(new AtLadderVolumeHeatEngine({ scaleFloorContracts: 150 }));
  const [tick, setTick] = useState(0);
  const fx = getAtFixtureOverride();
  const scene =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("scene") : null;
  const heatScene = (scene ?? "") as AtLadderVolumeHeatFixtureScene;

  const mode: AtLadderHeatSourceMeta["kind"] = useMemo(() => {
    if (fx && heatScene.startsWith("heat-")) return "fixture";
    if (input.skipNetwork) return "off";
    return isIndexSymbol(input.symbol) ? "stream" : "poll";
  }, [fx, heatScene, input.skipNetwork, input.symbol]);

  const ticks = useOptionsStreamStore((s) => s.ticks);

  useEffect(() => {
    const engine = engineRef.current;
    const live = mode === "stream" || mode === "poll" || mode === "fixture";
    engine.setSourceLive(live);
  }, [mode]);

  useEffect(() => {
    if (mode !== "fixture" || !heatScene.startsWith("heat-")) return;
    const engine = engineRef.current;
    const samples = ladderVolumeHeatFixtureSamples(heatScene);
    const base = Date.now();
    for (const s of samples) {
      engine.ingestCumulative(s.contract, s.cumulativeVol, base + (s.offsetMs ?? 0));
    }
    engine.setNowMs(Date.now());
    setTick((n) => n + 1);
    const id = window.setInterval(() => {
      engine.setNowMs(Date.now());
      setTick((n) => n + 1);
    }, 2_000);
    return () => window.clearInterval(id);
  }, [mode, heatScene]);

  useEffect(() => {
    if (mode !== "stream") return;
    const engine = engineRef.current;
    const now = Date.now();
    for (const key of input.streamKeys) {
      const t = ticks[key];
      if (t?.volume == null) continue;
      engine.ingestCumulative(key, t.volume, t.ts > 0 ? t.ts : now);
    }
    engine.setNowMs(now);
    setTick((n) => n + 1);
  }, [mode, ticks, input.streamKeys.join("|")]);

  useEffect(() => {
    if (mode !== "poll" || input.skipNetwork) return;
    let cancelled = false;
    const engine = engineRef.current;
    const sym = input.symbol.replace(/^\$/, "");

    const poll = async () => {
      try {
        const res = await fetchWithAuth(
          `/api/market/options?symbol=${encodeURIComponent(sym)}&strikeCount=40&contractType=ALL`,
          { clerkTokenTimeoutMs: 4_000 },
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          calls?: { streamKey?: string; schwabSymbol?: string; volume?: number }[];
          puts?: { streamKey?: string; schwabSymbol?: string; volume?: number }[];
        };
        const now = Date.now();
        const want = new Set(input.streamKeys);
        for (const leg of [...(data.calls ?? []), ...(data.puts ?? [])]) {
          const key = (leg.streamKey ?? leg.schwabSymbol ?? "").trim();
          if (!key || !want.has(key)) continue;
          if (leg.volume == null || !Number.isFinite(leg.volume)) continue;
          engine.ingestCumulative(key, leg.volume, now);
        }
        engine.noteSourceRx(now);
        engine.setNowMs(now);
        setTick((n) => n + 1);
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
    const step = 2_000;
    const id = window.setInterval(() => {
      engineRef.current.setNowMs(Date.now());
      setTick((n) => n + 1);
    }, step);
    return () => window.clearInterval(id);
  }, []);

  const heatByKey = useMemo(() => {
    void tick;
    engineRef.current.setNowMs(Date.now());
    return engineRef.current.snapshot(input.streamKeys);
  }, [input.streamKeys, tick]);

  const source: AtLadderHeatSourceMeta = useMemo(() => {
    const stale = Object.values(heatByKey).some((c) => c.availability === "stale");
    const base: AtLadderHeatSourceMeta = {
      kind: mode,
      label: "",
      stale,
      pollMs: mode === "poll" ? AT_LADDER_HEAT_POLL_MS : undefined,
    };
    base.label = heatSourceLabel(base);
    return base;
  }, [heatByKey, mode]);

  return { heatByKey, source };
}