import { create } from "zustand";

export type AuthNoticeKind = "schwab" | "clerk";

export interface AuthNotice {
  kind: AuthNoticeKind;
  message: string;
  detail?: string;
}

interface AuthNoticeState {
  notice: AuthNotice | null;
  setNotice: (n: AuthNotice | null) => void;
  dismiss: () => void;
  clearSchwabAuthNotice: () => void;
}

/** Avoid flooding the UI when many requests fail at once. */
const SIGNAL_DEBOUNCE_MS = 45_000;
const lastSignalAt: Partial<Record<AuthNoticeKind, number>> = {};

function shouldEmit(kind: AuthNoticeKind): boolean {
  const now = Date.now();
  const prev = lastSignalAt[kind] ?? 0;
  if (now - prev < SIGNAL_DEBOUNCE_MS) return false;
  lastSignalAt[kind] = now;
  return true;
}

export const useAuthNoticeStore = create<AuthNoticeState>((set) => ({
  notice: null,
  setNotice: (notice) => set({ notice }),
  dismiss: () => {
    for (const k of Object.keys(lastSignalAt) as AuthNoticeKind[]) {
      delete lastSignalAt[k];
    }
    set({ notice: null });
  },
  clearSchwabAuthNotice: () => {
    const current = useAuthNoticeStore.getState().notice;
    if (current?.kind !== "schwab") return;
    delete lastSignalAt.schwab;
    set({ notice: null });
  },
}));

/** Clear the Schwab session-lost banner only; leaves Clerk notices untouched. */
export function clearSchwabAuthNotice(): void {
  useAuthNoticeStore.getState().clearSchwabAuthNotice();
}

/** Schwab OAuth / refresh-token chain broke — user should reconnect Schwab (Clerk may still be fine). */
export function signalSchwabAuthLost(message: string, detail?: string): void {
  if (!shouldEmit("schwab")) return;
  useAuthNoticeStore.getState().setNotice({ kind: "schwab", message, detail });
}

/** Clerk JWT missing or API rejected the session — reload or sign in again. */
export function signalClerkAuthLost(message: string, detail?: string): void {
  if (!shouldEmit("clerk")) return;
  useAuthNoticeStore.getState().setNotice({ kind: "clerk", message, detail });
}
