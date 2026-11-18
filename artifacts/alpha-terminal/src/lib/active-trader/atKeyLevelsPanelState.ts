const STORAGE_KEY = "activeTraderKeyLevelsExpanded:v1";

/** Collapsed by default — preserves ladder height on mobile. */
export function loadAtKeyLevelsExpanded(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveAtKeyLevelsExpanded(expanded: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, expanded ? "1" : "0");
  } catch {
    /* ignore */
  }
}