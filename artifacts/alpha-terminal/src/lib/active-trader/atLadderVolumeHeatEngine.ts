import { classifyQuoteRule } from "./flowClassifier";

export const AT_LADDER_HEAT_WINDOW_MS = 30_000;

/**
 * Rolling sale heat for the options ladder (index stream and single-name poll
 * share this engine; a futures book can feed the same `ingestCumulative`).
 *
 * Gross size says where contracts printed in the last 30 seconds. The quote
 * rule — the same one the flow strip uses — splits that size into buyers
 * lifting the offer and sellers hitting the bid. The split is the moment,
 * not the day. Unclassified size stays a location wash and does not invent a side.
 *
 * Heat is relative: the busiest contract on the ladder is full intensity and
 * the rest are placed against it on a log curve, so a 50-contract strike is
 * still clearly lit next to a 2,000-contract one.
 *
 * The reference never drops below the floor, so on a quiet tape a single
 * 1-lot cannot light a cell fully.
 */
export const AT_HEAT_FLOOR_CONTRACTS = 50;
/** Soft knee of the log curve, in contracts. Below it the curve is close to linear. */
export const AT_HEAT_CURVE_KNEE_CONTRACTS = 8;
/** When the busiest contract cools off, the reference follows it down with this half-life. */
export const AT_HEAT_REFERENCE_HALF_LIFE_MS = 20_000;
/**
 * Display smoothing. A print blooms quickly and then holds, so the ladder
 * stays a picture of the last few seconds instead of flickering per lot.
 * `AT_HEAT_SMOOTHING_MS` remains the symmetric time constant tests and
 * explicit callers can force.
 */
export const AT_HEAT_SMOOTHING_MS = 450;
export const AT_HEAT_ATTACK_MS = 220;
export const AT_HEAT_DECAY_MS = 1_600;

/** 0-1 intensity of `contracts` traded in the window against the ladder's reference. */
export function ladderHeatIntensity(
  contracts: number,
  reference: number,
  floor = AT_HEAT_FLOOR_CONTRACTS,
): number {
  if (!(contracts > 0)) return 0;
  const ref = Math.max(floor, reference, 1);
  const knee = AT_HEAT_CURVE_KNEE_CONTRACTS;
  return Math.min(1, Math.log1p(contracts / knee) / Math.log1p(ref / knee));
}

/**
 * Reference for the relative scale: the busiest contract right now. It jumps
 * up at once and eases down, so one fading burst does not make every other
 * cell flare, and it is never below the floor.
 *
 * The unit is contracts. A ladder trades from a handful to a few thousand
 * contracts per 30s per strike; a reference that starts far above that (a
 * dollar-sized floor, say) leaves every cell at the minimum shade.
 */
export class AtLadderRelativeHeatReference {
  private value: number;
  private lastMs: number | null = null;

  constructor(
    private readonly floor = AT_HEAT_FLOOR_CONTRACTS,
    private readonly halfLifeMs = AT_HEAT_REFERENCE_HALF_LIFE_MS,
  ) {
    this.value = floor;
  }

  update(busiestContracts: number, nowMs: number): number {
    if (this.lastMs != null && nowMs > this.lastMs && this.halfLifeMs > 0) {
      this.value *= Math.pow(0.5, (nowMs - this.lastMs) / this.halfLifeMs);
    }
    this.lastMs = nowMs;
    this.value = Math.max(this.floor, busiestContracts, this.value);
    return this.value;
  }

  current(): number {
    return this.value;
  }
}

export type LadderHeatAvailability = "unavailable" | "quiet" | "stale" | "live";

export type LadderHeatCellView = {
  availability: LadderHeatAvailability;
  /** Gross contracts in the active heat window (30 seconds live; session volume after close). */
  contracts30s: number;
  /** 0–1 gross intensity, relative to the busiest contract and smoothed over time (not across strikes). */
  intensity: number;
  /** 0–1 buyers lifting the offer. Painted behind the ask. */
  buyIntensity: number;
  /** 0–1 sellers hitting the bid. Painted behind the bid. */
  sellIntensity: number;
  /** 0–1 size whose side the quote rule could not call. Painted as location only. */
  neutralIntensity: number;
};

/** Quote sitting on the contract when a volume delta arrives. */
export type LadderHeatQuote = {
  bid: number | null;
  ask: number | null;
  last: number | null;
};

type PrintSide = "buy" | "sell" | "neutral";

type VolumeIncident = { ms: number; qty: number; side: PrintSide };

type ContractState = {
  baselineSet: boolean;
  lastCumulative: number;
  incidents: VolumeIncident[];
  lastRxMs: number | null;
  gapStaleUntilMs: number;
  prevBid: number | null;
  prevAsk: number | null;
  displayIntensity: number;
  displayBuy: number;
  displaySell: number;
  displayNeutral: number;
  /** When the display channels were last advanced; null until the contract is first painted. */
  lastPaintMs: number | null;
  lastIngestSig: string | null;
};

export type AtLadderVolumeHeatEngineOptions = {
  windowMs?: number;
  staleAfterMs?: number;
  /** Reference floor in contracts; see `AT_HEAT_FLOOR_CONTRACTS`. */
  scaleFloorContracts?: number;
  /** Cumulative jump above this is treated as reconnect/day gap (no burst). */
  reconnectJumpContracts?: number;
  /** Symmetric display smoothing. Set this to force attack and decay to the same time constant. */
  smoothingMs?: number;
  /** How fast a new print reaches its true shade. Ignored when `smoothingMs` is set. */
  attackMs?: number;
  /** How long a shade holds after the print rolls out of the window. Ignored when `smoothingMs` is set. */
  decayMs?: number;
  referenceHalfLifeMs?: number;
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
  private readonly attackMs: number;
  private readonly decayMs: number;
  private readonly floor: number;
  private readonly reference: AtLadderRelativeHeatReference;
  private readonly byContract = new Map<string, ContractState>();
  private sourceLive = false;
  /** Last accepted per-contract volume sample time (trade time ms), for badge gating. */
  private sourceLastRxMs: number | null = null;
  private pollChainFetchedAtMs: number | null = null;
  private pollChainTtlMs: number | null = null;
  /** Exchange quote time for the last REST sample. Independent of HTTP receipt. */
  private pollQuoteTimeMs: number | null = null;
  private nowMs: number;
  private volumeMode: "rolling" | "session" = "rolling";

  constructor(opts?: AtLadderVolumeHeatEngineOptions) {
    this.windowMs = opts?.windowMs ?? AT_LADDER_HEAT_WINDOW_MS;
    this.staleAfterMs = opts?.staleAfterMs ?? 12_000;
    this.reconnectJump = opts?.reconnectJumpContracts ?? 25_000;
    this.floor = opts?.scaleFloorContracts ?? AT_HEAT_FLOOR_CONTRACTS;
    this.reference = new AtLadderRelativeHeatReference(
      this.floor,
      opts?.referenceHalfLifeMs ?? AT_HEAT_REFERENCE_HALF_LIFE_MS,
    );
    if (opts?.smoothingMs != null) {
      this.attackMs = opts.smoothingMs;
      this.decayMs = opts.smoothingMs;
    } else {
      this.attackMs = opts?.attackMs ?? AT_HEAT_ATTACK_MS;
      this.decayMs = opts?.decayMs ?? AT_HEAT_DECAY_MS;
    }
    this.nowMs = Date.now();
  }

  private blankState(): ContractState {
    return {
      baselineSet: false,
      lastCumulative: 0,
      incidents: [],
      lastRxMs: null,
      gapStaleUntilMs: 0,
      prevBid: null,
      prevAsk: null,
      displayIntensity: 0,
      displayBuy: 0,
      displaySell: 0,
      displayNeutral: 0,
      lastPaintMs: null,
      lastIngestSig: null,
    };
  }

  /**
   * Remember the quote in front of the next print. Index and equity-option
   * books both call this; a futures book can call the same method.
   */
  noteQuote(contract: string, quote: LadderHeatQuote | null | undefined): void {
    if (!quote) return;
    let st = this.byContract.get(contract);
    if (!st) {
      st = this.blankState();
      this.byContract.set(contract, st);
    }
    if (quote.bid != null && quote.bid > 0) st.prevBid = quote.bid;
    if (quote.ask != null && quote.ask > 0) st.prevAsk = quote.ask;
  }

  private classifyDelta(st: ContractState, quote: LadderHeatQuote | undefined): PrintSide {
    if (!quote || quote.last == null || !(quote.last > 0)) return "neutral";
    const side = classifyQuoteRule(st.prevBid ?? quote.bid, st.prevAsk ?? quote.ask, quote.last);
    if (side === "buy" || side === "sell") return side;
    return "neutral";
  }

  setSourceLive(live: boolean): void {
    this.sourceLive = live;
  }

  /** Use cumulative session volume after the options close instead of a decaying live window. */
  setVolumeMode(mode: "rolling" | "session"): void {
    this.volumeMode = mode;
  }

  noteSourceRx(rxMs: number): void {
    this.sourceLastRxMs = Math.max(this.sourceLastRxMs ?? 0, rxMs);
  }

  setPollChainMeta(
    meta: { fetchedAt: number; ttlMs: number; quoteTimeMs?: number | null } | null,
  ): void {
    if (meta == null) {
      this.pollChainFetchedAtMs = null;
      this.pollChainTtlMs = null;
      this.pollQuoteTimeMs = null;
      return;
    }
    this.pollChainFetchedAtMs = meta.fetchedAt;
    this.pollChainTtlMs = meta.ttlMs;
    this.pollQuoteTimeMs = meta.quoteTimeMs ?? null;
  }

  getPollChainMeta(): { fetchedAt: number; ttlMs: number; quoteTimeMs: number | null } | null {
    if (this.pollChainFetchedAtMs == null || this.pollChainTtlMs == null) return null;
    return {
      fetchedAt: this.pollChainFetchedAtMs,
      ttlMs: this.pollChainTtlMs,
      quoteTimeMs: this.pollQuoteTimeMs,
    };
  }

  setNowMs(nowMs: number): void {
    this.nowMs = nowMs;
    for (const st of this.byContract.values()) this.pruneContract(st);
  }

  ingestCumulative(
    contract: string,
    cumulativeVol: number,
    rxMs: number,
    quote?: LadderHeatQuote,
  ): void {
    if (!Number.isFinite(cumulativeVol) || cumulativeVol < 0) return;
    if (!Number.isFinite(rxMs) || rxMs <= 0) return;
    const sig = `${cumulativeVol}|${rxMs}`;
    let st = this.byContract.get(contract);
    if (!st) {
      st = this.blankState();
      this.byContract.set(contract, st);
    }
    if (st.lastIngestSig === sig) {
      this.applyQuote(st, quote);
      return;
    }
    st.lastIngestSig = sig;

    if (!st.baselineSet) {
      st.baselineSet = true;
      st.lastCumulative = cumulativeVol;
      st.lastRxMs = rxMs;
      this.applyQuote(st, quote);
      return;
    }

    if (cumulativeVol < st.lastCumulative) {
      st.baselineSet = true;
      st.lastCumulative = cumulativeVol;
      st.lastRxMs = rxMs;
      st.incidents = [];
      st.gapStaleUntilMs = 0;
      this.applyQuote(st, quote);
      return;
    }

    const delta = cumulativeVol - st.lastCumulative;
    st.lastCumulative = cumulativeVol;
    st.lastRxMs = rxMs;

    if (delta <= 0) {
      this.applyQuote(st, quote);
      return;
    }

    this.noteSourceRx(rxMs);

    if (delta >= this.reconnectJump) {
      st.gapStaleUntilMs = rxMs + this.staleAfterMs;
      st.incidents = [];
      st.lastCumulative = cumulativeVol;
      st.lastRxMs = rxMs;
      this.noteSourceRx(rxMs);
      this.applyQuote(st, quote);
      return;
    }

    // Side is taken against the quote that was already on the book, then the book moves.
    st.incidents.push({ ms: rxMs, qty: delta, side: this.classifyDelta(st, quote) });
    this.applyQuote(st, quote);
    this.pruneContract(st);
  }

  private applyQuote(st: ContractState, quote: LadderHeatQuote | undefined): void {
    if (!quote) return;
    if (quote.bid != null && quote.bid > 0) st.prevBid = quote.bid;
    if (quote.ask != null && quote.ask > 0) st.prevAsk = quote.ask;
  }

  private pruneContract(st: ContractState): void {
    const cutoff = this.nowMs - this.windowMs;
    if (st.incidents.length === 0) return;
    let i = 0;
    while (i < st.incidents.length && st.incidents[i]!.ms < cutoff) i += 1;
    if (i > 0) st.incidents = st.incidents.slice(i);
  }

  private breakdown(contract: string): { total: number; buy: number; sell: number; neutral: number } {
    const st = this.byContract.get(contract);
    if (!st) return { total: 0, buy: 0, sell: 0, neutral: 0 };
    if (this.volumeMode === "session") {
      const total = st.baselineSet ? st.lastCumulative : 0;
      return { total, buy: 0, sell: 0, neutral: total };
    }
    this.pruneContract(st);
    let buy = 0;
    let sell = 0;
    let neutral = 0;
    for (const e of st.incidents) {
      if (e.side === "buy") buy += e.qty;
      else if (e.side === "sell") sell += e.qty;
      else neutral += e.qty;
    }
    return { total: buy + sell + neutral, buy, sell, neutral };
  }

  contractsFor(contract: string): number {
    return this.breakdown(contract).total;
  }

  /** Contracts traded in the window by the busiest contract the engine is tracking. */
  private busiestContracts(globalStale: boolean): number {
    let busiest = 0;
    for (const [key, st] of this.byContract) {
      const n = this.contractsFor(key);
      if (n <= busiest) continue;
      if (this.resolveCellAvailability(st, n, globalStale) === "live") busiest = n;
    }
    return busiest;
  }

  /** Current reference of the relative scale, in contracts (never below the floor). */
  referenceContracts(): number {
    return this.reference.current();
  }

  private ease(current: number, target: number, dt: number): number {
    const tau = target >= current ? this.attackMs : this.decayMs;
    if (!(tau > 0)) return target;
    const k = 1 - Math.exp(-dt / tau);
    const next = current + k * (target - current);
    return Math.abs(target - next) < 0.002 ? target : next;
  }

  snapshot(contracts: string[]): Record<string, LadderHeatCellView> {
    const globalStale = this.volumeMode === "session" ? false : this.resolveGlobalStale();
    const reference = this.reference.update(this.busiestContracts(globalStale), this.nowMs);
    const instant = (this.attackMs <= 0 && this.decayMs <= 0) || prefersReducedMotion();
    const out: Record<string, LadderHeatCellView> = {};

    for (const c of contracts) {
      const st = this.byContract.get(c);
      const parts = this.breakdown(c);
      const contracts30s = parts.total;
      const availability = this.resolveCellAvailability(st, contracts30s, globalStale);
      const live = availability === "live";
      const shade = (qty: number) =>
        live && qty > 0 ? ladderHeatIntensity(qty, reference, this.floor) : 0;
      const target = shade(contracts30s);
      const targetBuy = shade(parts.buy);
      const targetSell = shade(parts.sell);
      const targetNeutral = shade(parts.neutral);
      let intensity = target;
      let buyIntensity = targetBuy;
      let sellIntensity = targetSell;
      let neutralIntensity = targetNeutral;
      if (st) {
        // A contract seen for the first time shows its true value; after that it eases toward it.
        if (instant || st.lastPaintMs == null) {
          st.displayIntensity = target;
          st.displayBuy = targetBuy;
          st.displaySell = targetSell;
          st.displayNeutral = targetNeutral;
        } else {
          const dt = Math.max(0, this.nowMs - st.lastPaintMs);
          st.displayIntensity = this.ease(st.displayIntensity, target, dt);
          st.displayBuy = this.ease(st.displayBuy, targetBuy, dt);
          st.displaySell = this.ease(st.displaySell, targetSell, dt);
          st.displayNeutral = this.ease(st.displayNeutral, targetNeutral, dt);
        }
        st.lastPaintMs = this.nowMs;
        intensity = st.displayIntensity;
        buyIntensity = st.displayBuy;
        sellIntensity = st.displaySell;
        neutralIntensity = st.displayNeutral;
      }
      out[c] = { availability, contracts30s, intensity, buyIntensity, sellIntensity, neutralIntensity };
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
    if (this.volumeMode === "session") return contracts30s > 0 ? "live" : "quiet";
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