// Single source of truth for OPRA options trade-classification rules.
//
// Polygon publishes the full OPRA condition reference at
//   GET https://api.polygon.io/v3/reference/conditions?asset_class=options
// Only ONE sale_condition in that list represents an Intermarket Sweep:
//
//   219 = "Intermarket Sweep Order"
//
// Earlier code in this repo used 218 (does not exist for OPRA) and
// 152/153 (those are stock-feed condition codes, not options) — so
// is_sweep was effectively never true. Centralize the canonical set
// here so the live watcher, the SSE hub, the REST backfill route, and
// the historical scanner all classify identically.
//
// Block prints have NO OPRA sale_condition — they are inferred from
// trade size. We use 100 contracts as the canonical threshold across
// the whole stack.

export const SWEEP_CONDITION_CODES: ReadonlySet<number> = new Set([219]);

export const BLOCK_MIN_SIZE = 100;

export function isSweep(conditions: readonly number[] | null | undefined): boolean {
  if (!conditions || conditions.length === 0) return false;
  for (const c of conditions) {
    if (SWEEP_CONDITION_CODES.has(c)) return true;
  }
  return false;
}

export function isBlock(size: number): boolean {
  return size >= BLOCK_MIN_SIZE;
}
