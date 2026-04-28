import { createContext, useContext, useEffect, useRef, useCallback, useState } from "react";
import type { ReactNode } from "react";
import { useClerk } from "@clerk/clerk-react";
import React from "react";
import { readSecurityPrefs, updateSecurityPref, TIMEOUT_OPTIONS } from "@/lib/securityPrefs";
import { queryClient } from "@/App";
import { signOutWithFullNavigation } from "@/lib/clerkSignOut";

const devBypass = import.meta.env.VITE_DEV_BYPASS_AUTH === "true";

function useClerkSafe() {
  if (devBypass) return { signOut: () => Promise.resolve() };
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useClerk();
}

const LAST_ACTIVITY_KEY = "alphaTerminal_lastActivity";
const WARNING_SECONDS = 60;

export type SessionTimeoutMinutes = 0 | 15 | 30 | 60 | 90;

export { TIMEOUT_OPTIONS };

function readStoredTimeout(): SessionTimeoutMinutes {
  const prefs = readSecurityPrefs();
  return prefs.sessionTimeout as SessionTimeoutMinutes;
}

function stampActivity() {
  try { localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now())); } catch {}
}

function getLastActivity(): number {
  try {
    const val = localStorage.getItem(LAST_ACTIVITY_KEY);
    return val ? Number(val) : Date.now();
  } catch { return Date.now(); }
}

function isExpired(timeoutMinutes: number): boolean {
  if (timeoutMinutes <= 0) return false;
  const elapsed = Date.now() - getLastActivity();
  return elapsed >= timeoutMinutes * 60 * 1000;
}

interface AutoLockState {
  minutes: SessionTimeoutMinutes;
  setMinutes: (m: SessionTimeoutMinutes) => void;
  warning: boolean;
  countdown: number;
}

const AutoLockContext = createContext<AutoLockState | null>(null);

export function AutoLockProvider({ children }: { children: ReactNode }) {
  const { signOut } = useClerkSafe();
  const [minutes, setMinutesState] = useState<SessionTimeoutMinutes>(readStoredTimeout);
  const [warning, setWarning] = useState(false);
  const [countdown, setCountdown] = useState(WARNING_SECONDS);
  const [locked, setLocked] = useState(false);

  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const warningActiveRef = useRef(false);
  const minutesRef = useRef(minutes);
  minutesRef.current = minutes;

  const doSignOut = useCallback(() => {
    setLocked(true);
    queryClient.clear();
    try { localStorage.removeItem(LAST_ACTIVITY_KEY); } catch {}
    if (!devBypass) {
      void signOutWithFullNavigation(signOut);
    }
  }, [signOut]);

  const clearTimers = useCallback(() => {
    if (warningTimerRef.current) { clearTimeout(warningTimerRef.current); warningTimerRef.current = null; }
    if (lockTimerRef.current) { clearTimeout(lockTimerRef.current); lockTimerRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    warningActiveRef.current = false;
    setWarning(false);
    setCountdown(WARNING_SECONDS);
  }, []);

  const scheduleTimers = useCallback(() => {
    clearTimers();
    const m = minutesRef.current;
    if (m <= 0) return;

    if (isExpired(m)) {
      doSignOut();
      return;
    }

    const totalMs = m * 60 * 1000;
    const elapsed = Date.now() - getLastActivity();
    const remaining = totalMs - elapsed;

    const warningMs = remaining - WARNING_SECONDS * 1000;
    if (warningMs > 0) {
      warningTimerRef.current = setTimeout(() => {
        warningActiveRef.current = true;
        setWarning(true);
        let secs = WARNING_SECONDS;
        setCountdown(secs);
        countdownRef.current = setInterval(() => {
          secs -= 1;
          setCountdown(secs);
          if (secs <= 0 && countdownRef.current) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
          }
        }, 1000);
      }, warningMs);
    } else if (remaining > 0) {
      warningActiveRef.current = true;
      setWarning(true);
      let secs = Math.ceil(remaining / 1000);
      setCountdown(secs);
      countdownRef.current = setInterval(() => {
        secs -= 1;
        setCountdown(secs);
        if (secs <= 0 && countdownRef.current) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
        }
      }, 1000);
    }

    lockTimerRef.current = setTimeout(() => {
      clearTimers();
      doSignOut();
    }, remaining);
  }, [clearTimers, doSignOut]);

  useEffect(() => {
    if (minutes > 0 && isExpired(minutes)) {
      doSignOut();
      return;
    }

    stampActivity();
    scheduleTimers();

    const INTERACTION_EVENTS = [
      "mousedown", "keydown", "touchstart", "touchmove",
      "scroll", "pointerdown", "click", "input", "wheel",
    ] as const;

    const onInteraction = () => {
      stampActivity();
      if (warningActiveRef.current) {
        warningActiveRef.current = false;
        setWarning(false);
        setCountdown(WARNING_SECONDS);
      }
      scheduleTimers();
    };

    for (const evt of INTERACTION_EVENTS) {
      window.addEventListener(evt, onInteraction, { passive: true, capture: true });
    }

    const onVisibilityChange = () => {
      if (document.hidden) return;
      const m = minutesRef.current;
      if (m <= 0) return;
      if (isExpired(m)) {
        clearTimers();
        doSignOut();
      } else {
        scheduleTimers();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    const onFocus = () => {
      const m = minutesRef.current;
      if (m <= 0) return;
      if (isExpired(m)) {
        clearTimers();
        doSignOut();
      } else {
        scheduleTimers();
      }
    };
    window.addEventListener("focus", onFocus);

    return () => {
      clearTimers();
      for (const evt of INTERACTION_EVENTS) {
        window.removeEventListener(evt, onInteraction, true);
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [minutes, scheduleTimers, clearTimers, doSignOut]);

  const setMinutes = useCallback((m: SessionTimeoutMinutes) => {
    updateSecurityPref("sessionTimeout", m);
    setMinutesState(m);
    stampActivity();
  }, []);

  if (locked && !devBypass) {
    return null;
  }

  const value: AutoLockState = { minutes, setMinutes, warning, countdown };

  return React.createElement(AutoLockContext.Provider, { value }, children);
}

export function useAutoLock(): AutoLockState {
  const ctx = useContext(AutoLockContext);
  if (!ctx) {
    throw new Error("useAutoLock must be used within an AutoLockProvider");
  }
  return ctx;
}
