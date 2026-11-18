import type { AtLadderOptionPrint } from "./atLadderOptionPrint";

export type AtLadderPremiumHeatSource = {
  readonly id: string;
  /** When false, ladder shows unavailable (not L1O proxy). */
  isAuthorized(): boolean;
  subscribe(contracts: string[], onPrint: (p: AtLadderOptionPrint) => void): () => void;
};

/**
 * Live TIMESALE / Tradier adapter is not authorized until Felix verifies prints (~9:45 ET).
 * Never wire flow_1s / L1O dVol×last here.
 */
export function isAtLadderHeatLiveAuthorized(): boolean {
  return import.meta.env.VITE_AT_LADDER_HEAT_TIMESALE_VERIFIED === "1";
}

export function createUnavailableHeatSource(): AtLadderPremiumHeatSource {
  return {
    id: "unavailable",
    isAuthorized: () => false,
    subscribe: () => () => undefined,
  };
}

export function createFixtureHeatSource(
  prints: AtLadderOptionPrint[],
  opts?: { replayMs?: number; live?: boolean },
): AtLadderPremiumHeatSource {
  const replayMs = opts?.replayMs ?? 0;
  const live = opts?.live ?? true;
  return {
    id: "fixture",
    isAuthorized: () => live,
    subscribe(_contracts, onPrint) {
      let i = 0;
      let timer: ReturnType<typeof setInterval> | null = null;
      const flush = () => {
        if (i >= prints.length) {
          if (timer) clearInterval(timer);
          timer = null;
          return;
        }
        onPrint(prints[i]!);
        i += 1;
      };
      flush();
      if (replayMs > 0 && prints.length > 1) {
        timer = setInterval(flush, replayMs);
      }
      return () => {
        if (timer) clearInterval(timer);
      };
    },
  };
}