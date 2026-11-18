import {
  AT_LADDER_HEAT_WINDOW_MS,
  ladderPrintPremiumUsd,
  type AtLadderOptionPrint,
} from "./atLadderOptionPrint";
import { AtLadderMonotonicHeatScale } from "./atLadderPremiumHeatScale";

export type LadderHeatAvailability = "unavailable" | "quiet" | "stale" | "live";

export type LadderHeatCellView = {
  availability: LadderHeatAvailability;
  premiumUsd: number;
  intensity: number;
};

type StoredPrint = AtLadderOptionPrint & { premiumUsd: number; multiplier: number };

export type AtLadderPremiumHeatEngineOptions = {
  windowMs?: number;
  multiplierForContract?: (contract: string) => number;
  scaleFloorUsd?: number;
  staleAfterMs?: number;
};

export class AtLadderPremiumHeatEngine {
  private readonly windowMs: number;
  private readonly staleAfterMs: number;
  private readonly multiplierForContract: (contract: string) => number;
  private readonly scale = new AtLadderMonotonicHeatScale();
  private readonly prints: StoredPrint[] = [];
  private readonly seenSeq = new Set<string>();
  private readonly bySeq = new Map<string, StoredPrint>();
  private sourceLive = false;
  private lastPrintRxMs: number | null = null;
  private nowMs: number;

  constructor(opts?: AtLadderPremiumHeatEngineOptions) {
    this.windowMs = opts?.windowMs ?? AT_LADDER_HEAT_WINDOW_MS;
    this.staleAfterMs = opts?.staleAfterMs ?? 12_000;
    this.multiplierForContract = opts?.multiplierForContract ?? (() => 100);
    this.nowMs = Date.now();
    if (opts?.scaleFloorUsd != null) {
      this.scale.observe([opts.scaleFloorUsd]);
    }
  }

  setSourceLive(live: boolean): void {
    this.sourceLive = live;
  }

  setNowMs(nowMs: number): void {
    this.nowMs = nowMs;
    this.prune();
  }

  ingest(print: AtLadderOptionPrint): void {
    const seqKey = String(print.seq);
    if (print.cancel) {
      const stored = this.bySeq.get(seqKey);
      if (stored) {
        this.removePrint(stored);
        this.bySeq.delete(seqKey);
      }
      return;
    }
    if (this.seenSeq.has(seqKey)) return;
    this.seenSeq.add(seqKey);

    const mult = this.multiplierForContract(print.contract);
    const premiumUsd = ladderPrintPremiumUsd(print, mult);
    const stored: StoredPrint = { ...print, premiumUsd, multiplier: mult };
    this.prints.push(stored);
    this.bySeq.set(seqKey, stored);
    this.lastPrintRxMs = Math.max(this.lastPrintRxMs ?? 0, print.ts_ms);
    this.prune();
  }

  private removePrint(stored: StoredPrint): void {
    const idx = this.prints.indexOf(stored);
    if (idx >= 0) this.prints.splice(idx, 1);
  }

  private prune(): void {
    const cutoff = this.nowMs - this.windowMs;
    let i = 0;
    while (i < this.prints.length) {
      const p = this.prints[i]!;
      if (p.ts_ms < cutoff) {
        this.bySeq.delete(String(p.seq));
        this.prints.splice(i, 1);
      } else {
        i += 1;
      }
    }
  }

  premiumUsdForContract(contract: string): number {
    this.prune();
    let sum = 0;
    for (const p of this.prints) {
      if (p.contract === contract) sum += p.premiumUsd;
    }
    return sum;
  }

  snapshot(contracts: string[]): Record<string, LadderHeatCellView> {
    this.prune();
    const premiums: number[] = [];
    for (const c of contracts) {
      const p = this.premiumUsdForContract(c);
      if (p > 0) premiums.push(p);
    }
    this.scale.observe(premiums);

    const availability = this.resolveAvailability();
    const out: Record<string, LadderHeatCellView> = {};
    for (const c of contracts) {
      const premiumUsd = this.premiumUsdForContract(c);
      out[c] = {
        availability,
        premiumUsd,
        intensity: availability === "live" ? this.scale.intensity(premiumUsd) : 0,
      };
    }
    return out;
  }

  private resolveAvailability(): LadderHeatAvailability {
    if (!this.sourceLive) return "unavailable";
    const fresh =
      this.lastPrintRxMs != null && this.nowMs - this.lastPrintRxMs <= this.staleAfterMs;
    if (!fresh && this.prints.length === 0) return "stale";
    if (!fresh) return "stale";
    if (this.prints.length === 0) return "quiet";
    return "live";
  }
}