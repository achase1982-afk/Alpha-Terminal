import { useEffect, useMemo } from "react";
import { useOptionsStreamStore } from "@/lib/options-stream-store";
import {
  getFlowCountsForKey,
  ingestOptionTickForFlow,
  type FlowLaneCounts,
} from "./flowClassifier";

export function useFlowByKey(keys: string[], windowMs: number): Record<string, FlowLaneCounts> {
  const ticks = useOptionsStreamStore((s) => s.ticks);

  useEffect(() => {
    for (const key of keys) {
      const tick = ticks[key];
      if (tick) ingestOptionTickForFlow(key, tick, windowMs);
    }
  }, [keys, ticks, windowMs]);

  return useMemo(() => {
    const out: Record<string, FlowLaneCounts> = {};
    for (const key of keys) {
      out[key] = getFlowCountsForKey(key);
    }
    return out;
  }, [keys, ticks, windowMs]);
}