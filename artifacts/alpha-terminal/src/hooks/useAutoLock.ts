import { useEffect, useRef, useCallback, useState } from "react";
import { useClerk } from "@clerk/clerk-react";
import { toast } from "@/hooks/use-toast";

const STORAGE_KEY = "at_auto_lock_minutes";
const WARNING_SECONDS = 60;

const TIMER_OPTIONS = [
  { label: "Never", value: 0 },
  { label: "After 5 min", value: 5 },
  { label: "After 10 min", value: 10 },
  { label: "After 15 min", value: 15 },
  { label: "After 30 min", value: 30 },
  { label: "After 1 hour", value: 60 },
  { label: "After 2 hours", value: 120 },
] as const;

function readStoredMinutes(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const n = parseInt(raw, 10);
      if (!isNaN(n) && TIMER_OPTIONS.some(o => o.value === n)) return n;
    }
  } catch {}
  return 30;
}

function writeStoredMinutes(val: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(val));
  } catch {}
}

export function useAutoLock() {
  const { signOut } = useClerk();
  const [minutes, setMinutesState] = useState(readStoredMinutes);

  const minutesRef = useRef(minutes);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningDismiss = useRef<(() => void) | null>(null);
  const isWarning = useRef(false);

  useEffect(() => {
    minutesRef.current = minutes;
  }, [minutes]);

  const clearTimers = useCallback(() => {
    if (idleTimer.current) { clearTimeout(idleTimer.current); idleTimer.current = null; }
    if (warningTimer.current) { clearTimeout(warningTimer.current); warningTimer.current = null; }
    if (warningDismiss.current) { warningDismiss.current(); warningDismiss.current = null; }
    isWarning.current = false;
  }, []);

  const doSignOut = useCallback(() => {
    clearTimers();
    signOut().catch(() => {});
  }, [signOut, clearTimers]);

  const startTimers = useCallback((mins: number) => {
    clearTimers();
    if (mins <= 0) return;

    const totalMs = mins * 60 * 1000;
    const warningMs = totalMs - WARNING_SECONDS * 1000;

    if (warningMs > 0) {
      warningTimer.current = setTimeout(() => {
        isWarning.current = true;
        const t = toast({
          title: "Session Expiring",
          description: "Session expiring in 60 seconds due to inactivity. Tap anywhere to stay signed in.",
          variant: "destructive",
          duration: WARNING_SECONDS * 1000,
        });
        warningDismiss.current = t.dismiss;
      }, warningMs);
    }

    idleTimer.current = setTimeout(() => {
      doSignOut();
    }, totalMs);
  }, [clearTimers, doSignOut]);

  const resetTimer = useCallback(() => {
    const current = minutesRef.current;
    if (current <= 0) return;
    if (isWarning.current && warningDismiss.current) {
      warningDismiss.current();
      warningDismiss.current = null;
    }
    startTimers(current);
  }, [startTimers]);

  const setMinutes = useCallback((val: number) => {
    writeStoredMinutes(val);
    setMinutesState(val);
  }, []);

  useEffect(() => {
    startTimers(minutes);

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    const handler = () => resetTimer();

    events.forEach(e => window.addEventListener(e, handler, { passive: true }));

    return () => {
      clearTimers();
      events.forEach(e => window.removeEventListener(e, handler));
    };
  }, [minutes, startTimers, resetTimer, clearTimers]);

  return { minutes, setMinutes, timerOptions: TIMER_OPTIONS };
}
