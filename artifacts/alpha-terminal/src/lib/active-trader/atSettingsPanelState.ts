const STORAGE_KEY = "activeTraderSettingsPanelOpen:v1";

/** Collapsed by default when unset. */
export function loadAtSettingsPanelOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveAtSettingsPanelOpen(open: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}