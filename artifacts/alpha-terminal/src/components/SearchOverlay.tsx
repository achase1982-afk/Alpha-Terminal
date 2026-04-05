import { useState, useRef, useEffect, useCallback } from "react";
import { useTerminalStore, useActiveWatchlist } from "@/lib/store";
import { useQuote } from "@/hooks/useQuote";
import { Search, FileText, PlusCircle, MinusCircle } from "lucide-react";

function fmtPrice(v: number | null): string {
  if (v == null) return "—";
  return v >= 1000 ? v.toFixed(0) : v.toFixed(2);
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function changeColor(v: number | null): string {
  if (v == null) return "#71717a";
  if (v > 0) return "#26a69a";
  if (v < 0) return "#f23645";
  return "#71717a";
}

function WatchlistIcon({ isInWatchlist, flash }: { isInWatchlist: boolean; flash: boolean }) {
  const BadgeIcon = isInWatchlist ? MinusCircle : PlusCircle;
  const color = isInWatchlist ? "#f23645" : "#5b9cf6";
  return (
    <div
      className={`relative shrink-0 transition-transform duration-200 ${flash ? "scale-110" : ""}`}
      style={{ width: 28, height: 32 }}
    >
      <FileText
        style={{ color, position: "absolute", top: 0, left: 0 }}
        strokeWidth={1.5}
        size={26}
      />
      <BadgeIcon
        style={{
          color,
          position: "absolute",
          bottom: 0,
          right: -4,
          background: "#0c0c0c",
          borderRadius: "50%",
        }}
        strokeWidth={2}
        size={13}
      />
    </div>
  );
}

function SymbolLivePreview({ sym }: { sym: string }) {
  const { data } = useQuote(sym);
  if (!data?.description) return null;
  return (
    <div className="mx-4 mb-2 px-3 py-2 rounded-lg flex items-center gap-2" style={{ background: "#18181B", border: "1px solid #2A2A2C" }}>
      <span className="font-mono text-[14px] font-bold text-white tracking-wide shrink-0">{sym}</span>
      <span className="font-mono text-[12px] font-bold text-[#FFB800] tracking-wide truncate">
        {data.description.toUpperCase()}
      </span>
    </div>
  );
}

function RecentRow({
  sym,
  isActive,
  onTap,
}: {
  sym: string;
  isActive: boolean;
  onTap: () => void;
}) {
  const { data: quoteData } = useQuote(sym);
  const { addToWatchlist, removeFromWatchlist } = useTerminalStore();
  const watchlistSymbols = useActiveWatchlist();
  const isInWatchlist = watchlistSymbols.includes(sym.toUpperCase());
  const [flash, setFlash] = useState(false);

  const handleWatchlistToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isInWatchlist) {
      removeFromWatchlist(sym);
    } else {
      addToWatchlist(sym);
    }
    setFlash(true);
    setTimeout(() => setFlash(false), 400);
  }, [sym, isInWatchlist, addToWatchlist, removeFromWatchlist]);

  const cColor = changeColor(quoteData?.changePct ?? null);

  return (
    <div
      className="flex items-center px-4 py-1.5 gap-3"
      style={{ borderBottom: "1px solid #1a1a1c" }}
    >
      <div
        onClick={onTap}
        className="flex flex-col min-w-0 flex-1 cursor-pointer active:opacity-70 transition-opacity"
      >
        <span
          className="font-mono text-[16px] font-bold tracking-wide"
          style={{ color: "#ffffff" }}
        >
          {sym}
        </span>
        {quoteData?.description && (
          <span className="font-mono text-[13px] font-bold tracking-wide truncate mt-0.5" style={{ color: "#FFB800" }}>
            {quoteData.description.toUpperCase()}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <div className="flex flex-col items-end w-[80px] shrink-0">
          <span
            className="font-mono text-[14px] font-bold tabular-nums"
            style={{ color: quoteData?.last != null ? "#ffffff" : "#52525b" }}
          >
            {fmtPrice(quoteData?.last ?? null)}
          </span>
          <span
            className="font-mono text-[11px] tabular-nums"
            style={{ color: cColor }}
          >
            {fmtPct(quoteData?.changePct ?? null)}
          </span>
        </div>

        <div
          onClick={handleWatchlistToggle}
          className="cursor-pointer active:scale-90 transition-transform"
          role="button"
          aria-label={isInWatchlist ? "Remove from watchlist" : "Add to watchlist"}
        >
          <WatchlistIcon isInWatchlist={isInWatchlist} flash={flash} />
        </div>
      </div>
    </div>
  );
}

interface SearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSymbol: (sym: string) => void;
}

export function SearchOverlay({ isOpen, onClose, onSelectSymbol }: SearchOverlayProps) {
  const { symbol, setSymbol, recentSymbols } = useTerminalStore();
  const [inputVal, setInputVal] = useState("");
  const [debouncedVal, setDebouncedVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setInputVal("");
      setDebouncedVal("");
      setTimeout(() => inputRef.current?.focus(), 350);
    }
  }, [isOpen]);

  useEffect(() => {
    const trimmed = inputVal.trim().toUpperCase();
    if (!trimmed) { setDebouncedVal(""); return; }
    const t = setTimeout(() => setDebouncedVal(trimmed), 300);
    return () => clearTimeout(t);
  }, [inputVal]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputVal.trim().toUpperCase();
    if (trimmed) {
      inputRef.current?.blur();
      setSymbol(trimmed);
      setInputVal("");
      setDebouncedVal("");
      onSelectSymbol(trimmed);
    }
  };

  const handleQuickSelect = (sym: string) => {
    const clean = sym.replace(/^\$/, "");
    inputRef.current?.blur();
    setSymbol(clean);
    onSelectSymbol(clean);
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

        <div className="px-4 pt-4 pb-2">
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
          </form>
        </div>

        {debouncedVal && <SymbolLivePreview sym={debouncedVal} />}

        <div className="flex-1 overflow-y-auto pb-8">
          {recentSymbols.length > 0 && (
            <div>
              <div className="flex items-center justify-between px-4 pb-2">
                <span className="font-mono text-[13px] text-zinc-400 uppercase tracking-widest font-bold">
                  RECENTLY VIEWED
                </span>
                <span className="font-mono text-[13px] text-zinc-400 uppercase tracking-widest font-bold">
                  WATCHLIST
                </span>
              </div>
              {recentSymbols.map(sym => {
                const clean = cleanSymbol(sym);
                return (
                  <RecentRow
                    key={clean}
                    sym={clean}
                    isActive={symbol === clean}
                    onTap={() => handleQuickSelect(sym)}
                  />
                );
              })}
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
