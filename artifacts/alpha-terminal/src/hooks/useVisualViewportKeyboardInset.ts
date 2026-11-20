import { useCallback, useEffect, useRef, useState } from "react";
import {
  installPwaKeyboardSession,
  isUserKeyboardSession,
  subscribeKeyboardSession,
} from "@/hooks/pwaKeyboardSession";

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
  /** Clear monotonic baseline after keyboard dismiss (avoids stuck panel height). */
  resetBaseline: () => void;
}

function readExpandedExtent(vv: VisualViewport): number {
  const merged = vv.height + vv.offsetTop;
  const ih = window.innerHeight;
  const docH = document.documentElement.clientHeight;
  // Avoid `docH` inflating the baseline when it reflects scrollable document height.
  const layoutH = docH > 0 && docH < ih * 1.35 ? Math.max(merged, ih, docH) : Math.max(merged, ih);
  return layoutH;
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
export interface VisualViewportComposerOptions {
  /**
   * When false (composer not focused), keyboard inset uses **only** the direct
   * `innerHeight - visualViewport` gap. That ignores the monotonic baseline, which
   * otherwise stayed inflated on some iPhones and pinned the fixed composer hundreds
   * of px above the bottom nav when the keyboard was closed.
   */
  composerFocused?: boolean;
}

export function useVisualViewportComposerMetrics(
  reservePx = 0,
  opts?: VisualViewportComposerOptions,
): VisualViewportComposerMetrics {
  const [keyboardInset, setKeyboardInset] = useState(0);
  const baselineRef = useRef(0);
  const updateRef = useRef<() => void>(() => {});
  const resetBaselineRef = useRef<() => void>(() => {});
  const focusedRef = useRef(false);
  focusedRef.current = opts?.composerFocused ?? false;

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const bumpBaseline = () => {
      baselineRef.current = Math.max(baselineRef.current, readExpandedExtent(vv));
    };

    const update = () => {
      const ih = window.innerHeight;
      const merged = vv.height + vv.offsetTop;

      const fromBaseline = Math.max(0, baselineRef.current - merged);
      // Distance from bottom of layout viewport to bottom of visual viewport (keyboard overlap).
      const directInset = Math.max(0, ih - merged);
      const cap = Math.max(ih, baselineRef.current || ih, 1) * 0.62;

      const focused = focusedRef.current;
      let raw: number;
      if (!focused) {
        // Keyboard dismissed (or no focus): never let a stale baseline lift the dock.
        raw = Math.min(Math.max(0, directInset), cap);
      } else {
        /**
         * Prefer the direct inset whenever it is clearly non-zero. Taking `max(direct, baseline)`
         * permanently let an inflated baseline dominate on some iOS builds, which set
         * `position: fixed; bottom: …` hundreds of px too high — the composer floated mid-screen
         * with chat scrolling underneath.
         */
        const TRUST_DIRECT_MIN = 20;
        raw =
          directInset >= TRUST_DIRECT_MIN ? directInset : Math.max(directInset, fromBaseline);
        raw = Math.min(raw, cap);
      }

      if (!Number.isFinite(raw) || raw < 0) raw = 0;

      // Slight tuck when overlap is clearly the keyboard band.
      const next = raw >= 100 ? Math.round(raw * 0.92) : raw;

      // Keyboard dismissed (or nearly): adopt the current expanded layout for next open.
      if (next < 72) {
        bumpBaseline();
      }

      setKeyboardInset(next);
    };

    const remeasureInner = () => {
      update();
    };

    updateRef.current = remeasureInner;
    resetBaselineRef.current = () => {
      baselineRef.current = 0;
      bumpBaseline();
      update();
    };
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

  const resetBaseline = useCallback(() => {
    resetBaselineRef.current();
  }, []);

  const dockBottomPx = Math.max(reservePx, keyboardInset);

  return { keyboardInset, dockBottomPx, remeasure, resetBaseline };
}

/** Keyboard-only inset (no minimum dock). For simple `padding-bottom` tweaks. */
export function useVisualViewportKeyboardInset(): number {
  const { keyboardInset } = useVisualViewportComposerMetrics(0);
  return keyboardInset;
}

/** Minimal seam between composer and keyboard (0 = flush). */
const KEYBOARD_GAP_PX = 0;

/** Reserve above bottom tab bar when keyboard is closed (nav padding + icons). */
export const MOBILE_BOTTOM_NAV_RESERVE_PX = 82;

/**
 * Height (px) of the software keyboard overlapping the layout viewport.
 */
export function measureKeyboardOverlapPx(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  const raw = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return raw;
}

export type ComposerDockStyle = {
  position: "fixed";
  left: number;
  right: number;
  zIndex: number;
  top?: number;
  bottom?: number;
};

export interface ChatComposerDockMetrics {
  /** Fixed positioning for a body-portaled composer. */
  dockStyle: ComposerDockStyle;
  /** Padding-bottom for the message scroller so content clears the docked composer. */
  scrollPaddingBottomPx: number;
  remeasure: () => void;
}

export interface BottomInputDockMetrics {
  /** `bottom` offset (px) for a `position: fixed` input dock. */
  dockBottomPx: number;
  /** Padding-bottom so scrollable content clears the docked input. */
  scrollPaddingBottomPx: number;
  remeasure: () => void;
}

const KEYBOARD_OPEN_OVERLAP_PX = 48;

export interface BottomInputDockResolution {
  dockBottomPx: number;
  scrollPaddingBottomPx: number;
}

/**
 * Where a thumb-zone field sits.
 *
 * A live typing session follows the keyboard overlap. Overlap left behind by an
 * iOS app switch (the visual viewport stays short, the keys do not come back)
 * is ignored, so the field is not stranded in the blank band.
 */
export function resolveBottomInputDock(args: {
  userSession: boolean;
  inputFocused: boolean;
  overlapPx: number;
  idleBottomPx: number;
  dockHeightPx: number;
}): BottomInputDockResolution {
  const h = Math.max(56, args.dockHeightPx);
  const overlap = args.userSession ? Math.max(0, args.overlapPx) : 0;
  const focused = args.userSession && args.inputFocused;
  const keyboardOpen = overlap >= KEYBOARD_OPEN_OVERLAP_PX;
  if (focused || keyboardOpen) {
    const bottomInset = overlap + KEYBOARD_GAP_PX;
    return {
      dockBottomPx: bottomInset,
      scrollPaddingBottomPx: h + bottomInset + 12,
    };
  }
  const bottom = args.idleBottomPx;
  return {
    dockBottomPx: bottom,
    scrollPaddingBottomPx: h + bottom + 8,
  };
}

/**
 * Tracks `visualViewport` for a thumb-zone input dock: flush on the keyboard when focused /
 * keyboard open, otherwise `idleBottomPx` above the layout bottom (0 for full-screen sheets).
 */
export function useBottomInputDock(
  enabled: boolean,
  inputFocused: boolean,
  dockHeightPx: number,
  idleBottomPx: number,
): BottomInputDockMetrics {
  const [dockBottomPx, setDockBottomPx] = useState(idleBottomPx);
  const [scrollPaddingBottomPx, setScrollPaddingBottomPx] = useState(
    Math.max(56, dockHeightPx) + idleBottomPx + 8,
  );
  const focusedRef = useRef(inputFocused);
  const heightRef = useRef(dockHeightPx);
  focusedRef.current = inputFocused;
  heightRef.current = dockHeightPx;
  const idleRef = useRef(idleBottomPx);
  idleRef.current = idleBottomPx;
  const updateRef = useRef<() => void>(() => {});

  useEffect(() => {
    installPwaKeyboardSession();
    if (!enabled) return;
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const next = resolveBottomInputDock({
        userSession: isUserKeyboardSession(),
        inputFocused: focusedRef.current,
        overlapPx: measureKeyboardOverlapPx(),
        idleBottomPx: idleRef.current,
        dockHeightPx: heightRef.current,
      });
      setDockBottomPx(next.dockBottomPx);
      setScrollPaddingBottomPx(next.scrollPaddingBottomPx);
    };

    updateRef.current = update;
    update();
    const unsubSession = subscribeKeyboardSession(update);

    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);

    return () => {
      unsubSession();
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [enabled]);

  useEffect(() => {
    updateRef.current();
  }, [dockHeightPx, inputFocused, idleBottomPx]);

  const remeasure = useCallback(() => {
    updateRef.current();
  }, []);

  return { dockBottomPx, scrollPaddingBottomPx, remeasure };
}

/** Full-screen mobile search: dock sits on the keyboard or the sheet bottom (nav hidden). */
export function useSearchInputDock(
  enabled: boolean,
  inputFocused: boolean,
  dockHeightPx: number,
): BottomInputDockMetrics {
  return useBottomInputDock(enabled, inputFocused, dockHeightPx, 0);
}

/**
 * Docks the chat composer to the **visual viewport** bottom when focused (sits on top of the
 * keyboard), or above the bottom nav when blurred. Uses `top` from `visualViewport` rather than
 * layout `bottom` so iOS `interactive-widget=overlays-content` cannot cover the textarea.
 */
export function useChatComposerDock(
  enabled: boolean,
  composerFocused: boolean,
  composerHeightPx: number,
): ChatComposerDockMetrics {
  const { dockBottomPx, scrollPaddingBottomPx, remeasure } = useBottomInputDock(
    enabled,
    composerFocused,
    composerHeightPx,
    MOBILE_BOTTOM_NAV_RESERVE_PX,
  );

  const dockStyle: ComposerDockStyle = {
    position: "fixed",
    left: 0,
    right: 0,
    zIndex: 10050,
    bottom: dockBottomPx,
  };

  return { dockStyle, scrollPaddingBottomPx, remeasure };
}
