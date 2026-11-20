import { useEffect, useRef, useState } from "react";
import { DOWN, UP, WHITE } from "@/components/options/optionsTheme";

const HOLD_MS = 300;
const REF_MS = 1500;
const MAX_TICKS = 32;

type Sample = { t: number; p: number };

export function pickSpotColor(
  last: number | null,
  reference: number | null,
  hold: "up" | "down" | "flat",
): string {
  if (last == null || !Number.isFinite(last)) return WHITE;
  if (reference == null || !Number.isFinite(reference)) return WHITE;
  const eps = Math.max(0.01, Math.abs(last) * 1e-6);
  if (Math.abs(last - reference) <= eps) return WHITE;
  if (hold === "up") return UP;
  if (hold === "down") return DOWN;
  return WHITE;
}

export function useSpotDirectionColor(price: number | null | undefined, throttleMs = 250): string {
  const ring = useRef<Sample[]>([]);
  const holdRef = useRef<"up" | "down" | "flat">("flat");
  const holdUntil = useRef(0);
  const lastPaint = useRef(0);
  const [color, setColor] = useState(WHITE);

  useEffect(() => {
    if (price == null || !Number.isFinite(price)) {
      setColor(WHITE);
      return;
    }
    const now = Date.now();
    ring.current.push({ t: now, p: price });
    ring.current = ring.current.filter((s) => now - s.t <= 10_000).slice(-MAX_TICKS);

    const refSample = ring.current.find((s) => now - s.t >= REF_MS);
    const reference = refSample?.p ?? ring.current[0]?.p ?? price;

    let dir: "up" | "down" | "flat" = "flat";
    const eps = Math.max(0.01, Math.abs(price) * 1e-6);
    if (price > reference + eps) dir = "up";
    else if (price < reference - eps) dir = "down";

    if (dir !== "flat") {
      holdRef.current = dir;
      holdUntil.current = now + HOLD_MS;
    } else if (now > holdUntil.current) {
      holdRef.current = "flat";
    }

    if (now - lastPaint.current < throttleMs) return;
    lastPaint.current = now;
    setColor(pickSpotColor(price, reference, holdRef.current));
  }, [price, throttleMs]);

  return color;
}

export function useSpotTickCue(price: number | null | undefined, throttleMs = 250): { color: string; glyph: string } {
  const color = useSpotDirectionColor(price, throttleMs);
  const glyph = color === UP ? "\u25b2" : color === DOWN ? "\u25bc" : "";
  return { color, glyph };
}

export type SpotTickBook = {
  last: number | null;
  bid: number | null;
  ask: number | null;
};

export type SpotTickSide = "ask" | "bid" | "flat";

type SpotTickSource = "quote" | "desk";

function finitePx(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function bookFrom(raw: { last?: number | null; bid?: number | null; ask?: number | null } | null | undefined): SpotTickBook | null {
  if (!raw) return null;
  const book = {
    last: finitePx(raw.last),
    bid: finitePx(raw.bid),
    ask: finitePx(raw.ask),
  };
  if (book.last == null && book.bid == null && book.ask == null) return null;
  return book;
}

function priceMoved(prev: number | null, next: number | null): boolean {
  if (prev == null || next == null) return false;
  const eps = Math.max(0.0001, Math.abs(next) * 1e-9);
  return Math.abs(prev - next) > eps;
}

/** A print at the offer, or a one-sided ask update, is an ask tick. Bid is the mirror. */
export function spotTickSide(prev: SpotTickBook, next: SpotTickBook): Exclude<SpotTickSide, "flat"> | null {
  const askTick = priceMoved(prev.ask, next.ask);
  const bidTick = priceMoved(prev.bid, next.bid);
  const lastTick = priceMoved(prev.last, next.last);

  if (lastTick && next.last != null && next.bid != null && next.ask != null && next.ask > next.bid) {
    if (next.last >= next.ask - 1e-6) return "ask";
    if (next.last <= next.bid + 1e-6) return "bid";
  }
  if (askTick && !bidTick) return "ask";
  if (bidTick && !askTick) return "bid";
  return null;
}

/** Websocket quote text wins. Desk px is only the book when the quote has no last. */
export function selectSpotTickSource(
  quote: { last?: number | null; bid?: number | null; ask?: number | null } | null | undefined,
  desk: { last?: number | null; bid?: number | null; ask?: number | null } | null | undefined,
): { source: SpotTickSource; book: SpotTickBook } | null {
  const q = bookFrom(quote);
  const d = bookFrom(desk);
  if (q?.last != null) return { source: "quote", book: q };
  if (d?.last != null) return { source: "desk", book: d };
  if (q) return { source: "quote", book: q };
  if (d) return { source: "desk", book: d };
  return null;
}

export function spotTickColor(side: SpotTickSide): string {
  if (side === "ask") return UP;
  if (side === "bid") return DOWN;
  return WHITE;
}

function sameBook(a: SpotTickBook, b: SpotTickBook): boolean {
  return a.last === b.last && a.bid === b.bid && a.ask === b.ask;
}

type SpotTickPaint = {
  symbol: string;
  source: SpotTickSource | null;
  book: SpotTickBook;
  color: string;
  side: SpotTickSide;
};

const FLAT_PAINT: SpotTickPaint = {
  symbol: "",
  source: null,
  book: { last: null, bid: null, ask: null },
  color: WHITE,
  side: "flat",
};

/**
 * Header spot follows the live quote text.
 * An ask tick turns it green. A bid tick turns it red. The color holds until the next tick.
 */
export function useSpotQuoteTickColor(
  symbol: string,
  quote: { last?: number | null; bid?: number | null; ask?: number | null } | null | undefined,
  desk: { last?: number | null; bid?: number | null; ask?: number | null } | null | undefined,
): { color: string; side: SpotTickSide; price: number | null } {
  const selected = selectSpotTickSource(quote, desk);
  const [paint, setPaint] = useState<SpotTickPaint>(FLAT_PAINT);

  if (!selected) {
    const held = paint.symbol === symbol ? paint : FLAT_PAINT;
    return { color: held.color, side: held.side, price: null };
  }

  const baseline = paint.symbol !== symbol || paint.source !== selected.source;
  const changed = baseline || !sameBook(paint.book, selected.book);
  const side: SpotTickSide = !changed
    ? paint.side
    : baseline
      ? "flat"
      : (spotTickSide(paint.book, selected.book) ?? paint.side);

  if (changed) {
    setPaint({
      symbol,
      source: selected.source,
      book: selected.book,
      color: spotTickColor(side),
      side,
    });
  }

  return { color: spotTickColor(side), side, price: selected.book.last };
}