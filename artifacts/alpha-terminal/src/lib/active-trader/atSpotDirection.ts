import { useEffect, useRef, useState } from "react";
import { UP, WHITE, DOWN } from "@/components/options/optionsTheme";

const HOLD_MS = 300;
const REF_MS = 1500;
const MAX_TICKS = 32;

type Sample = { t: number; p: number };

export function pickSpotColor(
  last: number | null,
  reference: number | null,
  hold: "up" | "down" | "flat",
): string {
  if (last == null || !Number.isFinite(last)) return WHITE;
  if (reference == null || !Number.isFinite(reference)) return WHITE;
  const eps = Math.max(0.01, Math.abs(last) * 1e-6);
  if (Math.abs(last - reference) <= eps) return WHITE;
  if (hold === "up") return UP;
  if (hold === "down") return DOWN;
  return WHITE;
}

/** Session change sign when spot direction is ambiguous (e.g. closed). */
export function useSpotDirectionColor(
  price: number | null | undefined,
  throttleMs = 250,
  sessionChange?: number | null,
): string {
  const ring = useRef<Sample[]>([]);
  const holdRef = useRef<"up" | "down" | "flat">("flat");
  const holdUntil = useRef(0);
  const lastPaint = useRef(0);
  const [color, setColor] = useState(WHITE);

  useEffect(() => {
    if (price == null || !Number.isFinite(price)) {
      setColor(WHITE);
      return;
    }
    const now = Date.now();
    ring.current.push({ t: now, p: price });
    ring.current = ring.current.filter((s) => now - s.t <= 10_000).slice(-MAX_TICKS);

    const refSample = ring.current.find((s) => now - s.t >= REF_MS);
    const reference = refSample?.p ?? ring.current[0]?.p ?? price;

    let dir: "up" | "down" | "flat" = "flat";
    const eps = Math.max(0.01, Math.abs(price) * 1e-6);
    if (price > reference + eps) dir = "up";
    else if (price < reference - eps) dir = "down";

    if (dir !== "flat") {
      holdRef.current = dir;
      holdUntil.current = now + HOLD_MS;
    } else if (now > holdUntil.current) {
      holdRef.current = "flat";
    }

    if (now - lastPaint.current < throttleMs) return;
    lastPaint.current = now;
    let hold = holdRef.current;
    if (hold === "flat" && sessionChange != null && Number.isFinite(sessionChange)) {
      if (sessionChange > 0) hold = "up";
      else if (sessionChange < 0) hold = "down";
    }
    setColor(pickSpotColor(price, reference, hold));
  }, [price, throttleMs, sessionChange]);

  return color;
}