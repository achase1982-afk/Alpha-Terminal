import { useEffect, useRef } from "react";
import { resolveOptionStreamHolderId } from "@/lib/optionHoldClient";
import { getStreamClientId } from "@/lib/streamClientId";
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
  keysRef.current = keys;
  viewIdRef.current = viewId;
  const { subscribeOptionSymbols, releaseOptionHold } = subs;

  useEffect(() => {
    const k = keysRef.current;
    const v = viewIdRef.current;
    if (!isOpen || !holdSig || !subscribeOptionSymbols || !v || k.length === 0) return;
    const viewAtMount = v;
    let aborted = false;
    void subscribeOptionSymbols(k, {
      purpose: "ticket",
      viewId: v,
      isAborted: () => aborted,
    });
    return () => {
      aborted = true;
      if (releaseOptionHold) {
        const holderId = resolveOptionStreamHolderId(getStreamClientId(), "ticket", viewAtMount);
        void releaseOptionHold(holderId);
      }
    };
  }, [isOpen, holdSig, subscribeOptionSymbols, releaseOptionHold]);
}
