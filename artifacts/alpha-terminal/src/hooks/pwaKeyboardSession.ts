/**
 * Phone keyboard session for the installed app.
 *
 * iOS keeps a focused field and the shrunk layout viewport when a standalone
 * PWA is sent to the background. Coming back paints the page in the keyboard
 * gap: the chain collapses, the ticker field stays focused, and the system
 * keyboard bar (previous / next / done) sits in a blank band where the keys
 * should be.
 *
 * A real typing session still follows the visual viewport. A session left
 * behind by an app switch does not: the field is blurred, the ticker search
 * closes, and the shell returns to the last height that filled the screen.
 */

const RESUME_BLOCK_MS = 1200;
const BACKGROUND_BLOCK_MS = 4000;
const RESUME_BLUR_DELAYS_MS = [0, 80, 320, 700, 1100];
const GESTURE_FALLBACK_MS = 1500;

export type KeyboardDismissReason = "background" | "resume";

let installed = false;
let userSession = false;
let gesture = false;
let documentWasHidden = false;
let followBlockedUntil = 0;
let gestureTimer = 0;
let resumeTimers: number[] = [];

const sessionListeners = new Set<() => void>();
const dismissListeners = new Set<(reason: KeyboardDismissReason) => void>();

function emitSession(): void {
  sessionListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a layout subscriber cannot block the blur */
    }
  });
}

function setSession(next: boolean): void {
  if (userSession === next) return;
  userSession = next;
  emitSession();
}

export function isUserKeyboardSession(): boolean {
  return userSession;
}

export function keyboardViewportFollowAllowed(now = performance.now()): boolean {
  return now >= followBlockedUntil;
}

export function subscribeKeyboardSession(fn: () => void): () => void {
  sessionListeners.add(fn);
  return () => {
    sessionListeners.delete(fn);
  };
}

export function subscribeKeyboardDismiss(fn: (reason: KeyboardDismissReason) => void): () => void {
  dismissListeners.add(fn);
  return () => {
    dismissListeners.delete(fn);
  };
}

function visuallySuppressed(el: HTMLElement): boolean {
  try {
    let node: HTMLElement | null = el;
    while (node) {
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return true;
      const raw = style.opacity;
      if (raw !== "" && raw != null) {
        const opacity = Number(raw);
        if (Number.isFinite(opacity) && opacity <= 0) return true;
      }
      node = node.parentElement;
    }
  } catch {
    return false;
  }
  return false;
}

export function isEditableElement(el: EventTarget | null): el is HTMLElement {
  if (!(el instanceof HTMLElement) || el === document.body) return false;
  if (visuallySuppressed(el)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLSelectElement) return !el.disabled;
  if (el instanceof HTMLInputElement) {
    if (el.readOnly || el.disabled) return false;
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

export function blurActiveEditable(): void {
  const el = document.activeElement;
  if (!isEditableElement(el)) return;
  el.blur();
}

function clearResumeTimers(): void {
  for (const id of resumeTimers) window.clearTimeout(id);
  resumeTimers = [];
}

function dismiss(reason: KeyboardDismissReason, blockMs = 0): void {
  if (blockMs > 0) followBlockedUntil = performance.now() + blockMs;
  setSession(false);
  blurActiveEditable();
  void window.innerHeight;
  void window.visualViewport?.height;
  dismissListeners.forEach((fn) => {
    try {
      fn(reason);
    } catch {
      /* closing the ticker search cannot block the blur */
    }
  });
}

function blurRestoredFocus(): void {
  if (isUserKeyboardSession()) return;
  blurActiveEditable();
}

function scheduleResumeBlurs(): void {
  clearResumeTimers();
  for (const delay of RESUME_BLUR_DELAYS_MS) {
    resumeTimers.push(window.setTimeout(blurRestoredFocus, delay));
  }
}

function endGestureSoon(): void {
  window.clearTimeout(gestureTimer);
  gestureTimer = window.setTimeout(() => {
    gesture = false;
  }, 0);
}

/** Call immediately before a programmatic focus() that should open the keyboard. */
export function noteKeyboardGesture(): void {
  gesture = true;
  window.clearTimeout(gestureTimer);
  gestureTimer = window.setTimeout(() => {
    gesture = false;
  }, 0);
}

function onPointerDown(): void {
  gesture = true;
  window.clearTimeout(gestureTimer);
  gestureTimer = window.setTimeout(() => {
    gesture = false;
  }, GESTURE_FALLBACK_MS);
}

function onPointerDone(): void {
  endGestureSoon();
}

function onFocusIn(event: FocusEvent): void {
  if (!isEditableElement(event.target)) return;
  const resumed = performance.now() < followBlockedUntil;
  if (resumed && !gesture) {
    if (event.target instanceof HTMLElement) event.target.blur();
    return;
  }
  setSession(true);
}

function onFocusOut(event: FocusEvent): void {
  if (!(event.target instanceof HTMLElement)) return;
  window.setTimeout(() => {
    if (!isEditableElement(document.activeElement)) setSession(false);
  }, 0);
}

function onBackground(): void {
  documentWasHidden = true;
  clearResumeTimers();
  dismiss("background", BACKGROUND_BLOCK_MS);
}

function onResume(): void {
  dismiss("resume", RESUME_BLOCK_MS);
  scheduleResumeBlurs();
}

function onVisibility(): void {
  if (document.hidden) {
    onBackground();
    return;
  }
  if (documentWasHidden) onResume();
}

function onPageHide(): void {
  onBackground();
}

function onPageShow(event: PageTransitionEvent): void {
  if (event.persisted || documentWasHidden) onResume();
}

function onWindowBlur(): void {
  window.setTimeout(() => {
    if (document.hidden) onBackground();
  }, 0);
}

export function installPwaKeyboardSession(): void {
  if (installed || typeof window === "undefined" || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointerup", onPointerDone, true);
  document.addEventListener("pointercancel", onPointerDone, true);
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("focusout", onFocusOut, true);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("blur", onWindowBlur);
}

export function resetPwaKeyboardSessionForTests(): void {
  clearResumeTimers();
  window.clearTimeout(gestureTimer);
  gestureTimer = 0;
  userSession = false;
  gesture = false;
  documentWasHidden = false;
  followBlockedUntil = 0;
  if (!installed || typeof document === "undefined") return;
  installed = false;
  document.removeEventListener("pointerdown", onPointerDown, true);
  document.removeEventListener("pointerup", onPointerDone, true);
  document.removeEventListener("pointercancel", onPointerDone, true);
  document.removeEventListener("focusin", onFocusIn, true);
  document.removeEventListener("focusout", onFocusOut, true);
  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("pagehide", onPageHide);
  window.removeEventListener("pageshow", onPageShow);
  window.removeEventListener("blur", onWindowBlur);
}

/**
 * Shell follows the visual viewport while the member is typing, and for a
 * moment after the keyboard closes so the height can grow with the animation.
 * An app switch blocks that follow: a focused field left over from before the
 * switch must not pin the shell to the frozen keyboard height.
 */
export function shouldTrackKeyboardViewport(args: {
  userSession: boolean;
  editableFocused: boolean;
  now: number;
  followUntil: number;
  followAllowed: boolean;
}): boolean {
  if (args.userSession && args.editableFocused) return true;
  if (!args.followAllowed) return false;
  return args.now < args.followUntil;
}
