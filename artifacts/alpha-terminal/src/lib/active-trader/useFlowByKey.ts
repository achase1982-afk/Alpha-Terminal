import { useEffect, useMemo, useState } from "react";
import { useOptionsStreamStore } from "@/lib/options-stream-store";
import {
  getFlowActivityForKey,
  getFlowCountsForKey,
  ingestOptionTickForFlow,
  type FlowLaneCounts,
} from "./flowClassifier";

export function useFlowByKey(
  keys: string[],
  windowMs: number,
): { flowByKey: Record<string, FlowLaneCounts>; activityByKey: Record<string, number> } {
  const ticks = useOptionsStreamStore((s) => s.ticks);
  const [windowTick, setWindowTick] = useState(0);

  useEffect(() => {
    const step = Math.max(2_000, Math.min(8_000, Math.floor(windowMs / 4)));
    const id = window.setInterval(() => setWindowTick((n) => n + 1), step);
    return () => window.clearInterval(id);
  }, [windowMs]);

  useEffect(() => {
    const now = Date.now();
    for (const key of keys) {
      const tick = ticks[key];
      if (tick) ingestOptionTickForFlow(key, tick, windowMs, now);
    }
  }, [keys, ticks, windowMs]);

  return useMemo(() => {
    void windowTick;
    const now = Date.now();
    const flowByKey: Record<string, FlowLaneCounts> = {};
    const activityByKey: Record<string, number> = {};
    for (const key of keys) {
      flowByKey[key] = getFlowCountsForKey(key, windowMs, now);
      activityByKey[key] = getFlowActivityForKey(key, windowMs, now);
    }
    return { flowByKey, activityByKey };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- windowTick drives rolling fade
  }, [keys, ticks, windowMs, windowTick]);
}