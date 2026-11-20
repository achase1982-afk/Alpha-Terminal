import { useLayoutEffect } from "react";
import {
  installPwaKeyboardSession,
  isEditableElement,
  isUserKeyboardSession,
  keyboardViewportFollowAllowed,
  shouldTrackKeyboardViewport,
  subscribeKeyboardSession,
} from "@/hooks/pwaKeyboardSession";

/**
 * Phone shell size.
 *
 * The installed app draws in the webview iOS actually gives us. On current
 * iOS that webview ends at the bottom of the phone, and `screen.height` is
 * taller by the status bar that sits *above* the page. An older standalone
 * bug does the opposite: it reports the same shortfall but parks the missing
 * pixels *below* the page. Laying the shell out at `screen.height` in either
 * case pushes the footer into a band that is not painted, which clips the
 * menu and leaves a gray strip under it.
 *
 * Size the shell to the painted viewport. Do not translate it — an offset
 * slides the header under the clock or shoves the footer off the bottom.
 *
 * Safari keeps the visible viewport. After an app switch iOS can freeze that
 * viewport short — especially when a text field was focused and the keyboard
 * inset is never released. Keep the last height that actually filled the screen
 * unless the member is in a typing session that started on this visit.
 */

const COLLAPSE_PX = 140;
const KEYBOARD_FOLLOW_MS = 600;
const LETTERBOX_MIN_PX = 20;
const LETTERBOX_MAX_PX = 100;

export interface StandaloneShellMeasure {
  screenHeight: number;
  paintedHeight: number;
  offsetTop: number;
  /** `env(safe-area-inset-top)` in CSS pixels. */
  topInset: number;
  lastGoodHeight: number;
}

/**
 * Height of the installed-app shell.
 *
 * `screenHeight - paintedHeight` is the status bar. When that bar is outside
 * the webview, or when iOS has parked the same gap under the page, the extra
 * pixels are not a place we can draw the menu. Returns the painted height.
 * A viewport that collapses far below the last good height (app switch) keeps
 * that height instead.
 */
export function standaloneShellHeight(m: StandaloneShellMeasure): number {
  const painted = Math.max(0, m.paintedHeight);
  const screenH = Math.max(0, m.screenHeight);
  const orphan = screenH > 0 ? screenH - painted - Math.max(0, m.offsetTop) : 0;
  const topInset = Math.max(0, m.topInset);
  const statusBarOutside =
    topInset < 8 && orphan >= LETTERBOX_MIN_PX && orphan <= LETTERBOX_MAX_PX && m.offsetTop < 8;
  const bottomLetterbox =
    topInset >= LETTERBOX_MIN_PX &&
    orphan >= LETTERBOX_MIN_PX &&
    Math.abs(orphan - topInset) <= 16 &&
    m.offsetTop < 8;

  if ((statusBarOutside || bottomLetterbox) && painted > 0) return painted;

  if (m.lastGoodHeight > 0 && m.lastGoodHeight - painted > COLLAPSE_PX) return m.lastGoodHeight;

  if (painted > 0) return painted;
  return screenH;
}

function isEditableFocused(): boolean {
  return isEditableElement(document.activeElement);
}

const STUCK_VIEWPORT_GAP_PX = 140;

/**
 * `screen.height` includes the status bar. A gap that large is the software
 * keyboard still reserving space after the app was backgrounded, not the
 * status bar (that one is well under this).
 */
export function layoutViewportStuck(screenHeight: number, innerHeight: number, userSession: boolean): boolean {
  if (userSession) return false;
  if (!(screenHeight > 0) || !(innerHeight > 0)) return false;
  return screenHeight - innerHeight > STUCK_VIEWPORT_GAP_PX;
}

/**
 * Ask WebKit to recompute a layout viewport that stayed keyboard-short after
 * the field was blurred. Restores the same viewport meta immediately.
 */
export function nudgeStuckLayoutViewport(): boolean {
  if (typeof document === "undefined") return false;
  // A short desktop window, or Safari's collapsing toolbar, is not a stuck
  // keyboard. Only the installed phone app gets the viewport-meta nudge.
  if (!isPhone() || !isStandalonePwa()) return false;
  const fitted = standaloneScreenBox();
  if (!layoutViewportStuck(fitted.h, window.innerHeight, isUserKeyboardSession())) return false;
  const meta = document.querySelector('meta[name="viewport"]');
  if (!(meta instanceof HTMLMetaElement)) return false;
  const content = meta.content;
  if (!content.includes("interactive-widget=resizes-content")) return false;
  const stripped = content
    .replace(/,?\s*interactive-widget=resizes-content/g, "")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*$/g, "")
    .trim();
  meta.content = stripped;
  void document.documentElement.offsetHeight;
  meta.content = content;
  return true;
}

function isPhone(): boolean {
  return window.matchMedia("(pointer: coarse) and (hover: none)").matches;
}

function isStandalonePwa(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

/**
 * Full phone size in CSS pixels.
 * Do not derive orientation from innerHeight — that is the short value this
 * corrects, and a frozen viewport can be shorter than the width.
 */
function standaloneScreenBox(): { h: number; w: number } {
  const sh = window.screen?.height || 0;
  const sw = window.screen?.width || 0;
  if (sh <= 0 || sw <= 0) return { h: 0, w: 0 };
  const landscape = window.matchMedia("(orientation: landscape)").matches;
  const screenLandscape = sw > sh;
  if (landscape === screenLandscape) return { h: sh, w: sw };
  return { h: sw, w: sh };
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
    let topInset = -1;

    const readTopInset = (): number => {
      if (topInset >= 0) return topInset;
      const probe = document.createElement("div");
      probe.style.cssText =
        "position:fixed;padding-top:constant(safe-area-inset-top);padding-top:env(safe-area-inset-top);visibility:hidden;pointer-events:none";
      document.documentElement.appendChild(probe);
      const parsed = parseFloat(getComputedStyle(probe).paddingTop);
      probe.remove();
      topInset = Number.isFinite(parsed) ? parsed : 0;
      return topInset;
    };

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
      // While backgrounded, pin the shell to the last full height so iOS does
      // not snapshot the keyboard-shrunk page.
      if (document.hidden) {
        if (lastGoodH > 0) writeViewport(lastGoodH, lastGoodW || window.innerWidth, 0, 0);
        return;
      }

      const innerH = window.innerHeight;
      const innerW = window.innerWidth;
      const vvH = vv?.height ?? innerH;
      const vvW = vv?.width ?? innerW;
      const vvTop = vv?.offsetTop ?? 0;
      const vvLeft = vv?.offsetLeft ?? 0;
      const reported = Math.max(innerH, vvH);
      const now = performance.now();
      if (!keyboardViewportFollowAllowed(now)) followVvUntil = 0;
      const trackKeyboard = shouldTrackKeyboardViewport({
        userSession: isUserKeyboardSession(),
        editableFocused: isEditableFocused(),
        now,
        followUntil: followVvUntil,
        followAllowed: keyboardViewportFollowAllowed(now),
      });
      const phone = isPhone();
      const standalone = phone && isStandalonePwa();
      if (standalone) document.documentElement.dataset.standalone = "true";

      if (lastGoodW > 0 && Math.abs(innerW - lastGoodW) > 80) {
        lastGoodH = 0;
        lastGoodW = 0;
      }

      if (!phone) {
        writeViewport(reported, Math.max(innerW, vvW), vvTop, vvLeft);
        return;
      }

      if (trackKeyboard) {
        if (isUserKeyboardSession() && isEditableFocused()) {
          followVvUntil = now + KEYBOARD_FOLLOW_MS;
        }
        writeViewport(vvH, vvW, vvTop, vvLeft);
        armRestore();
        return;
      }

      if (standalone) {
        const fitted = standaloneScreenBox();
        const height = standaloneShellHeight({
          screenHeight: fitted.h,
          paintedHeight: reported,
          offsetTop: vvTop,
          topInset: readTopInset(),
          lastGoodHeight: lastGoodH,
        });
        const width = fitted.w > 0 ? fitted.w : Math.max(innerW, vvW);
        lastGoodH = height;
        lastGoodW = innerW;
        writeViewport(height, width, 0, 0);
        return;
      }

      const lvh = readLvh(innerW);
      const collapsed = lastGoodH > 0 && lastGoodH - reported > COLLAPSE_PX;
      if (collapsed) {
        writeViewport(Math.max(lastGoodH, lvh), lastGoodW || innerW, 0, 0);
        return;
      }

      lastGoodH = reported;
      lastGoodW = innerW;
      writeViewport(reported, Math.max(innerW, vvW), vvTop, vvLeft);
    };

    const clearResumeTimers = () => {
      for (const id of resumeTimers) window.clearTimeout(id);
      resumeTimers = [];
    };

    const onForeground = () => {
      if (document.hidden) return;
      if (!isUserKeyboardSession()) followVvUntil = 0;
      clearResumeTimers();
      update();
      requestAnimationFrame(update);
      resumeTimers.push(
        window.setTimeout(update, 50),
        window.setTimeout(update, 250),
        window.setTimeout(() => {
          update();
          if (nudgeStuckLayoutViewport()) update();
        }, 700),
      );
    };

    const onOrientation = () => {
      lastGoodH = 0;
      lastGoodW = 0;
      lvhH = 0;
      lvhW = 0;
      topInset = -1;
      followVvUntil = 0;
      onForeground();
    };

    installPwaKeyboardSession();
    const unsubSession = subscribeKeyboardSession(() => {
      if (!isUserKeyboardSession()) {
        if (keyboardViewportFollowAllowed()) {
          followVvUntil = performance.now() + KEYBOARD_FOLLOW_MS;
          armRestore();
        } else {
          followVvUntil = 0;
        }
      }
      update();
    });

    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", onOrientation);
    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("pageshow", onForeground);
    window.addEventListener("focus", onForeground);

    return () => {
      unsubSession();
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
