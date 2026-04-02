import { useState, useRef, useEffect } from "react";
import { useTerminalStore } from "@/lib/store";
import { Search, Plus } from "lucide-react";

interface SearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSymbol: (sym: string) => void;
}

export function SearchOverlay({ isOpen, onClose, onSelectSymbol }: SearchOverlayProps) {
  const { symbol, setSymbol, recentSymbols, addToWatchlist } = useTerminalStore();
  const [inputVal, setInputVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setInputVal("");
      setTimeout(() => inputRef.current?.focus(), 350);
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputVal.trim().toUpperCase();
    if (trimmed) {
      inputRef.current?.blur();
      setSymbol(trimmed);
      setInputVal("");
      onSelectSymbol(trimmed);
    }
  };

  const handleQuickSelect = (sym: string) => {
    const clean = sym.replace(/^\$/, "");
    inputRef.current?.blur();
    setSymbol(clean);
    onSelectSymbol(clean);
  };

  const handleAddToWatchlist = () => {
    const trimmed = inputVal.trim().toUpperCase();
    const target = trimmed || symbol;
    if (target) {
      addToWatchlist(target);
    }
  };

  const cleanSymbol = (sym: string) => sym.replace(/^\$/, "");

  return (
    <>
      <div
        className="fixed inset-0 z-[900] bg-black/60 transition-opacity duration-300"
        style={{
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? "auto" : "none",
        }}
        onClick={onClose}
      />

      <div
        className="fixed left-0 right-0 bottom-0 z-[901] flex flex-col transition-transform duration-300 ease-out"
        style={{
          top: 0,
          transform: isOpen ? "translateY(0)" : "translateY(100%)",
          background: "#0c0c0c",
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-3 border-b shrink-0"
          style={{ borderColor: "#2A2A2C", background: "#111113" }}
        >
          <span className="font-mono text-sm font-bold tracking-wider text-[#FFB800]">
            SEARCH
          </span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors font-mono text-xs text-zinc-400 tracking-wider"
            aria-label="Close search"
          >
            CLOSE
          </button>
        </div>

        <div className="px-4 pt-4 pb-3">
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                ref={inputRef}
                value={inputVal}
                onChange={e => setInputVal(e.target.value.toUpperCase())}
                placeholder="TICKER SYMBOL..."
                className="w-full h-10 pl-10 pr-3 rounded-lg border border-[#2A2A2C] bg-[#18181B] font-mono text-sm text-foreground
                  placeholder:text-muted-foreground/40 focus:outline-none focus:border-[#FFB800]/50 transition-colors uppercase"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
              />
            </div>
            <button
              type="submit"
              className="h-10 px-5 rounded-lg font-mono text-xs font-bold tracking-wider transition-colors shrink-0"
              style={{ background: "#FFB800", color: "#0c0c0c" }}
            >
              GO
            </button>
            <button
              type="button"
              onClick={handleAddToWatchlist}
              className="h-10 w-10 rounded-lg bg-[#18181B] border border-[#2A2A2C] text-white flex items-center justify-center hover:bg-[#27272A] transition-colors shrink-0"
              aria-label="Save to watchlist"
              title="Save to watchlist"
            >
              <Plus className="w-4 h-4" />
            </button>
          </form>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-8">
          {recentSymbols.length > 0 && (
            <div className="mb-4">
              <span className="font-mono text-[10px] text-[#71717a] uppercase tracking-widest font-medium block mb-2">
                RECENTLY VIEWED
              </span>
              <div className="flex flex-wrap gap-2">
                {recentSymbols.map(sym => (
                  <button
                    key={sym}
                    onClick={() => handleQuickSelect(sym)}
                    className={`font-mono text-xs px-3 py-1.5 rounded-lg border transition-all duration-150
                      ${symbol === cleanSymbol(sym)
                        ? "text-[#FFB800] border-[#FFB800]/30"
                        : "bg-[#18181B] text-zinc-400 border-[#2A2A2C] hover:border-[#404040] hover:text-foreground"
                      }`}
                  >
                    {cleanSymbol(sym)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {recentSymbols.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Search className="w-10 h-10 text-zinc-700 mb-3" />
              <p className="font-mono text-xs text-zinc-500 tracking-wider">
                TYPE A TICKER SYMBOL TO GET STARTED
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
