import {
  DEFAULT_NET_PREMIUM_WINDOW_MS,
  NET_PREMIUM_WINDOW_CHOICES_MS,
  type NetPremiumWindowMs,
} from "./deskFlowNetPremium";

const STORAGE_KEY = "at-net-premium-window-ms";

export function loadAtFlowWindowMs(): NetPremiumWindowMs {
  if (typeof window === "undefined") return DEFAULT_NET_PREMIUM_WINDOW_MS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_NET_PREMIUM_WINDOW_MS;
    const n = Number(raw);
    if (NET_PREMIUM_WINDOW_CHOICES_MS.includes(n as NetPremiumWindowMs)) return n as NetPremiumWindowMs;
  } catch {
    /* ignore */
  }
  return DEFAULT_NET_PREMIUM_WINDOW_MS;
}

export function saveAtFlowWindowMs(ms: NetPremiumWindowMs): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(ms));
  } catch {
    /* ignore */
  }
}