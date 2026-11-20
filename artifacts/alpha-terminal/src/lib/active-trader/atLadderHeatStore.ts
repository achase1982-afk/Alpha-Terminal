import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { LadderHeatCellView } from "./atLadderVolumeHeatEngine";

/**
 * Per-contract heat for the ladder, published a few times a second.
 *
 * Each call/put pair subscribes to its own entry, so a heat repaint touches
 * only the pairs whose shade moved instead of re-rendering every row.
 */
export type AtLadderHeatState = { cells: Readonly<Record<string, LadderHeatCellView>> };
export type AtLadderHeatStore = StoreApi<AtLadderHeatState>;

export const EMPTY_LADDER_HEAT_CELL: LadderHeatCellView = Object.freeze({
  availability: "unavailable",
  contracts30s: 0,
  intensity: 0,
  buyIntensity: 0,
  sellIntensity: 0,
  neutralIntensity: 0,
});

/** Smallest intensity move worth a repaint (about one shade step). */
export const AT_HEAT_REPAINT_EPSILON = 0.015;

export function createAtLadderHeatStore(): AtLadderHeatStore {
  return createStore<AtLadderHeatState>(() => ({ cells: {} }));
}

function channel(n: number | undefined): number {
  return n ?? 0;
}

/** A count change is not a repaint. The wash moves only when a side's shade moves. */
function sameShade(a: LadderHeatCellView, b: LadderHeatCellView): boolean {
  return (
    a.availability === b.availability &&
    Math.abs(a.intensity - b.intensity) <= AT_HEAT_REPAINT_EPSILON &&
    Math.abs(channel(a.buyIntensity) - channel(b.buyIntensity)) <= AT_HEAT_REPAINT_EPSILON &&
    Math.abs(channel(a.sellIntensity) - channel(b.sellIntensity)) <= AT_HEAT_REPAINT_EPSILON &&
    Math.abs(channel(a.neutralIntensity) - channel(b.neutralIntensity)) <= AT_HEAT_REPAINT_EPSILON
  );
}

/** Writes `next`, keeping the previous object for every contract whose shade did not move. */
export function publishAtLadderHeat(
  store: AtLadderHeatStore,
  next: Readonly<Record<string, LadderHeatCellView>>,
): boolean {
  const prev = store.getState().cells;
  const merged: Record<string, LadderHeatCellView> = {};
  let changed = false;
  let count = 0;
  for (const key in next) {
    const incoming = next[key]!;
    const existing = prev[key];
    count += 1;
    if (existing && sameShade(existing, incoming)) {
      merged[key] = existing;
    } else {
      merged[key] = incoming;
      changed = true;
    }
  }
  if (!changed && Object.keys(prev).length === count) return false;
  store.setState({ cells: merged });
  return true;
}

export function useAtLadderHeatCell(
  store: AtLadderHeatStore,
  streamKey: string | null | undefined,
): LadderHeatCellView {
  return useStore(store, (s) => (streamKey ? s.cells[streamKey] : undefined) ?? EMPTY_LADDER_HEAT_CELL);
}
