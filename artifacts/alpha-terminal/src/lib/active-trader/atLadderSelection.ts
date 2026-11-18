import { startTransition, useEffect, useState } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { OptionsContract } from "@/components/OptionsTab";
import {
  AT_MAX_LADDER_LEGS,
  atLadderLegKey,
  type AtLadderLegPick,
} from "@/lib/active-trader/atLadderLegKeys";

/**
 * Which ladder cells are pressed or picked as legs.
 *
 * It lives outside React state so a touch only re-renders the one or two
 * cells whose look changes. The rest of Active Trader (ticket, header) reads
 * the same legs through `useAtLadderLegs`, which follows as a transition:
 * the highlight is on screen before any ticket work starts.
 */
export type AtLadderLegs = ReadonlyMap<string, AtLadderLegPick>;

export type AtLadderSelectionState = {
  legs: AtLadderLegs;
  /** `atLadderQuoteCellKey` of the cell under the finger, between touch and lift. */
  pressedCell: string | null;
};

export type AtLadderSelectionStore = StoreApi<AtLadderSelectionState>;

export type AtLegToggleResult = "added" | "removed" | "flipped" | "rejected";

const EMPTY_LEGS: AtLadderLegs = new Map();

export function createAtLadderSelectionStore(initial?: AtLadderLegs): AtLadderSelectionStore {
  return createStore<AtLadderSelectionState>(() => ({
    legs: initial && initial.size > 0 ? initial : EMPTY_LEGS,
    pressedCell: null,
  }));
}

/**
 * Leg rules for a tap on a bid/ask cell: the same cell again removes the leg,
 * the other side of the same contract flips BUY/SELL, and a new contract is
 * added unless `maxLegs` are already picked.
 */
export function toggleAtLadderLeg(
  legs: AtLadderLegs,
  contract: OptionsContract,
  type: "CALL" | "PUT",
  side: "bid" | "ask",
  maxLegs = AT_MAX_LADDER_LEGS,
): { legs: AtLadderLegs; result: AtLegToggleResult } {
  const key = atLadderLegKey(contract, type);
  const existing = legs.get(key);
  if (existing && existing.side === side) {
    const next = new Map(legs);
    next.delete(key);
    return { legs: next.size > 0 ? next : EMPTY_LEGS, result: "removed" };
  }
  if (!existing && legs.size >= maxLegs) return { legs, result: "rejected" };
  const next = new Map(legs);
  next.set(key, { contract, type, expiration: contract.expiration, side });
  return { legs: next, result: existing ? "flipped" : "added" };
}

export function atSelectionToggleLeg(
  store: AtLadderSelectionStore,
  contract: OptionsContract,
  type: "CALL" | "PUT",
  side: "bid" | "ask",
): AtLegToggleResult {
  const { legs, result } = toggleAtLadderLeg(store.getState().legs, contract, type, side);
  if (result !== "rejected") store.setState({ legs });
  return result;
}

export function atSelectionSetLegs(store: AtLadderSelectionStore, legs: AtLadderLegs): void {
  const next = legs.size > 0 ? legs : EMPTY_LEGS;
  if (store.getState().legs !== next) store.setState({ legs: next });
}

export function atSelectionRemoveLeg(store: AtLadderSelectionStore, legKey: string): void {
  const { legs } = store.getState();
  if (!legs.has(legKey)) return;
  const next = new Map(legs);
  next.delete(legKey);
  store.setState({ legs: next.size > 0 ? next : EMPTY_LEGS });
}

export function atSelectionClear(store: AtLadderSelectionStore): void {
  atSelectionSetLegs(store, EMPTY_LEGS);
}

export function atSelectionPress(store: AtLadderSelectionStore, cellKey: string | null): void {
  if (store.getState().pressedCell !== cellKey) store.setState({ pressedCell: cellKey });
}

export const AT_CELL_SELECTED = 1;
export const AT_CELL_PRESSED = 2;

/** Bit flags for one bid/ask cell. Only this cell re-renders when they change. */
export function useAtLadderCellFlags(
  store: AtLadderSelectionStore,
  legKey: string | null,
  side: "bid" | "ask",
  cellKey: string | null,
): number {
  return useStore(store, (s) => {
    if (!legKey) return 0;
    let flags = 0;
    if (s.legs.get(legKey)?.side === side) flags |= AT_CELL_SELECTED;
    if (cellKey != null && s.pressedCell === cellKey) flags |= AT_CELL_PRESSED;
    return flags;
  });
}

/** Picked legs for everything that is not a ladder cell. Follows the store as a transition. */
export function useAtLadderLegs(store: AtLadderSelectionStore): AtLadderLegs {
  const [legs, setLegs] = useState(() => store.getState().legs);
  useEffect(() => {
    setLegs(store.getState().legs);
    return store.subscribe((state, prev) => {
      if (state.legs === prev.legs) return;
      startTransition(() => setLegs(state.legs));
    });
  }, [store]);
  return legs;
}
