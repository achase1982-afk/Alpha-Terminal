import { useEffect, useMemo, useState } from "react";
import { useQuote } from "@/hooks/useQuote";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { generateMarketEvents } from "@/lib/calendarEvents";
import { BORDER, DIM, GOLD, GRAY, WHITE } from "@/components/options/optionsTheme";
import type { PositionView } from "@/components/journal/journalModel";

const NUM = { fontVariantNumeric: "tabular-nums" } as const;
const CELL = 16;
const ARCH = 18;
const UP = "#4ee38a";
const DOWN = "#ff5a5f";

const FLAT_POINTS: Record<string, number> = { "/ES": 4, "/YM": 30, "/NQ": 15, "$VIX": 0.15 };

const INDEX = new Set([
  "SPY", "QQQ", "IWM", "DIA", "SPX", "SPXW", "NDX", "NDXP", "RUT", "RUTW",
  "VIX", "VIXW", "XSP", "ES", "NQ", "YM", "RTY", "MES", "MNQ", "MYM",
]);

type EconRow = {
  date: string;
  time: string | null;
  eventName: string;
  actual: string | null;
};

type EarningRow = {
  date: string;
  ticker: string;
  time: string | null;
};

type Line = {
  key: string;
  when: string;
  sort: number;
  title: string;
  note: string | null;
};

function etDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function plusDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function dayStamp(iso: string): string {
  return iso.slice(0, 10);
}

function weekday(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

function minutesOf(time: string | null): number {
  if (!time) return 24 * 60;
  const [hRaw, mRaw] = time.split(":");
  const h = Number(hRaw);
  const m = Number(mRaw ?? 0);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 24 * 60;
  return h * 60 + m;
}

function clock(time: string | null): string {
  if (!time) return "";
  const mins = minutesOf(time);
  if (mins >= 24 * 60) return time;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

function norm(symbol: string): string {
  return symbol.replace(/^\$/, "").replace(/^\//, "").toUpperCase();
}

function family(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("minutes")) return "fomc-minutes";
  if (n.includes("powell") || (n.includes("fed chair") && n.includes("speak"))) return "powell";
  if (n.includes("fomc") || n.includes("fed interest") || n.includes("interest rate decision")) return "fomc";
  if (n.includes("cpi")) return "cpi";
  if (n.includes("pce")) return "pce";
  if (n.includes("ppi")) return "ppi";
  if (n.includes("nonfarm") || n.includes("non-farm") || n.includes("payrolls")) return "nfp";
  if (n.includes("gdp")) return "gdp";
  if (n.includes("retail sales")) return "retail";
  if (n.includes("ism") && n.includes("service")) return "ism-svc";
  if (n.includes("ism")) return "ism";
  if (n.includes("jobless")) return "claims";
  if (n.includes("beige book")) return "beige";
  return n;
}

function shortTitle(name: string, key: string): string {
  const known: Record<string, string> = {
    powell: "Fed chair speaks",
    fomc: "FOMC decision",
    "fomc-minutes": "FOMC minutes",
    cpi: "CPI",
    pce: "PCE",
    ppi: "PPI",
    nfp: "Jobs report",
    gdp: "GDP",
    retail: "Retail sales",
    "ism-svc": "ISM services",
    ism: "ISM manufacturing",
    claims: "Jobless claims",
    beige: "Beige book",
  };
  return known[key] ?? name;
}

function openBook(positions: PositionView[]): { symbols: Set<string>; index: boolean } {
  const symbols = new Set<string>();
  let index = false;
  for (const position of positions) {
    if (position.status !== "open" && position.status !== "partial") continue;
    const symbol = norm(position.underlying ?? "");
    if (!symbol) continue;
    symbols.add(symbol);
    if (INDEX.has(symbol)) index = true;
  }
  return { symbols, index };
}

function direction(symbol: string, change: number | null): { name: string; word: string; color: string } {
  const name = symbol === "/ES" ? "S&P" : symbol === "/YM" ? "Dow" : symbol === "/NQ" ? "Nasdaq" : "VIX";
  if (change == null || !Number.isFinite(change)) return { name, word: "—", color: GRAY };
  if (Math.abs(change) < (FLAT_POINTS[symbol] ?? 0.15)) return { name, word: "flat", color: GRAY };
  const up = change > 0;
  return { name, word: up ? "up" : "down", color: up ? UP : DOWN };
}

export function OvernightLine(props: { session: "cash" | "overnight" | "closed" }) {
  const es = useQuote("/ES").sessionChange.change;
  const ym = useQuote("/YM").sessionChange.change;
  const nq = useQuote("/NQ").sessionChange.change;
  const vix = useQuote("$VIX").sessionChange.change;
  if (es == null && ym == null && nq == null && vix == null) return null;
  const since = props.session === "cash" ? "Since yesterday's close" : "Since the cash close";
  const parts = [direction("/ES", es), direction("/YM", ym), direction("/NQ", nq), direction("$VIX", vix)];
  return (
    <div style={{ ...NUM, fontSize: CELL, color: GRAY, lineHeight: 1.4, paddingBottom: 10 }}>
      <div>{since}</div>
      <div>
        {parts.map((part, index) => (
          <span key={part.name}>
            {index > 0 ? " · " : ""}
            {part.name} <span style={{ color: part.color, fontWeight: 700 }}>{part.word}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function MorningEvents(props: { now: number; positions: PositionView[] }) {
  const today = etDay(new Date(props.now));
  const horizon = plusDays(today, 7);
  const [econ, setEcon] = useState<EconRow[] | null>(null);
  const [earnings, setEarnings] = useState<EarningRow[] | null>(null);

  useEffect(() => {
    let cancel = false;
    void fetchWithAuth("/api/market/economic-calendar")
      .then((res) => res.json())
      .then((body: { events?: EconRow[] }) => {
        if (!cancel) setEcon(body.events ?? []);
      })
      .catch(() => {
        if (!cancel) setEcon([]);
      });
    void fetchWithAuth("/api/market/earnings-calendar")
      .then((res) => res.json())
      .then((body: { earnings?: EarningRow[] }) => {
        if (!cancel) setEarnings(body.earnings ?? []);
      })
      .catch(() => {
        if (!cancel) setEarnings([]);
      });
    return () => {
      cancel = true;
    };
  }, []);

  const book = useMemo(() => openBook(props.positions), [props.positions]);

  const lines = useMemo(() => {
    if (econ == null) return null;
    const todayRows = econ.filter((row) => dayStamp(row.date) === today);
    const seen = new Set<string>();
    const macro: Line[] = [];
    for (const row of todayRows) {
      const key = family(row.eventName);
      if (seen.has(key)) {
        const existing = macro.find((line) => line.key === key);
        if (existing && !existing.note && row.actual) existing.note = `printed ${row.actual}`;
        continue;
      }
      seen.add(key);
      macro.push({
        key,
        sort: minutesOf(row.time),
        when: clock(row.time),
        title: shortTitle(row.eventName, key),
        note: row.actual ? `printed ${row.actual}` : book.index ? "on an open index" : null,
      });
    }
    for (const row of todayRows) {
      if (!row.actual) continue;
      const existing = macro.find((line) => line.key === family(row.eventName));
      if (existing && !existing.note?.startsWith("printed")) existing.note = `printed ${row.actual}`;
    }
    const hasFed = macro.some((line) => line.key === "fomc" || line.key === "powell");
    if (!hasFed) {
      const year = Number(today.slice(0, 4));
      const local = generateMarketEvents(year, year).find(
        (event) => event.date === today && event.type === "fomc" && event.fomcType === "decision",
      );
      if (local) {
        macro.push({
          key: "fomc",
          sort: 14 * 60,
          when: "2:00 PM",
          title: "FOMC decision",
          note: book.index ? "on an open index" : null,
        });
      }
    }
    macro.sort((a, b) => a.sort - b.sort);

    const held = earnings ?? [];
    const todayPrints: Line[] = [];
    const later: Line[] = [];
    const seenTickers = new Set<string>();
    for (const row of held) {
      const ticker = norm(row.ticker);
      const date = dayStamp(row.date);
      if (!book.symbols.has(ticker) || date < today || date > horizon || seenTickers.has(ticker)) continue;
      seenTickers.add(ticker);
      const bmo = row.time === "BMO";
      const amc = row.time === "AMC";
      const line: Line = {
        key: ticker,
        sort: date === today ? (bmo ? 0 : amc ? 20 * 60 : minutesOf(row.time)) : Number(date.replace(/-/g, "")),
        when: date === today ? (row.time === "BMO" || row.time === "AMC" ? row.time : clock(row.time)) : weekday(date),
        title: `${ticker} earnings`,
        note: "open",
      };
      if (date === today) todayPrints.push(line);
      else later.push(line);
    }
    todayPrints.sort((a, b) => a.sort - b.sort);
    later.sort((a, b) => a.sort - b.sort);
    const heldLine = todayPrints[0] ?? later[0];
    const ranked = [...macro, ...todayPrints, ...later];
    if (heldLine && macro.length >= 4 && !ranked.slice(0, 4).some((line) => line.key === heldLine.key)) {
      return [...macro.slice(0, 3), heldLine];
    }
    return ranked.slice(0, 4);
  }, [book.index, book.symbols, earnings, econ, horizon, today]);

  if (lines == null) {
    return <div style={{ fontSize: CELL, color: DIM, padding: "0 12px 10px" }}>Calendar</div>;
  }

  return (
    <div style={{ padding: "0 12px 8px", borderTop: `1px solid ${BORDER}` }}>
      <div style={{ fontSize: ARCH, fontWeight: 600, letterSpacing: 0.4, color: GOLD, paddingTop: 10 }}>TODAY</div>
      {lines.length === 0 ? (
        <div style={{ fontSize: CELL, color: GRAY, lineHeight: 1.4, padding: "6px 0 4px" }}>Nothing scheduled that moves the tape today.</div>
      ) : (
        lines.map((line) => (
          <div key={line.key} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "8px 0" }}>
            <span style={{ ...NUM, width: 88, flexShrink: 0, fontSize: CELL, color: GRAY, lineHeight: 1.35 }}>{line.when || "Today"}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: CELL, color: WHITE, fontWeight: 600, lineHeight: 1.35 }}>{line.title}</span>
              {line.note ? <span style={{ display: "block", fontSize: CELL, color: DIM, lineHeight: 1.35 }}>{line.note}</span> : null}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
