export type MarketSession = 'pre-market' | 'regular' | 'after-hours' | 'closed';

export interface RawQuote {
  symbol: string;
  /** Last COMPLETED regular-session close before today (e.g. yesterday). Anchor for the total move. */
  priorClose: number;
  /** Today's 4pm regular close. null until today's regular session has actually closed
   *  (null during pre-market and during the live regular session). */
  todayRegularClose: number | null;
  /** Freshest trade PRINT, any session. Must be a real last trade, not a quote/mid. */
  lastPrice: number;
  /** ISO timestamp of lastPrice — used for the freshness check upstream. */
  lastTradeTime: string;
}

export interface NormalizedQuote {
  symbol: string;
  session: MarketSession;
  asOf: string;
  priorClose: number;
  regularClose: number | null;
  lastPrice: number;
  totalChange: number;            // last - priorClose
  totalChangePct: number;
  regularChange: number | null;   // todayRegularClose - priorClose (daytime leg)
  regularChangePct: number | null;
  extendedChange: number | null;  // last - todayRegularClose (pre/post leg)
  extendedChangePct: number | null;
  summary: string;                // pre-formatted, internally consistent; quote verbatim
}

function nyParts(d: Date): { hour: number; minute: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: 'numeric', weekday: 'short', hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hour = parseInt(get('hour'), 10) % 24;
  const minute = parseInt(get('minute'), 10);
  const wk: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { hour, minute, weekday: wk[get('weekday')] ?? 0 };
}

export function classifySession(now: Date = new Date()): MarketSession {
  const { hour, minute, weekday } = nyParts(now);
  if (weekday === 0 || weekday === 6) return 'closed';
  const mins = hour * 60 + minute;
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return 'pre-market';   // 04:00–09:30 ET
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return 'regular';     // 09:30–16:00 ET
  if (mins >= 16 * 60 && mins < 20 * 60) return 'after-hours';     // 16:00–20:00 ET
  return 'closed';
  // Ignores holidays/half-days. For production, prefer Polygon /v1/marketstatus/now
  // over clock math so those are handled for free.
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (chg: number, base: number) => (base ? (chg / base) * 100 : 0);
const sgn = (n: number) => (n >= 0 ? '+' : '-');
const money = (n: number) => `${sgn(n)}$${Math.abs(r2(n)).toFixed(2)}`;
const pctStr = (n: number) => `${sgn(n)}${Math.abs(r2(n)).toFixed(2)}%`;
const px = (n: number) => `$${r2(n).toFixed(2)}`;

export function normalizeQuote(raw: RawQuote, now: Date = new Date()): NormalizedQuote {
  const session = classifySession(now);
  const { symbol, priorClose, todayRegularClose, lastPrice, lastTradeTime } = raw;

  const totalChange = r2(lastPrice - priorClose);
  const totalChangePct = r2(pct(totalChange, priorClose));

  let regularChange: number | null = null;
  let regularChangePct: number | null = null;
  let extendedChange: number | null = null;
  let extendedChangePct: number | null = null;

  if (todayRegularClose != null) {
    regularChange = r2(todayRegularClose - priorClose);
    regularChangePct = r2(pct(regularChange, priorClose));
    if (session !== 'regular') {
      extendedChange = r2(lastPrice - todayRegularClose);
      extendedChangePct = r2(pct(extendedChange, todayRegularClose));
    }
  }

  let summary: string;
  if ((session === 'after-hours' || session === 'closed') && todayRegularClose != null && extendedChange != null) {
    const label = session === 'closed' ? 'Last (post-close)' : 'After-hours';
    summary =
      `${label} ${px(lastPrice)}, ${money(totalChange)} (${pctStr(totalChangePct)}) vs prior close ${px(priorClose)}. ` +
      `Regular session closed ${px(todayRegularClose)} (${money(regularChange!)}, ${pctStr(regularChangePct!)}); ` +
      `extended leg ${money(extendedChange)} (${pctStr(extendedChangePct!)}) on top.`;
  } else if (session === 'pre-market') {
    summary = `Pre-market ${px(lastPrice)}, ${money(totalChange)} (${pctStr(totalChangePct)}) vs prior close ${px(priorClose)}.`;
  } else {
    const tag = session === 'regular' ? ' (regular session)' : '';
    summary = `${px(lastPrice)}, ${money(totalChange)} (${pctStr(totalChangePct)}) vs prior close ${px(priorClose)}${tag}.`;
  }

  return {
    symbol, session, asOf: lastTradeTime,
    priorClose: r2(priorClose),
    regularClose: todayRegularClose != null ? r2(todayRegularClose) : null,
    lastPrice: r2(lastPrice),
    totalChange, totalChangePct,
    regularChange, regularChangePct,
    extendedChange, extendedChangePct,
    summary,
  };
}
