import { describe, expect, it, vi } from "vitest";
import type { OptionsContract } from "@/components/OptionsTab";
import { AT_MAX_LADDER_LEGS, atLadderLegKey } from "@/lib/active-trader/atLadderLegKeys";
import {
  atSelectionClear,
  atSelectionPress,
  atSelectionRemoveLeg,
  atSelectionToggleLeg,
  createAtLadderSelectionStore,
  toggleAtLadderLeg,
} from "@/lib/active-trader/atLadderSelection";

const contract = (strike: number): OptionsContract =>
  ({ strike, expiration: "2026-11-18T21:00:00.000+00:00", streamKey: `K${strike}` }) as OptionsContract;

describe("ladder leg selection", () => {
  it("adds a leg, flips it on the other side, and removes it on the same side", () => {
    const store = createAtLadderSelectionStore();
    const c = contract(7330);
    const key = atLadderLegKey(c, "CALL");

    expect(atSelectionToggleLeg(store, c, "CALL", "bid")).toBe("added");
    expect(store.getState().legs.get(key)?.side).toBe("bid");

    expect(atSelectionToggleLeg(store, c, "CALL", "ask")).toBe("flipped");
    expect(store.getState().legs.get(key)?.side).toBe("ask");
    expect(store.getState().legs.size).toBe(1);

    expect(atSelectionToggleLeg(store, c, "CALL", "ask")).toBe("removed");
    expect(store.getState().legs.size).toBe(0);
  });

  it("treats the call and the put at one strike as separate legs", () => {
    const store = createAtLadderSelectionStore();
    const c = contract(7320);
    atSelectionToggleLeg(store, c, "CALL", "ask");
    atSelectionToggleLeg(store, c, "PUT", "bid");
    expect(store.getState().legs.size).toBe(2);
  });

  it(`rejects a leg past ${AT_MAX_LADDER_LEGS} and leaves the legs untouched`, () => {
    const store = createAtLadderSelectionStore();
    for (let i = 0; i < AT_MAX_LADDER_LEGS; i++) atSelectionToggleLeg(store, contract(7300 + i * 5), "CALL", "ask");
    const before = store.getState().legs;
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    expect(atSelectionToggleLeg(store, contract(7400), "CALL", "ask")).toBe("rejected");
    expect(store.getState().legs).toBe(before);
    expect(listener).not.toHaveBeenCalled();

    // A full ticket can still flip or drop one of its own legs.
    expect(atSelectionToggleLeg(store, contract(7300), "CALL", "bid")).toBe("flipped");
    expect(atSelectionToggleLeg(store, contract(7300), "CALL", "bid")).toBe("removed");
    unsubscribe();
    expect(store.getState().legs.size).toBe(AT_MAX_LADDER_LEGS - 1);
  });

  it("keeps insertion order so the ticket lists legs as they were picked", () => {
    let legs = toggleAtLadderLeg(new Map(), contract(7330), "CALL", "bid").legs;
    legs = toggleAtLadderLeg(legs, contract(7340), "CALL", "ask").legs;
    legs = toggleAtLadderLeg(legs, contract(7310), "PUT", "bid").legs;
    expect([...legs.values()].map((l) => l.contract.strike)).toEqual([7330, 7340, 7310]);
  });

  it("press state is independent of the legs and only notifies on change", () => {
    const store = createAtLadderSelectionStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    atSelectionPress(store, "cell-a");
    atSelectionPress(store, "cell-a");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().legs.size).toBe(0);
    atSelectionPress(store, null);
    expect(store.getState().pressedCell).toBeNull();
    unsubscribe();
  });

  it("removes and clears legs", () => {
    const store = createAtLadderSelectionStore();
    const a = contract(7300);
    const b = contract(7305);
    atSelectionToggleLeg(store, a, "PUT", "bid");
    atSelectionToggleLeg(store, b, "PUT", "ask");
    atSelectionRemoveLeg(store, atLadderLegKey(a, "PUT"));
    expect([...store.getState().legs.keys()]).toEqual([atLadderLegKey(b, "PUT")]);
    atSelectionClear(store);
    expect(store.getState().legs.size).toBe(0);
  });
});
