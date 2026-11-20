import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { useTerminalStore, useActiveWatchlist } from "@/lib/store";
import { useQuote } from "@/hooks/useQuote";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Search, FileText, PlusCircle, MinusCircle } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useSearchInputDock } from "@/hooks/useVisualViewportKeyboardInset";

function WatchlistIcon({ isInWatchlist, flash }: { isInWatchlist: boolean; flash: boolean }) {
  const BadgeIcon = isInWatchlist ? MinusCircle : PlusCircle;
  const color = "#ffffff";
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
          background: "hsl(var(--card))",
          borderRadius: "50%",
        }}
        strokeWidth={2}
        size={13}
      />
    </div>
  );
}

function SymbolLivePreview({
  sym,
  onNavigate,
  className = "",
}: {
  sym: string;
  onNavigate: () => void;
  className?: string;
}) {
  const exact = sym.trim().toUpperCase();
  const [lookup, setLookup] = useState(exact);
  const [instrumentName, setInstrumentName] = useState<{ symbol: string; name: string | null } | null>(null);
  const { data, restQuote } = useQuote(lookup === exact ? exact : "");
  const { addToWatchlist, removeFromWatchlist } = useTerminalStore(useShallow((s) => ({ addToWatchlist: s.addToWatchlist, removeFromWatchlist: s.removeFromWatchlist })));
  const watchlistSymbols = useActiveWatchlist();
  const isInWatchlist = watchlistSymbols.includes(exact);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setLookup(exact), 300);
    return () => clearTimeout(t);
  }, [exact]);

  const quoteForExact = lookup === exact && data?.symbol?.toUpperCase() === exact ? data : null;
  const quoteName = quoteForExact?.description?.trim() || "";
  const quoteSettled = lookup === exact && (data != null || restQuote != null);
  const quoteError = lookup === exact ? restQuote?.error : undefined;

  useEffect(() => {
    if (!exact || !quoteSettled || quoteName || quoteError) return;
    const requested = exact;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(`/api/market/fundamentals?symbol=${encodeURIComponent(requested)}`);
        const body = await res.json() as { symbol?: string; description?: string | null; error?: string };
        if (cancelled) return;
        const bodySymbol = (body.symbol ?? "").trim().toUpperCase();
        const name = typeof body.description === "string" ? body.description.trim() : "";
        if (body.error || bodySymbol !== requested || !name) {
          setInstrumentName({ symbol: requested, name: null });
          return;
        }
        setInstrumentName({ symbol: requested, name });
      } catch {
        if (!cancelled) setInstrumentName({ symbol: requested, name: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [exact, quoteSettled, quoteName, quoteError]);

  const handleWatchlistToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isInWatchlist) {
      removeFromWatchlist(exact);
    } else {
      addToWatchlist(exact);
    }
    setFlash(true);
    setTimeout(() => setFlash(false), 400);
  }, [exact, isInWatchlist, addToWatchlist, removeFromWatchlist]);

  if (!exact) return null;

  const description =
    quoteName ||
    (instrumentName?.symbol === exact ? instrumentName.name?.trim() || "" : "");

  return (
    <div
      className={`mx-4 mb-2 px-3 py-2 rounded-lg flex items-center gap-3 ${className}`}
      style={{ background: "#18181B", border: "1px solid #FFB800/30", borderColor: "rgba(255,184,0,0.25)" }}
    >
      <div
        onClick={onNavigate}
        className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer active:opacity-70 transition-opacity"
      >
        <span className="font-mono text-[15px] font-bold text-white tracking-wide shrink-0">{exact}</span>
        {description ? (
          <span className="font-mono text-[12px] font-bold text-[#FFB800] tracking-wide truncate">
            {description.toUpperCase()}
          </span>
        ) : null}
      </div>
      <div
        onClick={handleWatchlistToggle}
        className="cursor-pointer active:scale-90 transition-transform shrink-0"
        role="button"
        aria-label={isInWatchlist ? "Remove from watchlist" : "Add to watchlist"}
      >
        <WatchlistIcon isInWatchlist={isInWatchlist} flash={flash} />
      </div>
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
  const { addToWatchlist, removeFromWatchlist } = useTerminalStore(useShallow((s) => ({ addToWatchlist: s.addToWatchlist, removeFromWatchlist: s.removeFromWatchlist })));
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

      <div
        onClick={handleWatchlistToggle}
        className="cursor-pointer active:scale-90 transition-transform shrink-0"
        role="button"
        aria-label={isInWatchlist ? "Remove from watchlist" : "Add to watchlist"}
      >
        <WatchlistIcon isInWatchlist={isInWatchlist} flash={flash} />
      </div>
    </div>
  );
}

function SearchForm({
  inputRef,
  inputVal,
  setInputVal,
  onSubmit,
  onFocus,
  onBlur,
  className = "",
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  inputVal: string;
  setInputVal: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  className?: string;
}) {
  return (
    <form onSubmit={onSubmit} className={`flex items-center gap-2 ${className}`}>
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          value={inputVal}
          onChange={e => setInputVal(e.target.value.toUpperCase())}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder="TICKER SYMBOL..."
          enterKeyHint="go"
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
  );
}

interface SearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSymbol: (sym: string) => void;
}

/** Oldest → newest so the freshest ticker sits just above the thumb-zone search bar. */
function recentForBottomDock(recentSymbols: string[]): string[] {
  return [...recentSymbols]
    .map(s => s.replace(/^\$/, ""))
    .reverse();
}

export function SearchOverlay({ isOpen, onClose, onSelectSymbol }: SearchOverlayProps) {
  const { symbol, setSymbol, recentSymbols } = useTerminalStore(useShallow((s) => ({ symbol: s.symbol, setSymbol: s.setSymbol, recentSymbols: s.recentSymbols })));
  const [inputVal, setInputVal] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dockHeightPx, setDockHeightPx] = useState(72);
  const exactInput = inputVal.trim().toUpperCase();
  const narrowMobile = useMediaQuery("(max-width: 767px)");
  const mobileSearchDockActive = narrowMobile && isOpen;
  const { dockBottomPx, scrollPaddingBottomPx, remeasure } = useSearchInputDock(
    mobileSearchDockActive,
    inputFocused,
    dockHeightPx,
  );
  const listPinnedToBottomRef = useRef(true);

  useEffect(() => {
    if (isOpen) {
      setInputVal("");
      setInputFocused(false);
      listPinnedToBottomRef.current = true;
      remeasure();
      const t = window.setTimeout(() => {
        inputRef.current?.focus();
        remeasure();
      }, 350);
      return () => window.clearTimeout(t);
    }
    setInputFocused(false);
    return undefined;
  }, [isOpen, remeasure]);

  useLayoutEffect(() => {
    if (!narrowMobile || !isOpen) return;
    const el = dockRef.current;
    if (!el) return;
    const measure = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h > 0) setDockHeightPx(h);
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [narrowMobile, isOpen, exactInput]);

  const scrollListToEnd = useCallback((force = false) => {
    const el = scrollRef.current;
    if (!el) return;
    if (!force && !listPinnedToBottomRef.current) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, []);

  const handleRecentListScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    listPinnedToBottomRef.current = distanceFromBottom <= 96;
  }, []);

  useEffect(() => {
    if (isOpen && narrowMobile) scrollListToEnd(true);
  }, [isOpen, narrowMobile, scrollListToEnd]);

  useEffect(() => {
    if (!isOpen || !narrowMobile) return;
    scrollListToEnd();
  }, [scrollPaddingBottomPx, dockHeightPx, isOpen, narrowMobile, scrollListToEnd]);

  // Esc closes the overlay (it opens via Cmd/Ctrl+K on desktop, so it must
  // also close from the keyboard — otherwise the full-screen sheet keeps
  // swallowing every click with no obvious way out).
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

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

  const navigateFromPreview = () => {
    inputRef.current?.blur();
    setSymbol(exactInput);
    setInputVal("");
    onSelectSymbol(exactInput);
  };

  const recentBottomOrder = recentForBottomDock(recentSymbols);

  const keyboardOpen = narrowMobile && dockBottomPx >= 48;

  const recentListBody = (
    <>
      {recentSymbols.length > 0 ? (
        <div className={narrowMobile ? "pb-1" : ""}>
          <div className="flex items-center justify-between px-4 pb-2">
            <span className="font-mono text-[13px] text-zinc-400 uppercase tracking-widest font-bold">
              RECENTLY VIEWED
            </span>
          </div>
          {(narrowMobile ? recentBottomOrder : recentSymbols.map(s => s.replace(/^\$/, ""))).map(sym => (
            <RecentRow
              key={sym}
              sym={sym}
              isActive={symbol === sym}
              onTap={() => handleQuickSelect(sym)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Search className="w-10 h-10 text-zinc-700 mb-3" />
          <p className="font-mono text-xs text-zinc-500 tracking-wider">
            TYPE A TICKER SYMBOL TO GET STARTED
          </p>
        </div>
      )}
    </>
  );

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
        className="fixed left-0 right-0 bottom-0 z-[901] flex flex-col bg-card transition-transform duration-300 ease-out"
        style={{
          top: 0,
          transform: isOpen ? "translateY(0)" : "translateY(100%)",
          // Belt and braces: while closed (or mid-close animation) the sheet
          // must never intercept taps meant for the app underneath.
          pointerEvents: isOpen ? "auto" : "none",
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-3 border-b border-card-border bg-card shrink-0"
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

        {narrowMobile ? (
          <>
            <div
              ref={scrollRef}
              className="flex-1 min-h-0 overflow-y-auto flex flex-col"
              onScroll={handleRecentListScroll}
              style={{
                paddingBottom: scrollPaddingBottomPx,
                WebkitOverflowScrolling: "touch",
              }}
            >
              <div className="mt-auto w-full">
                {recentListBody}
              </div>
            </div>

            <div
              ref={dockRef}
              className="fixed left-0 right-0 z-[902] bg-card border-t border-card-border px-4 pt-3 pb-3"
              style={{
                bottom: dockBottomPx,
                paddingBottom: keyboardOpen
                  ? 10
                  : "max(12px, env(safe-area-inset-bottom, 0px))",
              }}
            >
              {exactInput ? (
                <SymbolLivePreview
                  sym={exactInput}
                  onNavigate={navigateFromPreview}
                  className="mx-0"
                />
              ) : null}
              <SearchForm
                inputRef={inputRef}
                inputVal={inputVal}
                setInputVal={setInputVal}
                onSubmit={handleSubmit}
                onFocus={() => {
                  setInputFocused(true);
                  remeasure();
                }}
                onBlur={() => {
                  setInputFocused(false);
                  remeasure();
                }}
              />
            </div>
          </>
        ) : (
          <>
            <div className="px-4 pt-4 pb-2">
              <SearchForm
                inputRef={inputRef}
                inputVal={inputVal}
                setInputVal={setInputVal}
                onSubmit={handleSubmit}
              />
            </div>

            {exactInput && (
              <SymbolLivePreview
                sym={exactInput}
                onNavigate={navigateFromPreview}
              />
            )}

            <div className="flex-1 overflow-y-auto pb-8">
              {recentListBody}
            </div>
          </>
        )}
      </div>
    </>
  );
}