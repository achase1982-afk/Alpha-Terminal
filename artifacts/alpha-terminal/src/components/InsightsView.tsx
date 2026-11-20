import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useQuote } from "@/hooks/useQuote";
import { formatAtGlanceSpot } from "@/lib/active-trader/atGlanceSpotFormat";
import { useAtVixQuote } from "@/hooks/useAtVixQuote";
import { MorningEvents, OvernightLine } from "@/components/insights/MorningGlance";
import { BG, BORDER, DIM, GOLD, GRAY, PUT_WALL, WHITE } from "@/components/options/optionsTheme";
import {
  EMPTY_CLOSED,
  holdPhrase,
  money,
  signedPct,
  unsignedMoney,
  type CurvePoint,
  type CutStat,
  type InsightSlice,
  type InsightsPayload,
  type JournalBook,
  type JournalPeriod,
} from "@/components/journal/journalModel";

/** Flow-strip bid/ask shades — same family as the chain, a step more vivid. */
const UP = "#4ee38a";
const DOWN = "#ff5a5f";
const TRACK = "#26262c";

const PERIODS: { id: JournalPeriod; label: string }[] = [
  { id: "30d", label: "30D" },
  { id: "90d", label: "90D" },
  { id: "ytd", label: "YTD" },
  { id: "lifetime", label: "ALL" },
];

const FUTS = [
  { symbol: "/ES", name: "S&P" },
  { symbol: "/YM", name: "Dow" },
  { symbol: "/NQ", name: "Nasdaq" },
] as const;

const NUM: CSSProperties = { fontVariantNumeric: "tabular-nums" };
/** Active Trader ladder cell size. Nothing on this page goes smaller. */
const CELL = 16;
const ARCH = 18;
const TITLE = 22;

function futuresSession(now: Date): "cash" | "overnight" | "closed" {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const grab = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const day = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[grab("weekday")] ?? 0;
  const minutes = Number(grab("hour")) * 60 + Number(grab("minute"));
  const cash = day >= 1 && day <= 5 && minutes >= 9 * 60 + 30 && minutes < 16 * 60;
  let open = false;
  if (day === 0) open = minutes >= 18 * 60;
  else if (day >= 1 && day <= 4) open = minutes < 17 * 60 || minutes >= 18 * 60;
  else if (day === 5) open = minutes < 17 * 60;
  if (!open) return "closed";
  return cash ? "cash" : "overnight";
}

function toneColor(value: number | null): string {
  if (value == null || value === 0) return WHITE;
  return value > 0 ? UP : DOWN;
}

function points(value: number | null, symbol: string): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const body = formatAtGlanceSpot(symbol, Math.abs(value));
  if (value > 0) return `+${body}`;
  if (value < 0) return `\u2212${body}`;
  return body;
}

function pf(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

function pctClosed(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function accountChoices(books: JournalBook[]): JournalBook[] {
  if (books.length > 0) return books;
  return [
    { id: "all_live", label: "All Live Accounts", paper: false },
    { id: "paper_sandbox", label: "Paper Sandbox", paper: true },
  ];
}

export function InsightsView(props: {
  subscribeEquitySymbols?: (symbols: string[]) => void;
}) {
  const [period, setPeriod] = useState<JournalPeriod>("ytd");
  const [accountId, setAccountId] = useState("all_live");
  const [payload, setPayload] = useState<InsightsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const requestSeq = useRef(0);
  const periodRef = useRef(period);
  const accountRef = useRef(accountId);
  periodRef.current = period;
  accountRef.current = accountId;

  const load = useCallback(async (next: JournalPeriod, account: string) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`/api/journal/insights?period=${next}&accountId=${encodeURIComponent(account)}`);
      if (seq !== requestSeq.current) return;
      if (!res.ok) throw new Error("unavailable");
      const body = (await res.json()) as InsightsPayload;
      if (seq !== requestSeq.current) return;
      setPayload(body);
    } catch {
      if (seq !== requestSeq.current) return;
      setError("Insights are unavailable right now.");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period, accountId);
  }, [load, period, accountId]);

  useEffect(() => {
    let cancel = false;
    void fetchWithAuth("/api/journal/sync", { method: "POST" }).then(async (res) => {
      const body = (await res.json().catch(() => ({}))) as { status?: string };
      if (cancel) return;
      const status = body.status ?? (res.status === 401 ? "no_token" : res.ok ? "ok" : "failed");
      if (status === "failed") setSyncNote("Sync failed");
      else if (status === "no_token") setSyncNote("Sync needs a connection");
      else setSyncNote(null);
      if (status === "ok") void load(periodRef.current, accountRef.current);
    }).catch(() => {
      if (!cancel) setSyncNote("Sync failed");
    });
    return () => {
      cancel = true;
    };
  }, [load]);

  useEffect(() => {
    void props.subscribeEquitySymbols?.(["/ES", "/YM", "/NQ", "VIX", "$VIX"]);
  }, [props.subscribeEquitySymbols]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const books = accountChoices(payload?.books ?? []);
  const accountLabel = books.find((book) => book.id === accountId)?.label
    ?? (accountId === "paper_sandbox" ? "Paper Sandbox" : "All Live Accounts");
  const paper = payload?.paper === true || accountId === "paper_sandbox";
  const session = futuresSession(new Date(now));
  const sessionLabel = session === "cash" ? "CASH" : session === "overnight" ? "OVERNIGHT" : "CLOSED";

  return (
    <div data-insights-page style={{ color: WHITE, minWidth: 0 }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          background: BG,
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <button
          type="button"
          onClick={() => setAccountOpen(true)}
          className="flex w-full items-center gap-1 text-left"
          style={{ minHeight: 44, padding: "10px 12px 4px", background: "transparent", border: "none", cursor: "pointer" }}
          aria-haspopup="dialog"
          aria-expanded={accountOpen}
        >
          {paper ? (
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: 8, background: PUT_WALL, flexShrink: 0 }} />
          ) : null}
          <span style={{ fontSize: ARCH, fontWeight: 600, color: "#f4f4f5", letterSpacing: -0.2 }}>{accountLabel}</span>
          <ChevronDown className="h-4 w-4 shrink-0" style={{ color: "#71717a" }} />
        </button>
        {paper ? (
          <div style={{ padding: "0 12px 8px", color: PUT_WALL, fontSize: CELL, fontWeight: 600, letterSpacing: 0.4 }}>
            PAPER SANDBOX · Simulated fills
          </div>
        ) : null}
        <div style={{ padding: "2px 12px 0" }}>
          <div style={{ fontSize: ARCH, fontWeight: 600, letterSpacing: 0.4, color: GOLD }}>
            FUTURES · {sessionLabel}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 16px", padding: "10px 0 4px" }}>
            {FUTS.map((fut) => (
              <FuturesQuote key={fut.symbol} symbol={fut.symbol} name={fut.name} />
            ))}
            <VixQuote />
          </div>
          <OvernightLine session={session} />
        </div>
        <MorningEvents now={now} positions={payload?.positions ?? []} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", borderTop: `1px solid ${BORDER}` }}>
          {PERIODS.map((item) => {
            const on = period === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setOpenKey(null);
                  setPeriod(item.id);
                }}
                aria-pressed={on}
                style={{
                  minHeight: 44,
                  border: "none",
                  borderBottom: on ? `2px solid ${GOLD}` : "2px solid transparent",
                  background: "transparent",
                  color: on ? WHITE : GRAY,
                  fontSize: CELL,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        {syncNote ? <div style={{ padding: "0 12px 8px", color: DIM, fontSize: CELL }}>{syncNote}</div> : null}
      </div>

      {loading && !payload ? <div style={{ padding: 16, color: GRAY, fontSize: CELL }}>Loading</div> : null}
      {error ? (
        <div style={{ padding: 16 }}>
          <div style={{ color: GRAY, fontSize: CELL }}>{error}</div>
          <button
            type="button"
            onClick={() => void load(period, accountId)}
            style={{ minHeight: 44, marginTop: 4, padding: "0 4px", background: "transparent", border: "none", color: GOLD, fontSize: CELL, fontWeight: 600, cursor: "pointer" }}
          >
            Retry
          </button>
        </div>
      ) : null}

      {payload?.empty ? (
        <div style={{ padding: "16px 12px", color: GRAY, fontSize: CELL }}>{payload.emptyMessage ?? EMPTY_CLOSED}</div>
      ) : null}

      {payload && !payload.empty && payload.headline ? (
        <Results
          payload={payload}
          infoOpen={infoOpen}
          onInfo={() => setInfoOpen((open) => !open)}
          openKey={openKey}
          onOpen={(key) => {
            setOpenKey((current) => (current === key ? null : key));
          }}
        />
      ) : null}

      {accountOpen
        ? createPortal(
            <div
              role="presentation"
              onClick={() => setAccountOpen(false)}
              style={{ position: "fixed", inset: 0, zIndex: 220, background: "rgba(0,0,0,0.45)" }}
            >
              <div
                role="dialog"
                aria-label="Account"
                onClick={(event) => event.stopPropagation()}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: BG,
                  borderTop: `1px solid ${BORDER}`,
                  paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))",
                }}
              >
                <div style={{ padding: "12px 12px 4px", fontSize: ARCH, fontWeight: 600, letterSpacing: 0.4, color: GRAY }}>
                  ACCOUNT
                </div>
                {books.map((book) => {
                  const selected = book.id === accountId;
                  return (
                    <button
                      key={book.id}
                      type="button"
                      onClick={() => {
                        setOpenKey(null);
                        setAccountId(book.id);
                        setAccountOpen(false);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        width: "100%",
                        minHeight: 44,
                        padding: "0 12px",
                        background: "transparent",
                        border: "none",
                        borderTop: `1px solid ${BORDER}`,
                        color: WHITE,
                        fontSize: CELL,
                        fontWeight: selected ? 600 : 400,
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <span
                        aria-hidden
                        style={{ width: 8, height: 8, borderRadius: 8, background: book.paper ? PUT_WALL : UP, flexShrink: 0 }}
                      />
                      <span style={{ flex: 1, minWidth: 0 }}>{book.label}</span>
                      {selected ? <span style={{ color: GOLD, fontSize: CELL }}>Selected</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function FuturesQuote({ symbol, name }: { symbol: string; name: string }) {
  const { data, sessionChange } = useQuote(symbol);
  const last = data?.last ?? data?.extendedLast ?? data?.regularLast ?? null;
  const change = sessionChange.change;
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: CELL, color: GRAY, fontWeight: 600 }}>{name}</div>
      <div style={{ ...NUM, fontSize: ARCH, color: WHITE, fontWeight: 600, lineHeight: 1.2 }}>
        {formatAtGlanceSpot(symbol, last)}
      </div>
      <div style={{ ...NUM, fontSize: CELL, fontWeight: 600, color: toneColor(change), lineHeight: 1.3 }}>
        {points(change, symbol)}
      </div>
    </div>
  );
}

function VixQuote() {
  const { data, sessionChange } = useQuote("$VIX");
  const restLast = useAtVixQuote(true);
  const last = data?.last ?? data?.extendedLast ?? data?.regularLast ?? restLast;
  const change = sessionChange.change;
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: CELL, color: GRAY, fontWeight: 600 }}>VIX</div>
      <div style={{ ...NUM, fontSize: ARCH, color: WHITE, fontWeight: 600, lineHeight: 1.2 }}>
        {formatAtGlanceSpot("$VIX", last)}
      </div>
      <div style={{ ...NUM, fontSize: CELL, fontWeight: 600, color: toneColor(change), lineHeight: 1.3 }}>
        {points(change, "$VIX")}
      </div>
    </div>
  );
}

function Results(props: {
  payload: InsightsPayload;
  infoOpen: boolean;
  onInfo: () => void;
  openKey: string | null;
  onOpen: (key: string) => void;
}) {
  const { payload } = props;
  const headline = payload.headline;
  const metrics = payload.account?.metrics;
  const comparison = payload.comparison;
  if (!headline) return null;
  const color = headline.tone === "positive" ? UP : headline.tone === "negative" ? DOWN : WHITE;
  const acct = comparison.accountReturn == null ? "Unavailable" : signedPct(comparison.accountReturn);
  const spy = comparison.benchmarkStatus !== "ok" || comparison.benchmarkReturn == null
    ? "Unavailable"
    : signedPct(comparison.benchmarkReturn);
  const equity = payload.assetClasses.find((row) => row.key === "equity");
  const options = payload.assetClasses.find((row) => row.key === "option");
  const takeaway = payload.takeaway;

  return (
    <div style={{ padding: "16px 12px 32px", minWidth: 0 }}>
      <div style={{ fontSize: ARCH, fontWeight: 600, letterSpacing: 0.4, color }}>{headline.label}</div>
      <div style={{ ...NUM, fontSize: TITLE, fontWeight: 600, color, lineHeight: 1.2, marginTop: 4 }}>
        {money(headline.netPnl)}
      </div>
      <div style={{ fontSize: CELL, color: GRAY, marginTop: 4, lineHeight: 1.35 }}>
        Net after fees · {headline.closedTrades} closed
      </div>
      <Sparkline points={payload.account?.curve ?? []} color={color} />

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, minWidth: 0 }}>
        <div style={{ ...NUM, fontSize: CELL, color: GRAY, minWidth: 0, lineHeight: 1.35 }}>
          vs S&P 500 · Acct {acct} · SPY {spy}
        </div>
        <button
          type="button"
          aria-label="S&P 500 comparison"
          aria-expanded={props.infoOpen}
          onClick={props.onInfo}
          style={{
            flexShrink: 0,
            width: 44,
            height: 44,
            background: "transparent",
            border: "none",
            color: GOLD,
            fontSize: CELL,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          i
        </button>
      </div>
      {props.infoOpen ? (
        <p style={{ margin: "0 0 8px", color: GRAY, fontSize: CELL, lineHeight: 1.4 }}>{comparison.footnote}</p>
      ) : null}
      {comparison.openPositions > 0 ? (
        <div style={{ ...NUM, fontSize: CELL, color: DIM, marginTop: 4, lineHeight: 1.35 }}>
          {comparison.openPositions} open · unrealized {money(comparison.unrealizedPnl)} at mid, not in the figure above
        </div>
      ) : null}

      {metrics ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", marginTop: 16, borderTop: `1px solid ${BORDER}` }}>
            <Metric label="Expectancy" value={money(metrics.expectancy)} color={toneColor(metrics.expectancy)} />
            <Metric label="Profit factor" value={pf(metrics.profitFactor)} />
            <Metric label="% closed positive" value={pctClosed(metrics.pctClosedPositive)} last />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}` }}>
            <Metric label="Avg gain" value={money(metrics.avgGain)} color={toneColor(metrics.avgGain)} />
            <Metric label="Avg loss" value={money(metrics.avgLoss)} color={toneColor(metrics.avgLoss)} />
            <Metric label="Closed DD" value={money(metrics.maxDrawdown)} color={toneColor(metrics.maxDrawdown)} last />
          </div>
          <div style={{ ...NUM, fontSize: CELL, color: GRAY, padding: "10px 0", lineHeight: 1.35 }}>
            Fees {unsignedMoney(metrics.fees)}
          </div>
        </>
      ) : null}

      {equity || options ? (
        <div style={{ paddingTop: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <AssetStat label="Equities" net={equity?.netPnl ?? null} trades={equity?.trades ?? 0} expectancy={equity?.expectancy ?? null} />
            <AssetStat label="Options" net={options?.netPnl ?? null} trades={options?.trades ?? 0} expectancy={options?.expectancy ?? null} />
          </div>
          <SplitBar left={equity?.netPnl ?? 0} right={options?.netPnl ?? 0} />
        </div>
      ) : null}

      {payload.underlyings && payload.underlyings.length > 0 ? (
        <div
          style={{
            display: "flex",
            gap: 20,
            overflowX: "auto",
            margin: "16px -12px 0",
            padding: "0 12px 4px",
            scrollbarWidth: "none",
          }}
        >
          {payload.underlyings.map((row) => (
            <div key={row.symbol} style={{ flex: "0 0 auto", minHeight: 48, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ fontSize: CELL, fontWeight: 600, color: WHITE }}>{row.symbol}</div>
              <div style={{ ...NUM, fontSize: CELL, color: toneColor(row.netPnl), lineHeight: 1.3 }}>
                {money(row.netPnl)}
                <span style={{ color: GRAY, fontWeight: 400 }}> · {row.trades}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ marginTop: 8 }}>
        {payload.strategies.map((row) => {
          const open = props.openKey === row.key;
          const slice = payload.byStrategy[row.key];
          return (
            <div key={row.key} style={{ borderTop: `1px solid ${BORDER}` }}>
              <button
                type="button"
                onClick={() => props.onOpen(row.key)}
                aria-expanded={open}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) auto",
                  gap: 12,
                  width: "100%",
                  minHeight: 64,
                  padding: "12px 0",
                  background: "transparent",
                  border: "none",
                  color: WHITE,
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: ARCH, fontWeight: 600, lineHeight: 1.25 }}>{row.label}</span>
                    {row.trades < 10 ? (
                      <span style={{ flexShrink: 0, fontSize: CELL, color: DIM }}>n={row.trades}</span>
                    ) : null}
                  </span>
                  <span style={{ ...NUM, display: "block", fontSize: CELL, color: GRAY, marginTop: 4, lineHeight: 1.3 }}>
                    {row.trades} {row.trades === 1 ? "trade" : "trades"} · exp {money(row.expectancy)}
                  </span>
                </span>
                <span style={{ ...NUM, fontSize: ARCH, fontWeight: 600, color: toneColor(row.netPnl), alignSelf: "center", lineHeight: 1.2 }}>
                  {money(row.netPnl)}
                </span>
              </button>
              {open && slice ? <StrategyDetail slice={slice} /> : null}
            </div>
          );
        })}
      </div>

      {takeaway ? (
        <p style={{ margin: "16px 0 0", color: GRAY, fontSize: CELL, lineHeight: 1.4 }}>{takeaway}</p>
      ) : null}
    </div>
  );
}

function Metric(props: { label: string; value: string; color?: string; last?: boolean }) {
  return (
    <div style={{ padding: "12px 8px 12px 0", borderRight: props.last ? "none" : `1px solid ${BORDER}`, minWidth: 0 }}>
      <div style={{ fontSize: CELL, color: GRAY, lineHeight: 1.3 }}>{props.label}</div>
      <div style={{ ...NUM, fontSize: ARCH, fontWeight: 600, color: props.color ?? WHITE, marginTop: 4, lineHeight: 1.2 }}>{props.value}</div>
    </div>
  );
}

function AssetStat(props: { label: string; net: number | null; trades: number; expectancy: number | null }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: CELL, color: GRAY }}>{props.label}</div>
      <div style={{ ...NUM, fontSize: ARCH, fontWeight: 600, color: toneColor(props.net), lineHeight: 1.2 }}>{money(props.net)}</div>
      <div style={{ ...NUM, fontSize: CELL, color: GRAY, lineHeight: 1.35 }}>
        {props.trades} {props.trades === 1 ? "trade" : "trades"} · exp {money(props.expectancy)}
      </div>
    </div>
  );
}

function SplitBar({ left, right }: { left: number; right: number }) {
  const a = Math.abs(left);
  const b = Math.abs(right);
  if (a + b === 0) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: `${a}fr ${b}fr`, gap: 3, height: 6, marginTop: 10 }}>
      <div style={{ background: toneColor(left) }} />
      <div style={{ background: toneColor(right) }} />
    </div>
  );
}

function monthLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "America/New_York" }).format(date).toUpperCase();
}

function Sparkline({ points: curve, color }: { points: CurvePoint[]; color: string }) {
  if (curve.length < 2) return null;
  const vals = curve.map((point) => point.cum);
  const min = Math.min(0, ...vals);
  const max = Math.max(0, ...vals);
  const span = max - min || 1;
  const w = 400;
  const h = 120;
  const coords = vals.map((value, index) => {
    const x = (index / (vals.length - 1)) * w;
    const y = h - ((value - min) / span) * (h - 8) - 4;
    return { x, y };
  });
  const line = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const zeroY = h - ((0 - min) / span) * (h - 8) - 4;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: CELL, color: GRAY, lineHeight: 1.3 }}>Cumulative realized P/L</div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={120} preserveAspectRatio="none" aria-hidden style={{ display: "block", marginTop: 8 }}>
        <line x1={0} x2={w} y1={zeroY} y2={zeroY} stroke={TRACK} strokeWidth={1} />
        <path d={area} fill={color} opacity={0.22} />
        <path d={line} fill="none" stroke={color} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: CELL, color: GRAY, marginTop: 4 }}>
        <span>{monthLabel(curve[0].at)}</span>
        <span>{monthLabel(curve[curve.length - 1].at)}</span>
      </div>
    </div>
  );
}

function withTrades(rows: CutStat[] | undefined): CutStat[] {
  return (rows ?? []).filter((row) => row.trades > 0);
}

function StrategyDetail({ slice }: { slice: InsightSlice }) {
  const hours = withTrades(slice.hourCuts);
  const groups: { title: string; rows: CutStat[] }[] = [
    { title: "Time of day", rows: hours.length > 0 ? hours : withTrades(slice.timeCuts) },
    { title: "Hold", rows: withTrades(slice.holdingCuts) },
    { title: "DTE", rows: withTrades(slice.dteCuts) },
    { title: "Day", rows: withTrades(slice.dayCuts) },
  ].filter((group) => group.rows.length > 0);
  const hold = slice.holdSummary;

  return (
    <div style={{ padding: "0 0 8px 0" }}>
      {hold && (hold.avgPositiveMin != null || hold.avgNegativeMin != null) ? (
        <div style={{ ...NUM, fontSize: CELL, color: GRAY, lineHeight: 1.4, paddingBottom: 8 }}>
          Avg positive hold {holdPhrase(hold.avgPositiveMin)} · Avg negative hold {holdPhrase(hold.avgNegativeMin)}
        </div>
      ) : null}
      {groups.length === 0 ? (
        <div style={{ padding: "8px 0", color: GRAY, fontSize: CELL }}>{EMPTY_CLOSED}</div>
      ) : (
        groups.map((group) => (
          <div key={group.title} style={{ paddingTop: 8 }}>
            <div style={{ fontSize: ARCH, fontWeight: 600, color: WHITE, lineHeight: 1.3 }}>{group.title}</div>
            {group.rows.map((row) => (
              <CutRow key={`${group.title}-${row.key}`} row={row} />
            ))}
          </div>
        ))
      )}
      {slice.recordedLine ? (
        <div style={{ fontSize: CELL, color: DIM, paddingTop: 8, lineHeight: 1.4 }}>{slice.recordedLine}</div>
      ) : null}
      {slice.perspective ? (
        <p style={{ margin: "8px 0 0", color: GRAY, fontSize: CELL, lineHeight: 1.4 }}>{slice.perspective}</p>
      ) : null}
    </div>
  );
}

function CutRow({ row }: { row: CutStat }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: `1px solid ${BORDER}` }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: CELL, color: WHITE, lineHeight: 1.3 }}>{row.label}</div>
        <div style={{ ...NUM, fontSize: CELL, color: GRAY, lineHeight: 1.3 }}>
          {row.trades} {row.trades === 1 ? "trade" : "trades"} · exp {money(row.expectancy)}
        </div>
      </div>
      <div style={{ ...NUM, fontSize: ARCH, fontWeight: 600, color: toneColor(row.netPnl), flexShrink: 0 }}>{money(row.netPnl)}</div>
    </div>
  );
}
