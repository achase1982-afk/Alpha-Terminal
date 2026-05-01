/**
 * Same-session hints for options_flow_raw_trades: synthetic multi-leg clusters
 * (time-correlated prints on different contracts, same aggressor side) and
 * low-cardinality extras (repeat same-side prints on one OCC).
 */

export type MultiLegConfidenceTag = "high" | "medium" | "low";

export interface FlowLegSample {
  tsMs: number;
  occ: string;
  strike: number;
  expiration: string;
  side: string | null;
  size: number;
  notional: number;
}

const MULTI_LEG_WINDOW_MS = 2_500;
const SIZE_RATIO_MIN = 0.65;
const SIZE_RATIO_MAX = 1.55;
const REPEAT_WINDOW_MS = 45_000;
const MAX_WINDOW = 120;

function sameSide(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return false;
  return a === b;
}

function differentContract(a: FlowLegSample, b: FlowLegSample): boolean {
  return a.occ !== b.occ && (a.strike !== b.strike || a.expiration !== b.expiration);
}

function similarSize(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) return false;
  const r = a / b;
  return r >= SIZE_RATIO_MIN && r <= SIZE_RATIO_MAX;
}

function stablePairGroupId(ticker: string, a: FlowLegSample, b: FlowLegSample): string {
  const [x, y] = a.occ < b.occ ? [a, b] : [b, a];
  return `ml:${ticker}:${x.occ}:${y.occ}:${Math.min(x.tsMs, y.tsMs)}`;
}

export class FlowLegWindow {
  private readonly byUnderlying = new Map<string, FlowLegSample[]>();

  /** Record a classified print (call after shouldPersist gate). */
  record(underlying: string, s: FlowLegSample): void {
    const u = underlying.toUpperCase();
    const arr = this.byUnderlying.get(u) ?? [];
    const now = s.tsMs;
    const pruned = arr.filter((x) => now - x.tsMs <= MULTI_LEG_WINDOW_MS * 2);
    pruned.push(s);
    if (pruned.length > MAX_WINDOW) pruned.splice(0, pruned.length - MAX_WINDOW);
    this.byUnderlying.set(u, pruned);
  }

  /**
   * Multi-leg cluster: another print on a different strike/expiry within
   * MULTI_LEG_WINDOW_MS, same aggressor side, similar contract size.
   */
  annotate(underlying: string, s: FlowLegSample): {
    syntheticLegGroupId: string | null;
    multiLegConfidence: MultiLegConfidenceTag | null;
    extras: Record<string, unknown> | null;
  } {
    const u = underlying.toUpperCase();
    const arr = this.byUnderlying.get(u) ?? [];
    const extras: Record<string, unknown> = {};
    let syntheticLegGroupId: string | null = null;
    let multiLegConfidence: MultiLegConfidenceTag | null = null;

    const recentSameOcc = [...arr].reverse().find(
      (x) =>
        x.occ === s.occ
        && x.side != null
        && s.side != null
        && x.side === s.side
        && Math.abs(x.tsMs - s.tsMs) <= REPEAT_WINDOW_MS
        && x.tsMs !== s.tsMs,
    );
    if (recentSameOcc && (s.side === "ask" || s.side === "bid")) {
      extras.repeat_same_side_cluster = true;
      extras.repeat_same_side_ms_delta = Math.abs(s.tsMs - recentSameOcc.tsMs);
      extras.repeat_same_side = s.side;
    }

    const partners = arr.filter(
      (x) =>
        x.occ !== s.occ
        && Math.abs(x.tsMs - s.tsMs) <= MULTI_LEG_WINDOW_MS
        && differentContract(x, s)
        && sameSide(x.side, s.side)
        && similarSize(x.size, s.size),
    );
    if (partners.length > 0) {
      const p = partners[partners.length - 1]!;
      syntheticLegGroupId = stablePairGroupId(u, s, p);
      const spreadMs = Math.abs(s.tsMs - p.tsMs);
      if (partners.length >= 2 || spreadMs < 800) multiLegConfidence = "high";
      else if (spreadMs < 1_500) multiLegConfidence = "medium";
      else multiLegConfidence = "low";
      extras.multi_leg_partner_occ = p.occ;
      extras.multi_leg_spread_ms = spreadMs;
    }

    return {
      syntheticLegGroupId,
      multiLegConfidence,
      extras: Object.keys(extras).length ? extras : null,
    };
  }
}
