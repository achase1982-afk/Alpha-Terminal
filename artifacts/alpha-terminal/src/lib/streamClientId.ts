const STORAGE_KEY = "alpha-stream-client-id";

let memoryClientId: string | undefined;

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
    if (!memoryClientId) memoryClientId = randomId();
    return memoryClientId;
  }
}

/** Short stable hash for stream view ids (e.g. chain:<root>:<hash8>). */
export function hash8(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 8);
}

export function buildStreamHolderId(
  clientId: string,
  purpose: string,
  viewId: string,
): string {
  const v = viewId.trim();
  return v ? `stream:${clientId}:${purpose}:${v}` : `stream:${clientId}:${purpose}`;
}

