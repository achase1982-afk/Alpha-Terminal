import { useEffect, useRef, useState } from "react";

export type QuoteArrow = "up" | "down" | null;

const ARROW_MS = 500;

type Side = {
  price: number | null;
  arrow: QuoteArrow;
  until: number;
};

type Track = {
  epoch: number;
  id: string | null;
  bid: Side;
  ask: Side;
};

function freshSide(price: number | null): Side {
  return { price, arrow: null, until: 0 };
}

/**
 * Arrow for a price that changed against the previous price of that exact side.
 * The first price, and every price after a reconnect baseline, draws nothing.
 * A null price is not a move and does not replace the stored baseline.
 * The arrow is decided in the same render as the new price, so a tick does not
 * paint the pair a second time. The 500 ms clear is the only later paint.
 */
export function useQuoteMoveArrows(
  identity: string | null,
  bid: number | null,
  ask: number | null,
  epoch: number,
): { bid: QuoteArrow; ask: QuoteArrow } {
  const track = useRef<Track | null>(null);
  const [, clearExpired] = useState(0);
  const now = Date.now();

  let current = track.current;
  if (!current || current.epoch !== epoch || current.id !== identity) {
    current = {
      epoch,
      id: identity,
      bid: freshSide(bid),
      ask: freshSide(ask),
    };
    track.current = current;
  } else {
    const apply = (slot: Side, price: number | null) => {
      if (price != null && slot.price != null && price !== slot.price) {
        slot.arrow = price > slot.price ? "up" : "down";
        slot.until = now + ARROW_MS;
      } else if (slot.arrow && now >= slot.until) {
        slot.arrow = null;
      }
      if (price != null) slot.price = price;
    };
    apply(current.bid, bid);
    apply(current.ask, ask);
  }

  const bidArrow = current.bid.arrow && now < current.bid.until ? current.bid.arrow : null;
  const askArrow = current.ask.arrow && now < current.ask.until ? current.ask.arrow : null;
  if (!bidArrow) current.bid.arrow = null;
  if (!askArrow) current.ask.arrow = null;

  useEffect(() => {
    const pending: number[] = [];
    if (bidArrow) pending.push(current.bid.until);
    if (askArrow) pending.push(current.ask.until);
    if (pending.length === 0) return;
    const delay = Math.max(0, Math.min(...pending) - Date.now());
    const timer = setTimeout(() => clearExpired((n) => n + 1), delay);
    return () => clearTimeout(timer);
  });

  return { bid: bidArrow, ask: askArrow };
}
