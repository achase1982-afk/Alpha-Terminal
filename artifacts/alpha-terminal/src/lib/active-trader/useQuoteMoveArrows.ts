import { useEffect, useRef, useState } from "react";

export type QuoteArrow = "up" | "down" | null;

const ARROW_MS = 500;

/**
 * Arrow for a price that changed against the previous price of that exact side.
 * The first price, and every price after a reconnect baseline, draws nothing.
 * A null price is not a move and does not replace the stored baseline.
 */
export function useQuoteMoveArrows(
  identity: string | null,
  bid: number | null,
  ask: number | null,
  epoch: number,
): { bid: QuoteArrow; ask: QuoteArrow } {
  const baseline = useRef<{
    epoch: number;
    id: string | null;
    bid: number | null;
    ask: number | null;
  } | null>(null);
  const timers = useRef<{ bid: ReturnType<typeof setTimeout> | null; ask: ReturnType<typeof setTimeout> | null }>({
    bid: null,
    ask: null,
  });
  const [arrows, setArrows] = useState<{ bid: QuoteArrow; ask: QuoteArrow }>({ bid: null, ask: null });

  useEffect(() => {
    const prev = baseline.current;
    if (!prev || prev.epoch !== epoch || prev.id !== identity) {
      baseline.current = { epoch, id: identity, bid, ask };
      if (timers.current.bid) clearTimeout(timers.current.bid);
      if (timers.current.ask) clearTimeout(timers.current.ask);
      timers.current.bid = null;
      timers.current.ask = null;
      setArrows({ bid: null, ask: null });
      return;
    }

    const arm = (side: "bid" | "ask", move: Exclude<QuoteArrow, null>) => {
      setArrows((cur) => ({ ...cur, [side]: move }));
      if (timers.current[side]) clearTimeout(timers.current[side]);
      timers.current[side] = setTimeout(() => {
        timers.current[side] = null;
        setArrows((cur) => ({ ...cur, [side]: null }));
      }, ARROW_MS);
    };

    if (bid != null && prev.bid != null && bid !== prev.bid) {
      arm("bid", bid > prev.bid ? "up" : "down");
    }
    if (ask != null && prev.ask != null && ask !== prev.ask) {
      arm("ask", ask > prev.ask ? "up" : "down");
    }
    baseline.current = {
      epoch,
      id: identity,
      bid: bid != null ? bid : prev.bid,
      ask: ask != null ? ask : prev.ask,
    };
  }, [identity, bid, ask, epoch]);

  useEffect(() => {
    const held = timers.current;
    return () => {
      if (held.bid) clearTimeout(held.bid);
      if (held.ask) clearTimeout(held.ask);
    };
  }, []);

  return arrows;
}
