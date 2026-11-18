import { AtLadderMonotonicHeatScale } from "./atLadderPremiumHeatScale";

export const AT_LADDER_HEAT_WINDOW_MS = 30_000;

export type LadderHeatAvailability = "unavailable" | "quiet" | "stale" | "live";

export type LadderHeatCellView = {
  availability: LadderHeatAvailability;
  /** Gross contracts traded in the rolling window (not premium $). */
  contracts30s: number;
  /** Smoothed 0–1 display intensity (EMA unless reduced motion). */
  intensity: number;
};

type VolumeIncident = { ms: number; qty: number };

type ContractState = {
  baselineSet: boolean;
  lastCumulative: number;
  incidents: VolumeIncident[];
  lastRxMs: number | null;
  gapStaleUntilMs: number;
  displayIntensity: number;
  lastIngestSig: string | null;
};

export type AtLadderVolumeHeatEngineOptions = {
  windowMs?: number;
  staleAfterMs?: number;
  scaleFloorContracts?: number;
  /** Cumulative jump above this is treated as reconnect/day gap (no burst). */
  reconnectJumpContracts?: number;
  emaAlpha?: number;
};

function prefersReducedMotion(): boolean {
  if (typeof document === "undefined") return false;
  return (
    document.documentElement.classList.contains("ui-reduced-motion") ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export class AtLadderVolumeHeatEngine {
  private readonly windowMs: number;
  private readonly staleAfterMs: number;
  private readonly reconnectJump: number;
  private readonly emaAlpha: number;
  private readonly scale = new AtLadderMonotonicHeatScale();
  private readonly byContract = new Map<string, ContractState>();
  private sourceLive = false;
  /** Last accepted per-contract volume sample time (trade time ms), for badge gating. */
  private sourceLastRxMs: number | null = null;
  private pollChainFetchedAtMs: number | null = null;
  private pollChainTtlMs: number | null = null;
  private nowMs: number;

  constructor(opts?: AtLadderVolumeHeatEngineOptions) {
    this.windowMs = opts?.windowMs ?? AT_LADDER_HEAT_WINDOW_MS;
    this.staleAfterMs = opts?.staleAfterMs ?? 12_000;
    this.reconnectJump = opts?.reconnectJumpContracts ?? 25_000;
    const floor = opts?.scaleFloorContracts ?? 200;
    this.scale.observe([floor]);
    this.emaAlpha = opts?.emaAlpha ?? 0.35;
    this.nowMs = Date.now();
  }

  setSourceLive(live: boolean): void {
    this.sourceLive = live;
  }

  noteSourceRx(rxMs: number): void {
    this.sourceLastRxMs = Math.max(this.sourceLastRxMs ?? 0, rxMs);
  }

  setPollChainMeta(meta: { fetchedAt: number; ttlMs: number }): void {
    this.pollChainFetchedAtMs = meta.fetchedAt;
    this.pollChainTtlMs = meta.ttlMs;
  }

  getPollChainMeta(): { fetchedAt: number; ttlMs: number } | null {
    if (this.pollChainFetchedAtMs == null || this.pollChainTtlMs == null) return null;
    return { fetchedAt: this.pollChainFetchedAtMs, ttlMs: this.pollChainTtlMs };
  }

  setNowMs(nowMs: number): void {
    this.nowMs = nowMs;
    for (const st of this.byContract.values()) this.pruneContract(st);
  }

  ingestCumulative(contract: string, cumulativeVol: number, rxMs: number): void {
    if (!Number.isFinite(cumulativeVol) || cumulativeVol < 0) return;
    if (!Number.isFinite(rxMs) || rxMs <= 0) return;
    const sig = `${cumulativeVol}|${rxMs}`;
    let st = this.byContract.get(contract);
    if (!st) {
      st = {
        baselineSet: false,
        lastCumulative: cumulativeVol,
        incidents: [],
        lastRxMs: null,
        gapStaleUntilMs: 0,
        displayIntensity: 0,
        lastIngestSig: null,
      };
      this.byContract.set(contract, st);
    }
    if (st.lastIngestSig === sig) return;
    st.lastIngestSig = sig;

    if (!st.baselineSet) {
      st.baselineSet = true;
      st.lastCumulative = cumulativeVol;
      st.lastRxMs = rxMs;
      return;
    }

    if (cumulativeVol < st.lastCumulative) {
      st.baselineSet = true;
      st.lastCumulative = cumulativeVol;
      st.lastRxMs = rxMs;
      st.incidents = [];
      st.gapStaleUntilMs = 0;
      return;
    }

    const delta = cumulativeVol - st.lastCumulative;
    st.lastCumulative = cumulativeVol;
    st.lastRxMs = rxMs;

    if (delta <= 0) return;

    this.noteSourceRx(rxMs);

    if (delta >= this.reconnectJump) {
      st.gapStaleUntilMs = rxMs + this.staleAfterMs;
      st.incidents = [];
      st.lastCumulative = cumulativeVol;
      st.lastRxMs = rxMs;
      this.noteSourceRx(rxMs);
      return;
    }

    st.incidents.push({ ms: rxMs, qty: delta });
    this.pruneContract(st);
  }

  private pruneContract(st: ContractState): void {
    const cutoff = this.nowMs - this.windowMs;
    if (st.incidents.length === 0) return;
    let i = 0;
    while (i < st.incidents.length && st.incidents[i]!.ms < cutoff) i += 1;
    if (i > 0) st.incidents = st.incidents.slice(i);
  }

  contractsFor(contract: string): number {
    const st = this.byContract.get(contract);
    if (!st) return 0;
    this.pruneContract(st);
    let sum = 0;
    for (const e of st.incidents) sum += e.qty;
    return sum;
  }

  snapshot(contracts: string[]): Record<string, LadderHeatCellView> {
    const counts: number[] = [];
    for (const c of contracts) {
      const n = this.contractsFor(c);
      if (n > 0) counts.push(n);
    }
    this.scale.observe(counts);

    const globalStale = this.resolveGlobalStale();
    const out: Record<string, LadderHeatCellView> = {};

    for (const c of contracts) {
      const st = this.byContract.get(c);
      const contracts30s = this.contractsFor(c);
      const availability = this.resolveCellAvailability(st, contracts30s, globalStale);
      const target =
        availability === "live" && contracts30s > 0 ? this.scale.intensity(contracts30s) : 0;
      let intensity = target;
      if (st) {
        if (prefersReducedMotion()) {
          st.displayIntensity = target;
        } else {
          st.displayIntensity = st.displayIntensity + this.emaAlpha * (target - st.displayIntensity);
        }
        intensity = st.displayIntensity;
      }
      out[c] = { availability, contracts30s, intensity };
    }
    return out;
  }

  private resolveGlobalStale(): boolean {
    if (!this.sourceLive) return true;
    if (this.sourceLastRxMs == null) return false;
    return this.nowMs - this.sourceLastRxMs > this.staleAfterMs;
  }

  private resolveCellAvailability(
    st: ContractState | undefined,
    contracts30s: number,
    globalStale: boolean,
  ): LadderHeatAvailability {
    if (!this.sourceLive) return "unavailable";
    if (!st || !st.baselineSet) return "quiet";
    if (globalStale || (st.lastRxMs != null && this.nowMs - st.lastRxMs > this.staleAfterMs)) {
      return "stale";
    }
    if (st.gapStaleUntilMs > this.nowMs) return "stale";
    if (contracts30s <= 0) return "quiet";
    return "live";
  }

  /** Last ingest on the ladder heat feed (stream tick or poll body), for freshness gating. */
  getSourceLastRxMs(): number | null {
    return this.sourceLastRxMs;
  }

  /** True when the feed timestamp is inside the stale window (independent of cell quiet/live). */
  isSourceFresh(nowMs: number = this.nowMs): boolean {
    if (!this.sourceLive || this.sourceLastRxMs == null) return false;
    return nowMs - this.sourceLastRxMs <= this.staleAfterMs;
  }
}