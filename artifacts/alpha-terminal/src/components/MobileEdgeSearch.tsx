import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { flushSync } from "react-dom";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";
import { useTerminalStore } from "@/lib/store";
import { useUICustomizationStore } from "@/lib/ui-customization-store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  installPwaKeyboardSession,
  isUserKeyboardSession,
  noteKeyboardGesture,
  subscribeKeyboardDismiss,
} from "@/hooks/pwaKeyboardSession";
import { useBottomInputDock } from "@/hooks/useVisualViewportKeyboardInset";

/**
 * Phone ticker search.
 *
 * A tap opens the keyboard with a short ticker card pinned above it. The page
 * underneath stays visible because choosing a symbol only changes the ticker
 * on the current screen. Press and hold to jiggle the magnifier, drag it, then
 * tap the screen to lock that spot. A swipe still scrolls the page underneath.
 * No recent list. Desktop keeps the header search field.
 */

const TAP_SLOP_PX = 16;
const HOLD_MS = 500;
const BUTTON_PX = 46;
const RESULT_LIMIT = 4;
const POS_KEY = "alphaTerminalEdgeSearchPos";

type Anchor = { x: number; y: number };

const DEFAULT_ANCHOR: Anchor = { x: 1, y: 0.36 };

type Gesture = {
  pointerId: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  lastT: number;
  vx: number;
  vy: number;
  moved: boolean;
  startedLoose: boolean;
  grabX: number;
  grabY: number;
};

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

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function loadAnchor(): Anchor {
  if (typeof localStorage === "undefined") return DEFAULT_ANCHOR;
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return DEFAULT_ANCHOR;
    const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return DEFAULT_ANCHOR;
    return { x: clamp01(parsed.x), y: clamp01(parsed.y) };
  } catch {
    return DEFAULT_ANCHOR;
  }
}

function saveAnchor(anchor: Anchor) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify({ x: anchor.x, y: anchor.y }));
  } catch {
    /* private mode */
  }
}

function anchorFromPoint(clientX: number, clientY: number, grabX: number, grabY: number): Anchor {
  const vv = window.visualViewport;
  const left = vv?.offsetLeft ?? 0;
  const top = vv?.offsetTop ?? 0;
  const width = vv?.width ?? window.innerWidth;
  const height = vv?.height ?? window.innerHeight;
  const travelX = Math.max(1, width - BUTTON_PX);
  const travelY = Math.max(1, height - BUTTON_PX);
  return {
    x: clamp01((clientX - grabX - left) / travelX),
    y: clamp01((clientY - grabY - top) / travelY),
  };
}

function canScroll(overflow: string): boolean {
  return overflow === "auto" || overflow === "scroll" || overflow === "overlay";
}

/** A swipe that starts on the magnifier still scrolls whatever is underneath. */
function scrollUnder(clientX: number, clientY: number, dx: number, dy: number, skip: HTMLElement | null): { x: boolean; y: boolean } {
  const moved = { x: false, y: false };
  if (skip) skip.style.pointerEvents = "none";
  let hit: Element | null = null;
  try {
    hit = document.elementFromPoint(clientX, clientY);
  } finally {
    if (skip) skip.style.pointerEvents = "";
  }
  let el: Element | null = hit;
  let xDone = dx === 0;
  let yDone = dy === 0;
  while (el && el !== document.body && el !== document.documentElement && (!xDone || !yDone)) {
    if (el instanceof HTMLElement) {
      const style = window.getComputedStyle(el);
      if (!yDone && canScroll(style.overflowY) && el.scrollHeight > el.clientHeight + 1) {
        const before = el.scrollTop;
        const max = el.scrollHeight - el.clientHeight;
        const next = Math.min(max, Math.max(0, before - dy));
        if (next !== before) {
          el.scrollTop = next;
          dy -= before - next;
          moved.y = true;
        }
        if (Math.abs(dy) < 0.5) yDone = true;
      }
      if (!xDone && canScroll(style.overflowX) && el.scrollWidth > el.clientWidth + 1) {
        const before = el.scrollLeft;
        const max = el.scrollWidth - el.clientWidth;
        const next = Math.min(max, Math.max(0, before - dx));
        if (next !== before) {
          el.scrollLeft = next;
          dx -= before - next;
          moved.x = true;
        }
        if (Math.abs(dx) < 0.5) xDone = true;
      }
    }
    el = el.parentElement;
  }
  return moved;
}

export function MobileEdgeSearch({ onOpenChange }: MobileEdgeSearchProps) {
  const setSymbol = useTerminalStore((s) => s.setSymbol);
  const haptic = useUICustomizationStore((s) => s.hapticFeedback);
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [hits, setHits] = useState<TickerHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [anchor, setAnchor] = useState<Anchor>(loadAnchor);
  const [jiggling, setJiggling] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const anchorRef = useRef(anchor);
  const jigglingRef = useRef(false);
  const gestureRef = useRef<Gesture | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const flingRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  anchorRef.current = anchor;

  const { dockBottomPx, remeasure } = useBottomInputDock(open, focused, 72, 0);
  const keyboardUp = open && isUserKeyboardSession() && (focused || dockBottomPx >= 48);
  const typed = inputVal.trim().toUpperCase();
  const rows = !open || !typed ? [] : hits.length > 0 ? hits : [{ symbol: typed, name: "" }];

  useEffect(() => {
    onOpenChangeRef.current?.(open);
  }, [open]);

  useEffect(() => {
    installPwaKeyboardSession();
    return subscribeKeyboardDismiss(() => {
      // App switch. Blur before unmounting so iOS releases the keyboard inset,
      // then drop the field so it is not restored focused on the next open.
      inputRef.current?.blur();
      flushSync(() => {
        setFocused(false);
        setOpen(false);
      });
    });
  }, []);

  useEffect(() => {
    return () => {
      inputRef.current?.blur();
      if (holdTimerRef.current != null) window.clearTimeout(holdTimerRef.current);
      if (flingRef.current != null) cancelAnimationFrame(flingRef.current);
    };
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

  const clearHold = () => {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const stopFling = () => {
    if (flingRef.current != null) {
      cancelAnimationFrame(flingRef.current);
      flingRef.current = null;
    }
  };

  const startFling = (vx: number, vy: number, x: number, y: number) => {
    stopFling();
    if (Math.hypot(vx, vy) < 0.35) return;
    let velX = vx;
    let velY = vy;
    let prev = performance.now();
    const step = (now: number) => {
      const dt = Math.min(32, now - prev);
      prev = now;
      const moved = scrollUnder(x, y, velX * dt, velY * dt, buttonRef.current);
      const decay = Math.pow(0.94, dt / 16);
      velX = moved.x ? velX * decay : 0;
      velY = moved.y ? velY * decay : 0;
      if (Math.hypot(velX, velY) < 0.02) {
        flingRef.current = null;
        return;
      }
      flingRef.current = requestAnimationFrame(step);
    };
    flingRef.current = requestAnimationFrame(step);
  };

  const lockPlacement = () => {
    clearHold();
    jigglingRef.current = false;
    setJiggling(false);
    setDragging(false);
    saveAnchor(anchorRef.current);
  };

  const beginJiggle = () => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.moved || jigglingRef.current) return;
    jigglingRef.current = true;
    suppressClickRef.current = true;
    stopFling();
    setJiggling(true);
    setPressed(false);
    if (haptic && navigator.vibrate) navigator.vibrate(18);
  };

  const openSearch = () => {
    lockPlacement();
    // The input has to be on screen before focus(), still inside this tap,
    // or iOS will not open the keyboard. noteKeyboardGesture marks that tap so
    // a resume from another app — which also focuses fields, with no tap —
    // is not treated as typing.
    noteKeyboardGesture();
    flushSync(() => {
      setInputVal("");
      setHits([]);
      setOpen(true);
    });
    inputRef.current?.focus({ preventScroll: true });
    remeasure();
  };

  const onButtonPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    gestureRef.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      lastT: e.timeStamp || performance.now(),
      vx: 0,
      vy: 0,
      moved: false,
      startedLoose: jigglingRef.current,
      grabX: e.clientX - rect.left,
      grabY: e.clientY - rect.top,
    };
    suppressClickRef.current = false;
    stopFling();
    setPressed(true);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    clearHold();
    if (!jigglingRef.current) {
      holdTimerRef.current = window.setTimeout(beginJiggle, HOLD_MS);
    }
  };

  const onButtonPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    if (jigglingRef.current) {
      e.preventDefault();
      const dx = e.clientX - gesture.x;
      const dy = e.clientY - gesture.y;
      if (!gesture.moved && dx * dx + dy * dy <= 9) return;
      gesture.moved = true;
      setDragging(true);
      const next = anchorFromPoint(e.clientX, e.clientY, gesture.grabX, gesture.grabY);
      anchorRef.current = next;
      setAnchor(next);
      return;
    }
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;
    if (!gesture.moved && dx * dx + dy * dy > TAP_SLOP_PX * TAP_SLOP_PX) {
      gesture.moved = true;
      clearHold();
      setPressed(false);
      suppressClickRef.current = true;
      gesture.lastX = gesture.x;
      gesture.lastY = gesture.y;
      gesture.lastT = e.timeStamp || performance.now();
    }
    if (!gesture.moved) return;
    e.preventDefault();
    const now = e.timeStamp || performance.now();
    const dt = now - gesture.lastT;
    if (dt > 0 && dt < 80) {
      const instVx = (e.clientX - gesture.lastX) / dt;
      const instVy = (e.clientY - gesture.lastY) / dt;
      gesture.vx = gesture.vx * 0.35 + instVx * 0.65;
      gesture.vy = gesture.vy * 0.35 + instVy * 0.65;
    } else if (dt >= 80) {
      gesture.vx = 0;
      gesture.vy = 0;
    }
    const stepX = e.clientX - gesture.lastX;
    const stepY = e.clientY - gesture.lastY;
    gesture.lastX = e.clientX;
    gesture.lastY = e.clientY;
    gesture.lastT = now;
    scrollUnder(e.clientX, e.clientY, stepX, stepY, buttonRef.current);
  };

  const onButtonPointerEnd = (e: ReactPointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    clearHold();
    gestureRef.current = null;
    setPressed(false);
    setDragging(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (cancelled) {
      suppressClickRef.current = true;
      return;
    }
    if (jigglingRef.current) {
      saveAnchor(anchorRef.current);
      suppressClickRef.current = true;
      // Lifting after the hold leaves it loose. A later tap on the glass locks it,
      // the same as tapping the page.
      if (gesture.startedLoose && !gesture.moved) lockPlacement();
      return;
    }
    if (gesture.moved) {
      suppressClickRef.current = true;
      startFling(gesture.vx, gesture.vy, e.clientX, e.clientY);
      return;
    }
    // Open from the tap itself. A captured pointer does not always produce a click,
    // and this is still inside the gesture so iOS will show the keyboard.
    suppressClickRef.current = true;
    openSearch();
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
      <style>{`
        @keyframes edge-search-jiggle {
          0% { transform: rotate(-8deg); }
          50% { transform: rotate(8deg); }
          100% { transform: rotate(-8deg); }
        }
        .edge-search-jiggle {
          animation: edge-search-jiggle 0.28s linear infinite;
          transform-origin: center center;
        }
      `}</style>
      {jiggling && !open && (
        <div
          data-edge-search-lock
          className="fixed inset-0 z-[80]"
          style={{ background: "transparent", touchAction: "none" }}
          onPointerDown={(e) => {
            e.preventDefault();
            lockPlacement();
          }}
        />
      )}
      {!open && (
        <button
          ref={buttonRef}
          type="button"
          data-edge-search
          data-edge-search-unlocked={jiggling ? "true" : "false"}
          aria-label={jiggling ? "Drag the search button, then tap the screen to lock it" : "Search ticker"}
          className={`fixed flex items-center justify-center rounded-full ${jiggling && !dragging ? "edge-search-jiggle" : ""}`}
          style={{
            left: `calc(var(--vv-left, 0px) + ${anchor.x} * (var(--vvw, 100vw) - ${BUTTON_PX}px))`,
            top: `calc(var(--vv-top, 0px) + ${anchor.y} * (var(--vvh, 100lvh) - ${BUTTON_PX}px))`,
            width: BUTTON_PX,
            height: BUTTON_PX,
            zIndex: jiggling ? 90 : 70,
            color: "rgba(255,255,255,0.96)",
            background: jiggling ? "rgba(32, 32, 36, 0.86)" : pressed ? "rgba(22, 22, 24, 0.76)" : "rgba(22, 22, 24, 0.64)",
            border: jiggling ? "1px solid rgba(255,255,255,0.62)" : "1px solid rgba(255,255,255,0.42)",
            boxShadow: jiggling ? "0 8px 24px rgba(0,0,0,0.45)" : "0 4px 18px rgba(0,0,0,0.3)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            touchAction: "none",
            WebkitTapHighlightColor: "transparent",
            WebkitTouchCallout: "none",
            userSelect: "none",
          }}
          onPointerDown={onButtonPointerDown}
          onPointerMove={onButtonPointerMove}
          onPointerUp={(e) => onButtonPointerEnd(e, false)}
          onPointerCancel={(e) => onButtonPointerEnd(e, true)}
          onContextMenu={(e) => e.preventDefault()}
          onClick={(e) => {
            if (suppressClickRef.current || jigglingRef.current) {
              e.preventDefault();
              suppressClickRef.current = false;
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

      {open && (
      <div
        data-edge-search-dock
        className="fixed z-[10060]"
        style={{
          left: 8,
          right: 8,
          bottom: keyboardUp ? dockBottomPx : 0,
          paddingBottom: keyboardUp ? 0 : "max(10px, env(safe-area-inset-bottom, 0px))",
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
              tabIndex={0}
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
                  noteKeyboardGesture();
                  inputRef.current?.focus({ preventScroll: true });
                }}
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </form>
      </div>
      )}
    </>,
    document.body,
  );
}
