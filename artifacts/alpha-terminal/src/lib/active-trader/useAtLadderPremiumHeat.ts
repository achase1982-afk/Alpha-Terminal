import { useEffect, useMemo, useRef, useState } from "react";
import {
  AtLadderPremiumHeatEngine,
  type LadderHeatCellView,
} from "./atLadderPremiumHeatEngine";
import {
  createFixtureHeatSource,
  createUnavailableHeatSource,
  isAtLadderHeatLiveAuthorized,
  type AtLadderPremiumHeatSource,
} from "./atLadderPremiumHeatSource";
import { getAtFixtureOverride } from "./atFixtureBridge";
import {
  ladderHeatFixturePrints,
  type AtLadderHeatFixtureScene,
} from "./atLadderPremiumHeatFixture";

function resolveHeatSource(): AtLadderPremiumHeatSource {
  const fx = getAtFixtureOverride();
  const scene = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("scene") : null;
  const heatScene = (scene ?? "") as AtLadderHeatFixtureScene;
  if (fx && heatScene.startsWith("heat-")) {
    return createFixtureHeatSource(ladderHeatFixturePrints(heatScene), { live: true });
  }
  if (isAtLadderHeatLiveAuthorized()) {
    // Tradier / Schwab TIMESALE adapter lands here after verification.
    return createUnavailableHeatSource();
  }
  return createUnavailableHeatSource();
}

export function useAtLadderPremiumHeat(contracts: string[]): Record<string, LadderHeatCellView> {
  const engineRef = useRef(new AtLadderPremiumHeatEngine({ scaleFloorUsd: 100_000 }));
  const [tick, setTick] = useState(0);

  const source = useMemo(() => resolveHeatSource(), []);

  useEffect(() => {
    const engine = engineRef.current;
    engine.setSourceLive(source.isAuthorized());
    const unsub = source.subscribe(contracts, (p) => {
      engine.ingest(p);
      engine.setNowMs(Date.now());
      setTick((n) => n + 1);
    });
    return unsub;
  }, [source, contracts.join("|")]);

  useEffect(() => {
    const step = 2_500;
    const id = window.setInterval(() => {
      engineRef.current.setNowMs(Date.now());
      setTick((n) => n + 1);
    }, step);
    return () => window.clearInterval(id);
  }, []);

  return useMemo(() => {
    void tick;
    engineRef.current.setNowMs(Date.now());
    return engineRef.current.snapshot(contracts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts, tick]);
}