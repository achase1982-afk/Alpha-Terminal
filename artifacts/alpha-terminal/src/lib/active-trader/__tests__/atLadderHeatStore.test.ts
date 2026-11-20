import { describe, expect, it, vi } from "vitest";
import { createAtLadderHeatStore, publishAtLadderHeat } from "@/lib/active-trader/atLadderHeatStore";
import type { LadderHeatCellView } from "@/lib/active-trader/atLadderVolumeHeatEngine";

const cell = (intensity: number, contracts30s = 10): LadderHeatCellView => ({
  availability: "live",
  contracts30s,
  intensity,
  buyIntensity: 0,
  sellIntensity: 0,
  neutralIntensity: 0,
});

describe("ladder heat store", () => {
  it("keeps a contract's entry identical when its shade did not move", () => {
    const store = createAtLadderHeatStore();
    publishAtLadderHeat(store, { A: cell(0.5), B: cell(0.2) });
    const first = store.getState().cells;

    const changed = publishAtLadderHeat(store, { A: cell(0.505), B: cell(0.6) });
    const second = store.getState().cells;
    expect(changed).toBe(true);
    expect(second.A).toBe(first.A);
    expect(second.B).not.toBe(first.B);
    expect(second.B!.intensity).toBe(0.6);
  });

  it("does not notify when nothing visible changed", () => {
    const store = createAtLadderHeatStore();
    publishAtLadderHeat(store, { A: cell(0.5) });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    expect(publishAtLadderHeat(store, { A: cell(0.504) })).toBe(false);
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });

  it("drops contracts that left the viewport", () => {
    const store = createAtLadderHeatStore();
    publishAtLadderHeat(store, { A: cell(0.5), B: cell(0.2) });
    expect(publishAtLadderHeat(store, { A: cell(0.5) })).toBe(true);
    expect(Object.keys(store.getState().cells)).toEqual(["A"]);
  });
});
