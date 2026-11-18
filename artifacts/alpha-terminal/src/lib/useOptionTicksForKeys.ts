import { useEffect, useMemo, useReducer, useRef } from "react";
import { useOptionsStreamStore, type OptionTick } from "@/lib/options-stream-store";

export type OptionTicksByKey = Record<string, OptionTick | undefined>;

function pickTicks(all: Record<string, OptionTick>, keys: readonly string[]): OptionTicksByKey {
  const out: OptionTicksByKey = {};
  for (const k of keys) out[k] = all[k];
  return out;
}

/**
 * Live ticks for a handful of contracts (order-ticket legs).
 *
 * Subscribing to the whole tick map re-renders the caller on every quote for
 * every contract. This re-renders only when one of `keys` changes, at most
 * once per `throttleMs`, and as a normal (non-blocking) React update.
 */
export function useOptionTicksForKeys(keys: readonly string[], throttleMs = 0): OptionTicksByKey {
  const keySig = keys.join("\n");
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const snapshot = useMemo(
    () => pickTicks(useOptionsStreamStore.getState().ticks, keySig ? keySig.split("\n") : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` re-reads the store
    [keySig, version],
  );
  const shownRef = useRef(snapshot);
  shownRef.current = snapshot;

  useEffect(() => {
    const list = keySig ? keySig.split("\n") : [];
    if (list.length === 0) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastEmitAt = 0;

    const differs = (ticks: Record<string, OptionTick>) => {
      const shown = shownRef.current;
      for (const k of list) if (ticks[k] !== shown[k]) return true;
      return false;
    };
    const emit = () => {
      timer = null;
      if (!differs(useOptionsStreamStore.getState().ticks)) return;
      lastEmitAt = Date.now();
      bump();
    };

    if (differs(useOptionsStreamStore.getState().ticks)) bump();
    const unsubscribe = useOptionsStreamStore.subscribe((state, prev) => {
      if (state.ticks === prev.ticks || timer != null || !differs(state.ticks)) return;
      if (throttleMs <= 0) {
        emit();
        return;
      }
      timer = setTimeout(emit, Math.max(0, throttleMs - (Date.now() - lastEmitAt)));
    });
    return () => {
      unsubscribe();
      if (timer != null) clearTimeout(timer);
    };
  }, [keySig, throttleMs]);

  return snapshot;
}
