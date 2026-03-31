import { createContext, useContext, useEffect, useRef, useCallback, useState } from "react";
import type { ReactNode } from "react";
import { useClerk } from "@clerk/clerk-react";
import React from "react";

const LS_KEY = "at_auto_lock_minutes";
const WARNING_SECONDS = 60;

export type AutoLockMinutes = 0 | 5 | 10 | 15 | 30 | 60 | 120;

export const AUTO_LOCK_OPTIONS: { value: AutoLockMinutes; label: string }[] = [
  { value: 0, label: "Never" },
  { value: 5, label: "After 5 min" },
  { value: 10, label: "After 10 min" },
  { value: 15, label: "After 15 min" },
  { value: 30, label: "After 30 min" },
  { value: 60, label: "After 1 hour" },
  { value: 120, label: "After 2 hours" },
];

function readStoredMinutes(): AutoLockMinutes {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw === null) return 30;
    const n = Number(raw);
    if (AUTO_LOCK_OPTIONS.some((o) => o.value === n)) return n as AutoLockMinutes;
  } catch {}
  return 30;
}

function storeMinutes(m: AutoLockMinutes) {
  try {
    localStorage.setItem(LS_KEY, String(m));
  } catch {}
}

interface AutoLockState {
  minutes: AutoLockMinutes;
  setMinutes: (m: AutoLockMinutes) => void;
  warning: boolean;
  countdown: number;
}

const AutoLockContext = createContext<AutoLockState | null>(null);

export function AutoLockProvider({ children }: { children: ReactNode }) {
  const { signOut } = useClerk();
  const [minutes, setMinutesState] = useState<AutoLockMinutes>(readStoredMinutes);
  const [warning, setWarning] = useState(false);
  const [countdown, setCountdown] = useState(WARNING_SECONDS);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const warningActiveRef = useRef(false);

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
    if (minutes === 0) return;

    const totalMs = minutes * 60 * 1000;
    const warningMs = totalMs - WARNING_SECONDS * 1000;

    if (warningMs > 0) {
      warningTimerRef.current = setTimeout(() => {
        warningActiveRef.current = true;
        setWarning(true);
        let remaining = WARNING_SECONDS;
        setCountdown(remaining);
        countdownRef.current = setInterval(() => {
          remaining -= 1;
          setCountdown(remaining);
          if (remaining <= 0 && countdownRef.current) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
          }
        }, 1000);
      }, warningMs);
    }

    timerRef.current = setTimeout(() => {
      clearAllTimers();
      void signOut();
    }, totalMs);
  }, [minutes, clearAllTimers, signOut]);

  const resetActivity = useCallback(() => {
    startTimers();
  }, [startTimers]);

  useEffect(() => {
    startTimers();

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"] as const;

    const handler = () => {
      resetActivity();
    };

    for (const evt of events) {
      window.addEventListener(evt, handler, { passive: true });
    }

    return () => {
      clearAllTimers();
      for (const evt of events) {
        window.removeEventListener(evt, handler);
      }
    };
  }, [startTimers, resetActivity, clearAllTimers]);

  const setMinutes = useCallback((m: AutoLockMinutes) => {
    storeMinutes(m);
    setMinutesState(m);
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
