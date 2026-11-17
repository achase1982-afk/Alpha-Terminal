const STORAGE_KEY = "alpha-stream-client-id";

function randomId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Stable per-browser-tab id for streamer hold ownership (server requires this). */
export function getStreamClientId(): string {
  try {
    let id = sessionStorage.getItem(STORAGE_KEY);
    if (!id || id.length < 8) {
      id = randomId();
      sessionStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    return randomId();
  }
}