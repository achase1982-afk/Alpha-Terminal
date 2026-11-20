import { useLayoutEffect } from "react";

/**
 * Phone shell size.
 *
 * iOS home-screen apps fire a visualViewport resize while switching away and
 * often never fire a correcting one on the way back. The height left behind is
 * a short band: the chain clips to a couple of rows, Recenter sits on the
 * quotes, and the search button rides up over the tab bar. While nothing is
 * being typed, keep the last full height for this orientation.
 */

const COLLAPSE_PX = 140;
const KEYBOARD_FOLLOW_MS = 600;

function isEditableFocused(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || el === document.body) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) {
    return (
      el.type !== "button" &&
      el.type !== "checkbox" &&
      el.type !== "radio" &&
      el.type !== "range" &&
      el.type !== "file" &&
      el.type !== "submit" &&
      el.type !== "reset" &&
      el.type !== "image" &&
      el.type !== "hidden" &&
      el.type !== "color"
    );
  }
  return false;
}

function isPhone(): boolean {
  return window.matchMedia("(pointer: coarse) and (hover: none)").matches;
}

function isStandalonePwa(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

function writeViewport(height: number, width: number, top: number, left: number) {
  const doc = document.documentElement;
  doc.style.setProperty("--vvh", `${Math.round(height)}px`);
  doc.style.setProperty("--vvw", `${Math.round(width)}px`);
  doc.style.setProperty("--vv-top", `${Math.round(top)}px`);
  doc.style.setProperty("--vv-left", `${Math.round(left)}px`);
}

export function useViewportShell() {
  useLayoutEffect(() => {
    const vv = window.visualViewport;
    let lastGoodH = 0;
    let lastGoodW = 0;
    let lvhH = 0;
    let lvhW = 0;
    let followVvUntil = 0;
    let restoreTimer = 0;
    let resumeTimers: number[] = [];

    const readLvh = (width: number): number => {
      if (lvhH > 0 && Math.abs(width - lvhW) <= 80) return lvhH;
      const probe = document.createElement("div");
      probe.style.cssText =
        "position:fixed;top:0;left:0;height:100lvh;width:0;visibility:hidden;pointer-events:none";
      document.documentElement.appendChild(probe);
      const measured = probe.getBoundingClientRect().height;
      probe.remove();
      if (measured > 0 && (lvhH === 0 || measured > lvhH || Math.abs(width - lvhW) > 80)) {
        lvhH = measured;
        lvhW = width;
      }
      return lvhH;
    };

    const armRestore = () => {
      if (restoreTimer) window.clearTimeout(restoreTimer);
      restoreTimer = window.setTimeout(() => {
        restoreTimer = 0;
        update();
      }, KEYBOARD_FOLLOW_MS + 40);
    };

    const update = () => {
      if (document.hidden) return;

      const innerH = window.innerHeight;
      const innerW = window.innerWidth;
      const vvH = vv?.height ?? innerH;
      const vvW = vv?.width ?? innerW;
      const vvTop = vv?.offsetTop ?? 0;
      const vvLeft = vv?.offsetLeft ?? 0;
      const reported = Math.max(innerH, vvH);
      const focused = isEditableFocused();

      if (lastGoodW > 0 && Math.abs(innerW - lastGoodW) > 80) {
        lastGoodH = 0;
        lastGoodW = 0;
      }

      if (!isPhone()) {
        writeViewport(reported, Math.max(innerW, vvW), vvTop, vvLeft);
        return;
      }

      if (focused || performance.now() < followVvUntil) {
        if (focused) followVvUntil = performance.now() + KEYBOARD_FOLLOW_MS;
        writeViewport(vvH, vvW, vvTop, vvLeft);
        armRestore();
        return;
      }

      const lvh = readLvh(innerW);
      const collapsed = lastGoodH > 0 && lastGoodH - reported > COLLAPSE_PX;
      if (collapsed) {
        writeViewport(Math.max(lastGoodH, lvh), lastGoodW || innerW, 0, 0);
        return;
      }

      const next = isStandalonePwa() ? Math.max(reported, lvh) : reported;
      lastGoodH = next;
      lastGoodW = innerW;
      writeViewport(next, Math.max(innerW, vvW), vvTop, vvLeft);
    };

    const clearResumeTimers = () => {
      for (const id of resumeTimers) window.clearTimeout(id);
      resumeTimers = [];
    };

    const onForeground = () => {
      if (document.hidden) return;
      if (!isEditableFocused()) followVvUntil = 0;
      clearResumeTimers();
      update();
      requestAnimationFrame(update);
      resumeTimers.push(
        window.setTimeout(update, 50),
        window.setTimeout(update, 250),
        window.setTimeout(update, 700),
      );
    };

    const onOrientation = () => {
      lastGoodH = 0;
      lastGoodW = 0;
      lvhH = 0;
      lvhW = 0;
      followVvUntil = 0;
      onForeground();
    };

    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", onOrientation);
    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("pageshow", onForeground);
    window.addEventListener("focus", onForeground);

    return () => {
      clearResumeTimers();
      if (restoreTimer) window.clearTimeout(restoreTimer);
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", onOrientation);
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("pageshow", onForeground);
      window.removeEventListener("focus", onForeground);
    };
  }, []);
}
