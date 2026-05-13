import { useCallback, useEffect, useRef, useState } from "react";

export interface VisualViewportComposerMetrics {
  /**
   * Estimated height (px) of the layout viewport obscured from below — mainly
   * the virtual keyboard when `interactive-widget=overlays-content` (iOS / many PWAs).
   */
  keyboardInset: number;
  /**
   * Safe `bottom` offset for a `position: fixed` composer: at least `reservePx`
   * (bottom tab bar, etc.) and at least `keyboardInset` when the keyboard is open.
   */
  dockBottomPx: number;
  /** Re-run measurement (call on textarea `focus` / after keyboard animation). */
  remeasure: () => void;
}

/**
 * iOS Safari often shrinks both `window.innerHeight` and `visualViewport.height` when
 * the keyboard opens, so `innerHeight - visualViewport.height` is ~0. We keep a
 * running baseline of the largest "expanded" viewport and subtract the current
 * visible merge height to recover keyboard overlap.
 */
export function useVisualViewportComposerMetrics(reservePx = 0): VisualViewportComposerMetrics {
  const [keyboardInset, setKeyboardInset] = useState(0);
  const baselineRef = useRef(0);
  const updateRef = useRef<() => void>(() => {});

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const initBaseline = () => {
      const ih = window.innerHeight;
      baselineRef.current = Math.max(baselineRef.current, ih, vv.height + vv.offsetTop);
    };

    const update = () => {
      const ih = window.innerHeight;
      const merged = vv.height + vv.offsetTop;

      if (merged >= ih * 0.86) {
        baselineRef.current = Math.max(baselineRef.current, merged, ih);
      }

      const fromBaseline = Math.max(0, baselineRef.current - merged);
      const fromInner = Math.max(0, ih - vv.height - vv.offsetTop);
      let next = Math.max(fromBaseline, fromInner);
      next = Math.min(next, ih * 0.72);
      if (!Number.isFinite(next)) next = 0;
      setKeyboardInset(next);
    };

    updateRef.current = update;
    initBaseline();
    update();

    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("resize", update);

    const onOrientation = () => {
      setTimeout(() => {
        baselineRef.current = 0;
        initBaseline();
        update();
      }, 280);
    };
    window.addEventListener("orientationchange", onOrientation);

    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", onOrientation);
    };
  }, []);

  const remeasure = useCallback(() => {
    updateRef.current();
  }, []);

  const dockBottomPx = Math.max(reservePx, keyboardInset);

  return { keyboardInset, dockBottomPx, remeasure };
}

/** Keyboard-only inset (no minimum dock). For simple `padding-bottom` tweaks. */
export function useVisualViewportKeyboardInset(): number {
  const { keyboardInset } = useVisualViewportComposerMetrics(0);
  return keyboardInset;
}
