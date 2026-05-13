import { useEffect, useState } from "react";

/**
 * Pixels of the layout viewport covered from below by the on-screen keyboard
 * (or other UI that shrinks `visualViewport`). Use as extra `padding-bottom` /
 * `bottom` offset so fixed composers stay above the keyboard (iOS Safari, Chrome Android).
 */
export function useVisualViewportKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const innerH = window.innerHeight;
      const visibleBottom = vv.offsetTop + vv.height;
      // Uncovered strip below the visual viewport (keyboard, etc.)
      const fromLayout = Math.max(0, innerH - visibleBottom);
      // Some engines shrink height more reliably than offsetTop
      const fromHeight = Math.max(0, innerH - vv.height);
      const next = Math.min(innerH * 0.65, Math.max(fromLayout, fromHeight));
      setInset(Number.isFinite(next) ? next : 0);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return inset;
}
