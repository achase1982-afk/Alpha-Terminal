import { useState, useRef, useEffect, useCallback } from "react";
import { X, Search, Plus, Trash2, Loader2, Check } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

interface WatchlistEditorProps {
  watchlist?: { id: number; name: string; symbols: string[]; isProtected?: boolean } | null;
  onClose: () => void;
  onCreate?: (name: string, symbols: string[]) => Promise<any>;
  onUpdate?: (id: number, data: { name?: string; symbols?: string[] }) => Promise<any>;
  onAddSymbol?: (id: number, symbol: string) => Promise<any>;
  onRemoveSymbol?: (id: number, symbol: string) => Promise<any>;
}

interface SearchResult {
  symbol: string;
  name: string;
}

export function WatchlistEditor({ watchlist, onClose, onCreate, onUpdate, onAddSymbol, onRemoveSymbol }: WatchlistEditorProps) {
  const isNew = !watchlist;
  const [name, setName] = useState(watchlist?.name ?? "");
  const [symbols, setSymbols] = useState<string[]>(watchlist?.symbols ?? []);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingName, setEditingName] = useState(isNew);
  const [removingSymbol, setRemovingSymbol] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (isNew && nameRef.current) nameRef.current.focus();
    else if (searchRef.current) searchRef.current.focus();
  }, [isNew]);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 1) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res = await fetchWithAuth(`/api/scanner/search?q=${encodeURIComponent(q)}&limit=8`);
      const data = await res.json();
      const results: SearchResult[] = (data.results ?? data ?? [])
        .map((r: any) => ({ symbol: r.symbol ?? r.ticker ?? "", name: r.name ?? r.description ?? "" }))
        .filter((r: SearchResult) => r.symbol);
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleSearchChange = (q: string) => {
    setSearchQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(q), 300);
  };

  const handleAddSymbol = async (sym: string) => {
    const upper = sym.toUpperCase().trim();
    if (!upper || symbols.includes(upper)) return;
    setError(null);

    if (!isNew && watchlist && onAddSymbol) {
      const result = await onAddSymbol(watchlist.id, upper);
      if (!result) { setError(`Failed to add ${upper}`); return; }
    }
    setSymbols(prev => [...prev, upper]);
    setSearchQuery("");
    setSearchResults([]);
    searchRef.current?.focus();
  };

  const handleRemoveSymbol = async (sym: string) => {
    setRemovingSymbol(sym);
    setError(null);
    if (!isNew && watchlist && onRemoveSymbol) {
      const result = await onRemoveSymbol(watchlist.id, sym);
      if (!result) { setError(`Failed to remove ${sym}`); setRemovingSymbol(null); return; }
    }
    setSymbols(prev => prev.filter(s => s !== sym));
    setRemovingSymbol(null);
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setSaving(true);
    setError(null);
    try {
      if (isNew && onCreate) {
        await onCreate(trimmedName, symbols);
      } else if (watchlist && onUpdate) {
        await onUpdate(watchlist.id, { name: trimmedName, symbols });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save watchlist");
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && searchQuery.trim()) {
      e.preventDefault();
      if (searchResults.length > 0) {
        handleAddSymbol(searchResults[0].symbol);
      } else {
        handleAddSymbol(searchQuery);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#141414] border border-zinc-700/80 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {editingName ? (
              <input
                ref={nameRef}
                value={name}
                onChange={e => setName(e.target.value)}
                onBlur={() => { if (name.trim()) setEditingName(false); }}
                onKeyDown={e => { if (e.key === "Enter" && name.trim()) setEditingName(false); }}
                placeholder="Watchlist name..."
                className="bg-transparent border-b border-[#FFB800]/50 text-sm font-bold text-white px-1 py-0.5 outline-none w-full"
                autoFocus
              />
            ) : (
              <button onClick={() => setEditingName(true)}
                className="text-sm font-bold text-white hover:text-[#FFB800] transition-colors truncate">
                {name || "Untitled Watchlist"}
              </button>
            )}
          </div>
          <button onClick={onClose} className="p-1 text-zinc-500 hover:text-white transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-zinc-800/50">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
            <input
              ref={searchRef}
              value={searchQuery}
              onChange={e => handleSearchChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search ticker or type symbol..."
              className="w-full bg-zinc-900 border border-zinc-700/60 rounded-md text-sm text-white pl-8 pr-3 py-2 outline-none focus:border-[#FFB800]/50 transition-colors"
            />
            {searching && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 animate-spin" />}
          </div>

          {searchResults.length > 0 && (
            <div className="mt-1.5 border border-zinc-700/50 rounded-md bg-zinc-900/80 max-h-40 overflow-y-auto">
              {searchResults.map(r => {
                const alreadyAdded = symbols.includes(r.symbol.toUpperCase());
                return (
                  <button
                    key={r.symbol}
                    onClick={() => !alreadyAdded && handleAddSymbol(r.symbol)}
                    disabled={alreadyAdded}
                    className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm transition-colors ${
                      alreadyAdded ? "opacity-40 cursor-default" : "hover:bg-zinc-800"
                    }`}
                  >
                    <span className="font-mono font-bold text-white w-16 shrink-0">{r.symbol}</span>
                    <span className="text-zinc-500 truncate text-xs">{r.name}</span>
                    {alreadyAdded ? (
                      <Check className="w-3 h-3 text-green-500 ml-auto shrink-0" />
                    ) : (
                      <Plus className="w-3 h-3 text-zinc-600 ml-auto shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-4 py-2 max-h-64 overflow-y-auto">
          <div className="text-[11px] font-bold uppercase tracking-widest text-zinc-600 mb-2">
            Symbols ({symbols.length})
          </div>
          {symbols.length === 0 ? (
            <div className="text-center py-6 text-xs text-zinc-600">
              Search and add tickers above
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {symbols.map(sym => (
                <div key={sym}
                  className="flex items-center gap-1 bg-zinc-800/80 border border-zinc-700/50 rounded px-2 py-1 text-xs font-mono text-zinc-300 group hover:border-zinc-600 transition-colors">
                  <span className="font-bold">{sym}</span>
                  <button
                    onClick={() => handleRemoveSymbol(sym)}
                    className="text-zinc-600 hover:text-red-400 transition-colors"
                    title="Remove">
                    {removingSymbol === sym ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="px-4 py-2 text-xs text-red-400 bg-red-400/5 border-t border-red-400/20">
            {error}
          </div>
        )}
        <div className="px-4 py-3 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button onClick={onClose}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-zinc-400 hover:text-white border border-zinc-700/50 hover:border-zinc-600 transition-colors">
            Cancel
          </button>
          <button onClick={handleSave}
            disabled={saving || !name.trim()}
            className="px-4 py-1.5 rounded-md text-xs font-bold bg-[#FFB800] text-black hover:bg-[#FFB800]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            {isNew ? "Create" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
