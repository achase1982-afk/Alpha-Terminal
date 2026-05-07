import { db, corporateEventsTable, earningsReactionsTable, equityDailyTable } from "@workspace/db";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import {
  advanceNyTradingDaysYmd,
  isNyTradingSessionDate,
  nextNyTradingDayYmd,
  prevNyTradingDayYmd,
} from "../../lib/polygonMarketCalendar.js";

type EqDay = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

async function loadEquitySeries(symbol: string): Promise<Map<string, EqDay>> {
  const rows = await db
    .select({
      date: equityDailyTable.date,
      open: equityDailyTable.open,
      high: equityDailyTable.high,
      low: equityDailyTable.low,
      close: equityDailyTable.close,
      volume: equityDailyTable.volume,
    })
    .from(equityDailyTable)
    .where(eq(equityDailyTable.symbol, symbol.toUpperCase()))
    .orderBy(asc(equityDailyTable.date));

  const m = new Map<string, EqDay>();
  for (const r of rows) {
    const d = typeof r.date === "string" ? r.date.slice(0, 10) : String(r.date).slice(0, 10);
    const c = Number(r.close);
    if (!Number.isFinite(c) || c <= 0) continue;
    const o = r.open != null ? Number(r.open) : c;
    const h = r.high != null ? Number(r.high) : c;
    const l = r.low != null ? Number(r.low) : c;
    const vol = r.volume != null ? Number(r.volume) : null;
    m.set(d, {
      date: d,
      open: Number.isFinite(o) && o > 0 ? o : c,
      high: Number.isFinite(h) && h > 0 ? h : c,
      low: Number.isFinite(l) && l > 0 ? l : c,
      close: c,
      volume: vol != null && Number.isFinite(vol) ? vol : null,
    });
  }
  return m;
}

async function resolveTZero(earningsDate: string, timing: string | null): Promise<string> {
  const isAmc = timing === "AMC";
  if (isAmc) {
    return nextNyTradingDayYmd(earningsDate);
  }
  if (await isNyTradingSessionDate(earningsDate)) return earningsDate;
  return nextNyTradingDayYmd(earningsDate);
}

function surprisePct(actual: number | null, est: number | null): number | null {
  if (actual == null || est == null) return null;
  const a = Math.abs(est);
  if (a < 1e-12) return null;
  return ((actual - est) / a) * 100;
}

async function avgVolume20EndingAt(m: Map<string, EqDay>, endDate: string): Promise<number | null> {
  let d = endDate;
  let sum = 0;
  let n = 0;
  for (let k = 0; k < 20; k++) {
    const row = m.get(d);
    if (row?.volume != null && Number.isFinite(row.volume) && row.volume > 0) {
      sum += row.volume;
      n++;
    }
    d = await prevNyTradingDayYmd(d);
  }
  if (n === 0) return null;
  return sum / n;
}

export async function computeEarningsReactionsForSymbol(symbol: string): Promise<{ rowsUpserted: number }> {
  const sym = symbol.toUpperCase().trim();
  const today = new Date().toISOString().slice(0, 10);
  const series = await loadEquitySeries(sym);

  const events = await db
    .select({
      earningsDate: corporateEventsTable.earningsDate,
      earningsTiming: corporateEventsTable.earningsTiming,
      epsEst: corporateEventsTable.earningsEpsEstimate,
      epsAct: corporateEventsTable.earningsEpsActual,
      revEst: corporateEventsTable.earningsRevenueEstimate,
      revAct: corporateEventsTable.earningsRevenueActual,
    })
    .from(corporateEventsTable)
    .where(and(eq(corporateEventsTable.symbol, sym), isNotNull(corporateEventsTable.earningsDate)));

  let rowsUpserted = 0;

  for (const ev of events) {
    const ed = ev.earningsDate ? (typeof ev.earningsDate === "string" ? ev.earningsDate.slice(0, 10) : String(ev.earningsDate).slice(0, 10)) : "";
    if (!ed || ed >= today) continue;

    const timingRaw = ev.earningsTiming;
    const displayTiming =
      timingRaw == null || String(timingRaw).trim() === "" ? "UNKNOWN" : String(timingRaw);

    const tZero = await resolveTZero(ed, timingRaw);
    const tMinus1 = await prevNyTradingDayYmd(tZero);
    const tPlus1 = await advanceNyTradingDaysYmd(tZero, 1);
    const tPlus5 = await advanceNyTradingDaysYmd(tZero, 5);

    const pre = series.get(tMinus1);
    const z = series.get(tZero);
    const p1 = series.get(tPlus1);
    const p5 = series.get(tPlus5);
    if (!pre || !z) continue;

    const preClose = pre.close;
    const eventOpen = z.open;
    const eventClose = z.close;
    const tplus1Close = p1?.close ?? null;
    const tplus5Close = p5?.close ?? null;

    const gapPct = (eventOpen - preClose) / preClose;
    const intradayPct = (eventClose - eventOpen) / eventOpen;
    const reaction1d = (eventClose - preClose) / preClose;
    const reaction5d = tplus5Close != null ? (tplus5Close - preClose) / preClose : null;
    const driftPost =
      tplus5Close != null ? (tplus5Close - eventClose) / eventClose : null;

    let minClose = eventClose;
    let maxClose = eventClose;
    let walk = tZero;
    for (let i = 0; i <= 5; i++) {
      const row = series.get(walk);
      if (row) {
        minClose = Math.min(minClose, row.close);
        maxClose = Math.max(maxClose, row.close);
      }
      if (i === 5) break;
      walk = await advanceNyTradingDaysYmd(walk, 1);
    }
    const maxDrawdown5dPct = minClose / preClose - 1;
    const maxUpmove5dPct = maxClose / preClose - 1;

    const vol20 = await avgVolume20EndingAt(series, tMinus1);
    const eventVol = z.volume;
    const volumeVs20 =
      vol20 != null && vol20 > 0 && eventVol != null && eventVol > 0 ? eventVol / vol20 : null;

    const epsEst = ev.epsEst != null ? Number(ev.epsEst) : null;
    const epsAct = ev.epsAct != null ? Number(ev.epsAct) : null;
    const revEst = ev.revEst != null ? Number(ev.revEst) : null;
    const revAct = ev.revAct != null ? Number(ev.revAct) : null;

    await db
      .insert(earningsReactionsTable)
      .values({
        symbol: sym,
        earningsDate: ed,
        tZeroDate: tZero,
        timeOfDay: displayTiming,
        preEventClose: preClose,
        eventOpen,
        eventClose,
        tplus1Close,
        tplus5Close,
        gapPct,
        intradayPct,
        reaction1dPct: reaction1d,
        reaction5dPct: reaction5d,
        driftPostInitialPct: driftPost,
        maxDrawdown5dPct,
        maxUpmove5dPct,
        volumeVs20dAvg: volumeVs20,
        epsEstimate: epsEst,
        epsActual: epsAct,
        epsSurprisePct: surprisePct(epsAct, epsEst),
        revenueEstimate: revEst,
        revenueActual: revAct,
        revenueSurprisePct: surprisePct(revAct, revEst),
        computedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [earningsReactionsTable.symbol, earningsReactionsTable.earningsDate],
        set: {
          tZeroDate: sql`excluded.t_zero_date`,
          timeOfDay: sql`excluded.time_of_day`,
          preEventClose: sql`excluded.pre_event_close`,
          eventOpen: sql`excluded.event_open`,
          eventClose: sql`excluded.event_close`,
          tplus1Close: sql`excluded.tplus1_close`,
          tplus5Close: sql`excluded.tplus5_close`,
          gapPct: sql`excluded.gap_pct`,
          intradayPct: sql`excluded.intraday_pct`,
          reaction1dPct: sql`excluded.reaction_1d_pct`,
          reaction5dPct: sql`excluded.reaction_5d_pct`,
          driftPostInitialPct: sql`excluded.drift_post_initial_pct`,
          maxDrawdown5dPct: sql`excluded.max_drawdown_5d_pct`,
          maxUpmove5dPct: sql`excluded.max_upmove_5d_pct`,
          volumeVs20dAvg: sql`excluded.volume_vs_20d_avg`,
          epsEstimate: sql`excluded.eps_estimate`,
          epsActual: sql`excluded.eps_actual`,
          epsSurprisePct: sql`excluded.eps_surprise_pct`,
          revenueEstimate: sql`excluded.revenue_estimate`,
          revenueActual: sql`excluded.revenue_actual`,
          revenueSurprisePct: sql`excluded.revenue_surprise_pct`,
          computedAt: sql`now()`,
        },
      });
    rowsUpserted++;
  }

  return { rowsUpserted };
}
