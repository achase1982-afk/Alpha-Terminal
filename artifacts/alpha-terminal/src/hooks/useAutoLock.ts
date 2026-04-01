import { createContext, useContext, useEffect, useRef, useCallback, useState } from "react";
import type { ReactNode } from "react";
import { useClerk } from "@clerk/clerk-react";
import React from "react";
import { readSecurityPrefs, updateSecurityPref, TIMEOUT_OPTIONS } from "@/lib/securityPrefs";
import { queryClient } from "@/App";

const devBypass = import.meta.env.VITE_DEV_BYPASS_AUTH === "true";

function useClerkSafe() {
  if (devBypass) return { signOut: () => Promise.resolve() };
  return useClerk();
}

const WARNING_SECONDS = 60;
const LAST_ACTIVITY_KEY = "alphaTerminal_lastActivity";

export type SessionTimeoutMinutes = 0 | 15 | 30 | 60 | 90;

export { TIMEOUT_OPTIONS };

function readStoredTimeout(): SessionTimeoutMinutes {
  const prefs = readSecurityPrefs();
  return prefs.sessionTimeout as SessionTimeoutMinutes;
}

function saveLastActivity() {
  try { localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now())); } catch {}
}

function getLastActivity(): number {
  try {
    const val = localStorage.getItem(LAST_ACTIVITY_KEY);
    return val ? Number(val) : Date.now();
  } catch { return Date.now(); }
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

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const warningActiveRef = useRef(false);
  const deadlineRef = useRef<number>(0);

  const doSignOut = useCallback(() => {
    queryClient.clear();
    void signOut();
  }, [signOut]);

  const clearAllTimers = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (warningTimerRef.current) { clearTimeout(warningTimerRef.current); warningTimerRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    warningActiveRef.current = false;
    setWarning(false);
    setCountdown(WARNING_SECONDS);
  }, []);

  const startTimers = useCallback(() => {
    clearAllTimers();
    if (minutes === 0) { deadlineRef.current = 0; return; }

    const totalMs = minutes * 60 * 1000;
    const now = Date.now();
    const lastActivity = getLastActivity();
    const elapsed = now - lastActivity;

    if (elapsed >= totalMs) {
      doSignOut();
      return;
    }

    const remaining = totalMs - elapsed;
    deadlineRef.current = now + remaining;
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

    timerRef.current = setTimeout(() => {
      clearAllTimers();
      doSignOut();
    }, remaining);
  }, [minutes, clearAllTimers, doSignOut]);

  const resetActivity = useCallback(() => {
    saveLastActivity();
    startTimers();
  }, [startTimers]);

  useEffect(() => {
    saveLastActivity();
    startTimers();

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"] as const;

    const handler = () => {
      if (warningActiveRef.current) {
        warningActiveRef.current = false;
        setWarning(false);
        setCountdown(WARNING_SECONDS);
      }
      resetActivity();
    };

    for (const evt of events) {
      window.addEventListener(evt, handler, { passive: true });
    }

    const handleVisibility = () => {
      if (!document.hidden) {
        if (minutes === 0) return;
        const now = Date.now();
        const lastActivity = getLastActivity();
        const totalMs = minutes * 60 * 1000;
        const elapsed = now - lastActivity;

        if (elapsed >= totalMs) {
          clearAllTimers();
          doSignOut();
        } else {
          startTimers();
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearAllTimers();
      for (const evt of events) {
        window.removeEventListener(evt, handler);
      }
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [startTimers, resetActivity, clearAllTimers, minutes, doSignOut]);

  const setMinutes = useCallback((m: SessionTimeoutMinutes) => {
    updateSecurityPref("sessionTimeout", m);
    setMinutesState(m);
    saveLastActivity();
  }, []);

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
