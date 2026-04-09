import { useState, useEffect, useCallback } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTerminalStore } from "@/lib/store";

const API_BASE = "/api";

export interface PresetUniverse {
  label: string;
  description: string;
  count: number;
}

export interface WatchlistEntry {
  id: number;
  name: string;
  symbols: string[];
  isProtected: boolean;
}

export interface ScreenEntry {
  id: number;
  name: string;
  filters: Record<string, any>;
  isDefault: boolean;
  cachedCount: number | null;
  cachedAt: string | null;
}

interface UniverseData {
  presets: Record<string, PresetUniverse>;
  watchlists: WatchlistEntry[];
  screens: ScreenEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  getSymbols: (universeKey: string) => Promise<string[]>;
  createWatchlist: (name: string, symbols?: string[]) => Promise<WatchlistEntry | null>;
  updateWatchlist: (id: number, data: { name?: string; symbols?: string[] }) => Promise<WatchlistEntry | null>;
  deleteWatchlist: (id: number) => Promise<boolean>;
  addSymbolToWatchlist: (id: number, symbol: string) => Promise<WatchlistEntry | null>;
  removeSymbolFromWatchlist: (id: number, symbol: string) => Promise<WatchlistEntry | null>;
  createScreen: (name: string, filters: Record<string, any>) => Promise<ScreenEntry | null>;
  updateScreen: (id: number, data: { name?: string; filters?: Record<string, any> }) => Promise<ScreenEntry | null>;
  deleteScreen: (id: number) => Promise<boolean>;
  runScreen: (id: number) => Promise<{ symbols: string[]; count: number; cachedAt: string | null; error?: string } | null>;
  previewScreen: (filters: Record<string, any>) => Promise<{ count: number; symbols: string[]; error?: string } | null>;
}

const presetSymbolsCache = new Map<string, string[]>();
const screenSymbolsCache = new Map<number, { symbols: string[]; cachedAt: string | null }>();

export function useScannerUniverses(): UniverseData {
  const [presets, setPresets] = useState<Record<string, PresetUniverse>>({});
  const [watchlists, setWatchlists] = useState<WatchlistEntry[]>([]);
  const [screens, setScreens] = useState<ScreenEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [presetsRes, watchlistsRes, screensRes] = await Promise.all([
        fetchWithAuth(`${API_BASE}/scanner/universes`),
        fetchWithAuth(`${API_BASE}/scanner/watchlists`),
        fetchWithAuth(`${API_BASE}/scanner/screens`),
      ]);
      const [pd, wd, sd] = await Promise.all([presetsRes.json(), watchlistsRes.json(), screensRes.json()]);
      setPresets(pd.presets ?? {});
      setWatchlists(wd.watchlists ?? []);
      setScreens(sd.screens ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (loading || watchlists.length === 0) return;
    const SYNC_KEY = "scanner_wl_synced";
    if (localStorage.getItem(SYNC_KEY)) return;
    try {
      const raw = localStorage.getItem("alpha-terminal-store");
      if (!raw) { localStorage.setItem(SYNC_KEY, "1"); return; }
      const parsed = JSON.parse(raw);
      const state = parsed?.state ?? parsed;
      const localWl = state?.watchlists as Record<string, { name: string; symbols: string[] }> | undefined;
      if (!localWl) { localStorage.setItem(SYNC_KEY, "1"); return; }
      const entries = Object.entries(localWl).filter(([, v]) => v.symbols?.length > 0);
      if (entries.length === 0) { localStorage.setItem(SYNC_KEY, "1"); return; }
      const existingNames = new Set(watchlists.map(w => w.name.toLowerCase()));
      const toSync = entries.filter(([, v]) => !existingNames.has(v.name.toLowerCase()));
      if (toSync.length === 0) { localStorage.setItem(SYNC_KEY, "1"); return; }
      Promise.all(
        toSync.map(([, v]) =>
          fetchWithAuth(`${API_BASE}/scanner/watchlists`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: v.name, symbols: v.symbols }),
          }).then(r => r.json()).catch(() => null)
        )
      ).then(results => {
        const newWls = results.filter(r => r?.watchlist).map(r => r.watchlist as WatchlistEntry);
        if (newWls.length > 0) setWatchlists(prev => [...prev, ...newWls]);
        const allSucceeded = results.every(r => r?.watchlist);
        if (allSucceeded) localStorage.setItem(SYNC_KEY, "1");
      });
    } catch {
    }
  }, [loading, watchlists]);

  useEffect(() => {
    if (loading || watchlists.length === 0) return;
    const RESTORE_KEY = "scanner_wl_restored";
    if (localStorage.getItem(RESTORE_KEY)) return;
    const store = useTerminalStore.getState();
    const localWls = store.watchlists;
    const localIds = Object.keys(localWls);
    const isOnlyEmptyDefault = localIds.length === 1 && localIds[0] === "default" && localWls.default.symbols.length === 0;
    if (!isOnlyEmptyDefault) { localStorage.setItem(RESTORE_KEY, "1"); return; }
    const nonEmptyWls = watchlists.filter(w => w.symbols.length > 0);
    if (nonEmptyWls.length === 0) { localStorage.setItem(RESTORE_KEY, "1"); return; }
    const restoredWls: Record<string, { name: string; symbols: string[] }> = { default: { name: "My Watchlist", symbols: [] } };
    for (const wl of nonEmptyWls) {
      restoredWls[`scanner_${wl.id}`] = { name: wl.name, symbols: wl.symbols };
    }
    useTerminalStore.setState((s) => ({
      watchlists: { ...s.watchlists, ...restoredWls },
      activeWatchlistId: `scanner_${nonEmptyWls[0].id}`,
    }));
    localStorage.setItem(RESTORE_KEY, "1");
  }, [loading, watchlists]);

  const getSymbols = useCallback(async (universeKey: string): Promise<string[]> => {
    if (universeKey.startsWith("preset:")) {
      const key = universeKey.slice(7);
      if (presetSymbolsCache.has(key)) return presetSymbolsCache.get(key)!;
      const res = await fetchWithAuth(`${API_BASE}/scanner/universes/${key}/symbols`);
      const data = await res.json();
      const symbols = data.symbols ?? [];
      presetSymbolsCache.set(key, symbols);
      return symbols;
    }

    if (universeKey.startsWith("watchlist:")) {
      const id = parseInt(universeKey.slice(10));
      const wl = watchlists.find(w => w.id === id);
      return wl?.symbols ?? [];
    }

    if (universeKey.startsWith("screen:")) {
      const id = parseInt(universeKey.slice(7));
      const cached = screenSymbolsCache.get(id);
      if (cached) return cached.symbols;
      const res = await fetchWithAuth(`${API_BASE}/scanner/screens/${id}/symbols`);
      const data = await res.json();
      const symbols = data.symbols ?? [];
      screenSymbolsCache.set(id, { symbols, cachedAt: data.cachedAt });
      return symbols;
    }

    return [];
  }, [watchlists]);

  const createWatchlist = useCallback(async (name: string, symbols?: string[]): Promise<WatchlistEntry | null> => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/scanner/watchlists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, symbols: symbols ?? [] }),
      });
      const data = await res.json();
      if (data.watchlist) {
        setWatchlists(prev => [...prev, data.watchlist]);
        return data.watchlist;
      }
      return null;
    } catch { return null; }
  }, []);

  const updateWatchlist = useCallback(async (id: number, updates: { name?: string; symbols?: string[] }): Promise<WatchlistEntry | null> => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/scanner/watchlists/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.watchlist) {
        setWatchlists(prev => prev.map(w => w.id === id ? data.watchlist : w));
        return data.watchlist;
      }
      return null;
    } catch { return null; }
  }, []);

  const deleteWatchlist = useCallback(async (id: number): Promise<boolean> => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/scanner/watchlists/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        setWatchlists(prev => prev.filter(w => w.id !== id));
        return true;
      }
      return false;
    } catch { return false; }
  }, []);

  const addSymbolToWatchlist = useCallback(async (id: number, symbol: string): Promise<WatchlistEntry | null> => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/scanner/watchlists/${id}/symbols`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      const data = await res.json();
      if (data.watchlist) {
        setWatchlists(prev => prev.map(w => w.id === id ? data.watchlist : w));
        return data.watchlist;
      }
      return null;
    } catch { return null; }
  }, []);

  const removeSymbolFromWatchlist = useCallback(async (id: number, symbol: string): Promise<WatchlistEntry | null> => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/scanner/watchlists/${id}/symbols/${symbol}`, { method: "DELETE" });
      const data = await res.json();
      if (data.watchlist) {
        setWatchlists(prev => prev.map(w => w.id === id ? data.watchlist : w));
        return data.watchlist;
      }
      return null;
    } catch { return null; }
  }, []);

  const createScreen = useCallback(async (name: string, filters: Record<string, any>): Promise<ScreenEntry | null> => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/scanner/screens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, filters }),
      });
      const data = await res.json();
      if (data.screen) {
        setScreens(prev => [...prev, { ...data.screen, cachedCount: null }]);
        return data.screen;
      }
      return null;
    } catch { return null; }
  }, []);

  const updateScreen = useCallback(async (id: number, updates: { name?: string; filters?: Record<string, any> }): Promise<ScreenEntry | null> => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/scanner/screens/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.screen) {
        if (updates.filters) screenSymbolsCache.delete(id);
        setScreens(prev => prev.map(s => s.id === id ? { ...data.screen, cachedCount: data.screen.cachedCount ?? null } : s));
        return data.screen;
      }
      return null;
    } catch { return null; }
  }, []);

  const deleteScreen = useCallback(async (id: number): Promise<boolean> => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/scanner/screens/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        setScreens(prev => prev.filter(s => s.id !== id));
        screenSymbolsCache.delete(id);
        return true;
      }
      return false;
    } catch { return false; }
  }, []);

  const runScreen = useCallback(async (id: number) => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/scanner/screens/${id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json();
      if (data.symbols) {
        screenSymbolsCache.set(id, { symbols: data.symbols, cachedAt: data.cachedAt });
        setScreens(prev => prev.map(s => s.id === id ? { ...s, cachedCount: data.count, cachedAt: data.cachedAt } : s));
      }
      return data;
    } catch { return null; }
  }, []);

  const previewScreen = useCallback(async (filters: Record<string, any>) => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/scanner/screens/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters }),
      });
      return await res.json();
    } catch { return null; }
  }, []);

  return {
    presets, watchlists, screens, loading, error,
    refresh: fetchAll,
    getSymbols,
    createWatchlist, updateWatchlist, deleteWatchlist,
    addSymbolToWatchlist, removeSymbolFromWatchlist,
    createScreen, updateScreen, deleteScreen,
    runScreen, previewScreen,
  };
}
