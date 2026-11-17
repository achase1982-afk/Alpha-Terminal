import { useEffect, useRef } from "react";

export type ChainHoldSubscribers = {
  subscribeOptionSymbols?: (
    symbols: string[],
    opts?: {
      purpose?: string;
      viewId?: string;
      underlyingPrice?: number;
      isAborted?: () => boolean;
    },
  ) => Promise<string | void>;
  releaseOptionHold?: (holderId: string) => Promise<void>;
};

/** Keeps a chain options hold stable across underlying spot ticks (holdSig-only deps). */
export function useChainOptionHold(
  holdSig: string | undefined,
  keys: string[],
  viewId: string | undefined,
  subs: ChainHoldSubscribers,
  underlyingPrice: number | null | undefined,
): void {
  const spotRef = useRef(underlyingPrice);
  const keysRef = useRef(keys);
  const viewIdRef = useRef(viewId);
  const latestViewIdRef = useRef(viewId);
  spotRef.current = underlyingPrice;
  keysRef.current = keys;
  viewIdRef.current = viewId;
  latestViewIdRef.current = viewId;

  const { subscribeOptionSymbols, releaseOptionHold } = subs;

  useEffect(() => {
    const k = keysRef.current;
    const v = viewIdRef.current;
    if (!holdSig || !subscribeOptionSymbols || !v || k.length === 0) return;
    const viewAtMount = v;
    let aborted = false;
    const inFlight = subscribeOptionSymbols(k, {
      purpose: "chain",
      viewId: v,
      underlyingPrice: spotRef.current ?? undefined,
      isAborted: () => aborted,
    }).then((next) => next);
    return () => {
      aborted = true;
      const stillSameView = latestViewIdRef.current === viewAtMount;
      void inFlight.then((holderId) => {
        if (holderId && releaseOptionHold && !stillSameView) void releaseOptionHold(holderId);
      });
    };
  }, [holdSig, subscribeOptionSymbols, releaseOptionHold]);
}
