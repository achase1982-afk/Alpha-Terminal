import { useEffect, useMemo, useState } from "react";
import type { OptionsContract } from "@/components/OptionsTab";
import { useOptionsStreamStore, type OptionTick } from "@/lib/options-stream-store";
import { atLadderDisplayQuote, type AtLadderDisplayQuote } from "./atLadderExecutableQuote";

function sameQuoteView(a: AtLadderDisplayQuote, b: AtLadderDisplayQuote): boolean {
  return (
    a.bid === b.bid &&
    a.ask === b.ask &&
    a.displayState === b.displayState &&
    a.reason === b.reason &&
    a.tapable === b.tapable &&
    a.bidTapable === b.bidTapable &&
    a.askTapable === b.askTapable &&
    a.dimmed === b.dimmed &&
    a.locked === b.locked &&
    a.asOfLabel === b.asOfLabel
  );
}

/**
 * What one contract's bid/ask cells show, subscribed to that contract only.
 *
 * The returned object keeps its identity until something visible changes, so
 * a tick that only moves sizes, greeks or timestamps does not re-render the
 * cells, and a tick for another contract is never looked at twice.
 *
 * `clockMinute` re-checks session/staleness rules once a minute even when the
 * contract is not ticking.
 */
export function useAtLadderQuote(
  contract: OptionsContract | null | undefined,
  chainTs: number,
  clockMinute: number,
): AtLadderDisplayQuote {
  const key = contract?.streamKey;
  const selector = useMemo(() => {
    let lastTick: OptionTick | undefined;
    let last: AtLadderDisplayQuote | null = null;
    return (s: { ticks: Record<string, OptionTick> }) => {
      const tick = key ? s.ticks[key] : undefined;
      if (last && tick === lastTick) return last;
      lastTick = tick;
      const next = atLadderDisplayQuote(contract, tick, chainTs);
      if (last && sameQuoteView(last, next)) return last;
      last = next;
      return next;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clockMinute forces a re-evaluation
  }, [contract, key, chainTs, clockMinute]);
  return useOptionsStreamStore(selector);
}

/** Wall-clock minute number; changes once a minute. */
export function useMinuteClock(): number {
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60_000));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      const now = Date.now();
      timer = setTimeout(() => {
        setMinute(Math.floor(Date.now() / 60_000));
        arm();
      }, 60_000 - (now % 60_000) + 25);
    };
    arm();
    return () => clearTimeout(timer);
  }, []);
  return minute;
}
