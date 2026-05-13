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
  /** Snapshot the largest layout extent *before* the keyboard animates; then re-measure. */
  remeasure: () => void;
}

function readExpandedExtent(vv: VisualViewport): number {
  const merged = vv.height + vv.offsetTop;
  return Math.max(merged, window.innerHeight, document.documentElement.clientHeight);
}

/**
 * iOS (Safari + PWA) often shrinks `window.innerHeight` together with `visualViewport`
 * when the keyboard opens, so `innerHeight - visualViewport.height` is ~0.
 *
 * We keep a **monotonic baseline** of the largest expanded layout extent and set
 * `keyboardInset = max(0, baseline - (vv.height + vv.offsetTop), …)`.
 *
 * The baseline is **only refreshed when the inset is small** (keyboard dismissed),
 * never overwritten using the compressed "keyboard open" metrics — that mistake
 * is what zeroed the inset on iOS before.
 */
export function useVisualViewportComposerMetrics(reservePx = 0): VisualViewportComposerMetrics {
  const [keyboardInset, setKeyboardInset] = useState(0);
  const baselineRef = useRef(0);
  const updateRef = useRef<() => void>(() => {});

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const bumpBaseline = () => {
      baselineRef.current = Math.max(baselineRef.current, readExpandedExtent(vv));
    };

    const update = () => {
      const ih = window.innerHeight;
      const docH = document.documentElement.clientHeight;
      const merged = vv.height + vv.offsetTop;

      const fromBaseline = Math.max(0, baselineRef.current - merged);
      const fromDoc = Math.max(0, docH - merged);
      const fromInner = Math.max(0, ih - merged);
      const gapInner = Math.max(0, ih - vv.height - vv.offsetTop);

      let next = Math.max(fromBaseline, fromDoc, fromInner, gapInner);
      const cap = Math.max(ih, docH, baselineRef.current || ih, 1) * 0.75;
      next = Math.min(next, cap);
      if (!Number.isFinite(next) || next < 0) next = 0;

      // Keyboard dismissed (or nearly): adopt the current expanded layout for next open.
      if (next < 72) {
        bumpBaseline();
      }

      setKeyboardInset(next);
    };

    const remeasureInner = () => {
      bumpBaseline();
      update();
    };

    updateRef.current = remeasureInner;
    bumpBaseline();
    update();

    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("resize", update);

    const onOrientation = () => {
      baselineRef.current = 0;
      setTimeout(() => {
        bumpBaseline();
        update();
      }, 320);
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
