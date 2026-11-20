import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";
import { useTerminalStore } from "@/lib/store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useBottomInputDock } from "@/hooks/useVisualViewportKeyboardInset";

/**
 * Phone ticker search.
 *
 * The magnifier stays on the screen edge and ignores swipes, the way a
 * Thinkorswim hover control stays out of the chain. A tap opens the keyboard
 * with a short ticker card pinned above it — the page underneath stays visible
 * because choosing a symbol only changes the ticker on the current screen.
 * No recent list. Desktop keeps the header search field.
 */

const TAP_SLOP_PX = 12;
const RESULT_LIMIT = 4;

type TickerHit = { symbol: string; name: string };

type MobileEdgeSearchProps = {
  onOpenChange?: (open: boolean) => void;
};

function normalizeHits(raw: unknown): TickerHit[] {
  if (!Array.isArray(raw)) return [];
  const out: TickerHit[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { symbol?: unknown; name?: unknown; description?: unknown };
    const symbol = typeof rec.symbol === "string" ? rec.symbol.trim().toUpperCase() : "";
    if (!symbol) continue;
    const nameRaw = typeof rec.name === "string"
      ? rec.name
      : typeof rec.description === "string"
        ? rec.description
        : "";
    const name = nameRaw.trim();
    out.push({ symbol, name: name.toUpperCase() === symbol ? "" : name });
  }
  return out.slice(0, RESULT_LIMIT);
}

async function enrichMissingNames(hits: TickerHit[], signal: AbortSignal): Promise<TickerHit[]> {
  const targets = hits.filter((hit) => !hit.name).slice(0, RESULT_LIMIT);
  if (targets.length === 0 || signal.aborted) return hits;
  const named = await Promise.all(targets.map(async (hit) => {
    try {
      const res = await fetchWithAuth(
        `/api/market/fundamentals?symbol=${encodeURIComponent(hit.symbol)}`,
        { signal },
      );
      const body = await res.json() as { description?: unknown; error?: string };
      if (body.error) return hit;
      const name = typeof body.description === "string" ? body.description.trim() : "";
      if (!name || name.toUpperCase() === hit.symbol) return hit;
      return { ...hit, name };
    } catch {
      return hit;
    }
  }));
  if (signal.aborted) return hits;
  const names = new Map(named.map((hit) => [hit.symbol, hit.name]));
  return hits.map((hit) => ({ ...hit, name: hit.name || names.get(hit.symbol) || "" }));
}

async function searchTickers(q: string, signal: AbortSignal): Promise<TickerHit[]> {
  let hits: TickerHit[] = [];
  let schwabAnswered = false;
  try {
    const res = await fetchWithAuth(
      `/api/market/symbol-search?q=${encodeURIComponent(q)}&limit=${RESULT_LIMIT}`,
      { signal },
    );
    const data = await res.json() as { results?: unknown; error?: string };
    if (signal.aborted) return [];
    if (res.ok && !data.error) {
      schwabAnswered = true;
      hits = normalizeHits(data.results);
    }
  } catch {
    if (signal.aborted) return [];
  }

  if (!schwabAnswered || hits.length === 0) {
    try {
      const res = await fetchWithAuth(
        `/api/scanner/search?q=${encodeURIComponent(q)}&limit=${RESULT_LIMIT}`,
        { signal },
      );
      const data = await res.json() as { results?: unknown };
      if (signal.aborted) return [];
      const scanned = normalizeHits(data.results);
      if (scanned.length > 0) hits = scanned;
    } catch {
      if (signal.aborted) return [];
    }
  }

  return signal.aborted ? [] : hits;
}

function symbolsMatch(hitSymbol: string, typed: string): boolean {
  if (hitSymbol === typed) return true;
  return hitSymbol.replace(/^\$/, "") === typed.replace(/^\$/, "");
}

export function MobileEdgeSearch({ onOpenChange }: MobileEdgeSearchProps) {
  const setSymbol = useTerminalStore((s) => s.setSymbol);
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [hits, setHits] = useState<TickerHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const slidRef = useRef(false);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  const { dockBottomPx, remeasure } = useBottomInputDock(open, focused, 72, 0);
  const keyboardOpen = open && dockBottomPx >= 48;
  const typed = inputVal.trim().toUpperCase();
  const rows = !open || !typed ? [] : hits.length > 0 ? hits : [{ symbol: typed, name: "" }];

  useEffect(() => {
    onOpenChangeRef.current?.(open);
  }, [open]);

  useEffect(() => {
    const input = inputRef.current;
    return () => input?.blur();
  }, []);

  useEffect(() => {
    if (open) return;
    setInputVal("");
    setHits([]);
    setSearching(false);
    setFocused(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const query = inputVal.trim().toUpperCase();
    if (!query) {
      setSearching(false);
      setHits([]);
      return;
    }
    const ac = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        const next = await searchTickers(query, ac.signal);
        if (ac.signal.aborted) return;
        setHits(next);
        setSearching(false);
        if (!next.some((hit) => !hit.name)) return;
        const named = await enrichMissingNames(next, ac.signal);
        if (ac.signal.aborted) return;
        setHits(named);
      })();
    }, 160);
    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [open, inputVal]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      inputRef.current?.blur();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const openSearch = () => {
    // The input has to be on screen before focus(), still inside this tap,
    // or iOS will not open the keyboard.
    flushSync(() => {
      setInputVal("");
      setHits([]);
      setOpen(true);
    });
    inputRef.current?.focus({ preventScroll: true });
    remeasure();
  };

  const close = () => {
    inputRef.current?.blur();
    setOpen(false);
  };

  const commit = (symbol: string) => {
    const next = symbol.trim().toUpperCase();
    if (!next) return;
    setSymbol(next);
    inputRef.current?.blur();
    setOpen(false);
  };

  const commitTyped = () => {
    if (!typed) return;
    const exact = hits.find((hit) => symbolsMatch(hit.symbol, typed));
    commit(exact?.symbol ?? typed);
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      {!open && (
        <button
          type="button"
          data-edge-search
          aria-label="Search ticker"
          className="fixed z-[70] flex items-center justify-center rounded-full"
          style={{
            top: "calc(var(--vv-top, 0px) + (var(--vvh, 100dvh) * 0.36))",
            right: "max(6px, env(safe-area-inset-right, 0px))",
            width: 46,
            height: 46,
            color: pressed ? "rgba(255,255,255,0.96)" : "rgba(255,255,255,0.8)",
            background: pressed ? "rgba(22, 22, 24, 0.78)" : "rgba(22, 22, 24, 0.32)",
            border: "1px solid rgba(255,255,255,0.2)",
            boxShadow: "0 4px 18px rgba(0,0,0,0.28)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            touchAction: "manipulation",
            WebkitTapHighlightColor: "transparent",
            WebkitTouchCallout: "none",
            userSelect: "none",
          }}
          onPointerDown={(e) => {
            if (e.pointerType === "mouse" && e.button !== 0) return;
            startRef.current = { x: e.clientX, y: e.clientY };
            slidRef.current = false;
            setPressed(true);
          }}
          onPointerMove={(e) => {
            const start = startRef.current;
            if (!start) return;
            const dx = e.clientX - start.x;
            const dy = e.clientY - start.y;
            if (dx * dx + dy * dy > TAP_SLOP_PX * TAP_SLOP_PX) {
              slidRef.current = true;
              setPressed(false);
            }
          }}
          onPointerUp={() => {
            startRef.current = null;
            setPressed(false);
          }}
          onPointerCancel={() => {
            startRef.current = null;
            slidRef.current = true;
            setPressed(false);
          }}
          onClick={(e) => {
            if (slidRef.current) {
              e.preventDefault();
              slidRef.current = false;
              return;
            }
            openSearch();
          }}
        >
          <Search size={22} strokeWidth={2.25} />
        </button>
      )}

      {open && (
        <div
          data-edge-search-backdrop
          className="fixed inset-0 z-[10055]"
          style={{ background: "transparent" }}
          onPointerDown={(e) => {
            e.preventDefault();
            close();
          }}
        />
      )}

      <div
        data-edge-search-dock
        className="fixed z-[10060]"
        style={{
          left: 8,
          right: 8,
          bottom: !open ? -720 : keyboardOpen ? dockBottomPx + 4 : 0,
          opacity: open ? 1 : 0,
          paddingBottom: !open || keyboardOpen ? 8 : "max(10px, env(safe-area-inset-bottom, 0px))",
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            commitTyped();
          }}
          className="overflow-hidden rounded-2xl border border-white/10 bg-[#121214] shadow-[0_10px_40px_rgba(0,0,0,0.55)]"
        >
          {rows.length > 0 && (
            <ul aria-label="Matching tickers">
              {rows.map((hit) => {
                const exact = symbolsMatch(hit.symbol, typed);
                return (
                  <li key={hit.symbol} className="border-b border-white/[0.06] last:border-b-0">
                    <button
                      type="button"
                      className="flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2 text-left active:opacity-70"
                      style={{ background: exact ? "rgba(255,184,0,0.08)" : "transparent" }}
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => commit(hit.symbol)}
                    >
                      <span className="shrink-0 font-mono text-[15px] font-bold tracking-wide text-white">
                        {hit.symbol}
                      </span>
                      {hit.name ? (
                        <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-bold tracking-wide text-[#FFB800]">
                          {hit.name.toUpperCase()}
                        </span>
                      ) : searching ? (
                        <span className="font-mono text-[12px] text-zinc-500">…</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className={`flex items-center gap-2 px-3 ${rows.length > 0 ? "border-t border-white/[0.08]" : ""}`}>
            <Search className="h-4 w-4 shrink-0 text-zinc-500" />
            <input
              ref={inputRef}
              value={inputVal}
              tabIndex={open ? 0 : -1}
              onChange={(e) => {
                setInputVal(e.target.value.toUpperCase());
                setHits([]);
              }}
              onFocus={() => {
                setFocused(true);
                remeasure();
                window.setTimeout(remeasure, 280);
              }}
              onBlur={() => {
                setFocused(false);
                remeasure();
              }}
              placeholder="Ticker"
              enterKeyHint="go"
              aria-label="Ticker symbol"
              className="h-12 min-w-0 flex-1 bg-transparent font-mono text-[16px] uppercase text-white outline-none placeholder:text-zinc-500 placeholder:normal-case"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              spellCheck={false}
            />
            {typed ? (
              <button
                type="button"
                aria-label="Clear ticker"
                className="flex h-8 w-8 shrink-0 items-center justify-center text-zinc-400"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => {
                  setInputVal("");
                  setHits([]);
                  inputRef.current?.focus({ preventScroll: true });
                }}
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </>,
    document.body,
  );
}
