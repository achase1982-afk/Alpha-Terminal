import { useEffect, useRef } from "react";
import type { ChainHoldSubscribers } from "./useChainOptionHold";

/** Ticket option hold: depends on isOpen + holdSig (re-post on reopen). */
export function useTicketOptionHold(
  isOpen: boolean,
  holdSig: string | undefined,
  viewId: string | undefined,
  keys: string[],
  subs: ChainHoldSubscribers,
): void {
  const keysRef = useRef(keys);
  const viewIdRef = useRef(viewId);
  const latestViewIdRef = useRef(viewId);
  const isOpenRef = useRef(isOpen);
  keysRef.current = keys;
  viewIdRef.current = viewId;
  latestViewIdRef.current = viewId;
  isOpenRef.current = isOpen;
  const { subscribeOptionSymbols, releaseOptionHold } = subs;

  useEffect(() => {
    const k = keysRef.current;
    const v = viewIdRef.current;
    if (!isOpen || !holdSig || !subscribeOptionSymbols || !v || k.length === 0) return;
    const viewAtMount = v;
    let aborted = false;
    const inFlight = subscribeOptionSymbols(k, {
      purpose: "ticket",
      viewId: v,
      isAborted: () => aborted,
    }).then((next) => next);
    return () => {
      aborted = true;
      const stillSameView = latestViewIdRef.current === viewAtMount;
      const closing = !isOpenRef.current;
      void inFlight.then((holderId) => {
        if (holderId && releaseOptionHold && (closing || !stillSameView)) void releaseOptionHold(holderId);
      });
    };
  }, [isOpen, holdSig, subscribeOptionSymbols, releaseOptionHold]);
}
