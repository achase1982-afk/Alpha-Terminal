import { useEffect, useRef, useState } from "react";

/** Throttle numeric display updates (~4Hz default) to cut repaint churn. */
export function useThrottledNumber(value: number | null | undefined, throttleMs = 250): number | null {
  const [shown, setShown] = useState<number | null>(value ?? null);
  const pending = useRef<number | null>(value ?? null);
  const lastPaint = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const v = value != null && Number.isFinite(value) ? value : null;
    pending.current = v;
    const now = Date.now();
    const flush = () => {
      lastPaint.current = Date.now();
      setShown(pending.current);
    };
    if (now - lastPaint.current >= throttleMs) {
      flush();
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, throttleMs - (now - lastPaint.current));
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, throttleMs]);

  return shown;
}