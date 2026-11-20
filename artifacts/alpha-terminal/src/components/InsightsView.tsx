import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useQuote } from "@/hooks/useQuote";
import { formatAtGlanceSpot } from "@/lib/active-trader/atGlanceSpotFormat";
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

type CutId = "hour" | "hold" | "dte" | "day";

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
  const [cut, setCut] = useState<CutId>("hour");
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
    void props.subscribeEquitySymbols?.(["/ES", "/YM", "/NQ"]);
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
          <span style={{ fontSize: 15, fontWeight: 600, color: "#f4f4f5", letterSpacing: -0.2 }}>{accountLabel}</span>
          <ChevronDown className="h-4 w-4 shrink-0" style={{ color: "#71717a" }} />
        </button>
        {paper ? (
          <div style={{ padding: "0 12px 8px", color: PUT_WALL, fontSize: 12, fontWeight: 600, letterSpacing: 0.4 }}>
            PAPER SANDBOX · Simulated fills
          </div>
        ) : null}
        <div style={{ padding: "2px 12px 0" }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.8, color: GOLD }}>
            FUTURES · {sessionLabel}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, padding: "6px 0 2px" }}>
            {FUTS.map((fut) => (
              <FuturesQuote key={fut.symbol} symbol={fut.symbol} name={fut.name} />
            ))}
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
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        {syncNote ? <div style={{ padding: "0 12px 8px", color: DIM, fontSize: 11 }}>{syncNote}</div> : null}
      </div>

      {loading && !payload ? <div style={{ padding: 16, color: GRAY, fontSize: 13 }}>Loading</div> : null}
      {error ? (
        <div style={{ padding: 16 }}>
          <div style={{ color: GRAY, fontSize: 13 }}>{error}</div>
          <button
            type="button"
            onClick={() => void load(period, accountId)}
            style={{ minHeight: 44, marginTop: 4, padding: "0 4px", background: "transparent", border: "none", color: GOLD, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            Retry
          </button>
        </div>
      ) : null}

      {payload?.empty ? (
        <div style={{ padding: "16px 12px", color: GRAY, fontSize: 13 }}>{payload.emptyMessage ?? EMPTY_CLOSED}</div>
      ) : null}

      {payload && !payload.empty && payload.headline ? (
        <Results
          payload={payload}
          infoOpen={infoOpen}
          onInfo={() => setInfoOpen((open) => !open)}
          openKey={openKey}
          cut={cut}
          onOpen={(key) => {
            setOpenKey((current) => (current === key ? null : key));
            setCut("hour");
          }}
          onCut={setCut}
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
                <div style={{ padding: "12px 12px 4px", fontSize: 11, fontWeight: 600, letterSpacing: 0.6, color: GRAY }}>
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
                        fontSize: 14,
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
                      {selected ? <span style={{ color: GOLD, fontSize: 12 }}>Selected</span> : null}
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
      <div style={{ fontSize: 11, color: GRAY, fontWeight: 600 }}>{name}</div>
      <div style={{ ...NUM, fontSize: 14, color: WHITE, fontWeight: 600, whiteSpace: "nowrap" }}>
        {formatAtGlanceSpot(symbol, last)}
      </div>
      <div style={{ ...NUM, fontSize: 12, fontWeight: 600, color: toneColor(change), whiteSpace: "nowrap" }}>
        {points(change, symbol)}
      </div>
    </div>
  );
}

function Results(props: {
  payload: InsightsPayload;
  infoOpen: boolean;
  onInfo: () => void;
  openKey: string | null;
  cut: CutId;
  onOpen: (key: string) => void;
  onCut: (cut: CutId) => void;
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
  const maxAbs = Math.max(1, ...payload.strategies.map((row) => Math.abs(row.netPnl)));
  const takeaway = payload.takeaway;

  return (
    <div style={{ padding: "12px 12px 28px", minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.8, color }}>{headline.label}</div>
      <div style={{ ...NUM, fontSize: 22, fontWeight: 400, color, lineHeight: 1.15, marginTop: 2 }}>
        {money(headline.netPnl)}
      </div>
      <div style={{ fontSize: 11, color: GRAY, marginTop: 2 }}>
        Net after fees · {headline.closedTrades} closed
      </div>
      <Sparkline points={payload.account?.curve ?? []} color={color} />

      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 8, minWidth: 0 }}>
        <div style={{ ...NUM, fontSize: 11, color: GRAY, minWidth: 0 }}>
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
            margin: "-10px -8px -10px 0",
            background: "transparent",
            border: "none",
            color: GOLD,
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          i
        </button>
      </div>
      {props.infoOpen ? (
        <p style={{ margin: "0 0 4px", color: GRAY, fontSize: 12, lineHeight: 1.45 }}>{comparison.footnote}</p>
      ) : null}
      {comparison.openPositions > 0 ? (
        <div style={{ ...NUM, fontSize: 11, color: DIM, marginTop: 2 }}>
          {comparison.openPositions} open · unrealized {money(comparison.unrealizedPnl)} at mid, not in the figure above
        </div>
      ) : null}

      {metrics ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", marginTop: 12, borderTop: `1px solid ${BORDER}` }}>
            <Metric label="Expectancy" value={money(metrics.expectancy)} color={toneColor(metrics.expectancy)} />
            <Metric label="Profit factor" value={pf(metrics.profitFactor)} />
            <Metric label="% closed positive" value={pctClosed(metrics.pctClosedPositive)} last />
          </div>
          <div style={{ ...NUM, fontSize: 11, color: GRAY, padding: "8px 0", borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}` }}>
            Avg gain {money(metrics.avgGain)} · Avg loss {money(metrics.avgLoss)} · Closed DD {money(metrics.maxDrawdown)} · Fees {unsignedMoney(metrics.fees)}
          </div>
        </>
      ) : null}

      {equity || options ? (
        <div style={{ paddingTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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
            gap: 14,
            overflowX: "auto",
            margin: "12px -12px 0",
            padding: "0 12px",
            scrollbarWidth: "none",
          }}
        >
          {payload.underlyings.map((row) => (
            <div key={row.symbol} style={{ flex: "0 0 auto", minHeight: 44, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: WHITE }}>{row.symbol}</div>
              <div style={{ ...NUM, fontSize: 12, color: toneColor(row.netPnl) }}>
                {money(row.netPnl)}
                <span style={{ color: GRAY, fontWeight: 400 }}> · {row.trades}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ marginTop: 4 }}>
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
                  gap: 8,
                  width: "100%",
                  minHeight: 44,
                  padding: "8px 0",
                  background: "transparent",
                  border: "none",
                  color: WHITE,
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {row.label}
                    </span>
                    {row.trades < 10 ? (
                      <span style={{ flexShrink: 0, fontSize: 11, color: DIM }}>n={row.trades}</span>
                    ) : null}
                  </span>
                  <span style={{ ...NUM, display: "block", fontSize: 11, color: GRAY, marginTop: 2 }}>
                    {row.trades} {row.trades === 1 ? "trade" : "trades"} · exp {money(row.expectancy)}
                  </span>
                  <span aria-hidden style={{ display: "block", height: 3, marginTop: 6, background: TRACK }}>
                    <span style={{ display: "block", height: "100%", width: `${Math.max(4, (Math.abs(row.netPnl) / maxAbs) * 100)}%`, background: toneColor(row.netPnl) }} />
                  </span>
                </span>
                <span style={{ ...NUM, fontSize: 13, fontWeight: 600, color: toneColor(row.netPnl), alignSelf: "center" }}>
                  {money(row.netPnl)}
                  <span style={{ color: GRAY, fontWeight: 400, marginLeft: 4 }}>{open ? "\u2039" : "\u203a"}</span>
                </span>
              </button>
              {open && slice ? (
                <StrategyCuts slice={slice} cut={props.cut} onCut={props.onCut} />
              ) : null}
            </div>
          );
        })}
      </div>

      {takeaway ? (
        <p style={{ margin: "12px 0 0", color: GRAY, fontSize: 12, lineHeight: 1.45 }}>{takeaway}</p>
      ) : null}
    </div>
  );
}

function Metric(props: { label: string; value: string; color?: string; last?: boolean }) {
  return (
    <div style={{ padding: "8px 8px 8px 0", borderRight: props.last ? "none" : `1px solid ${BORDER}`, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: GRAY }}>{props.label}</div>
      <div style={{ ...NUM, fontSize: 13, fontWeight: 600, color: props.color ?? WHITE, marginTop: 2 }}>{props.value}</div>
    </div>
  );
}

function AssetStat(props: { label: string; net: number | null; trades: number; expectancy: number | null }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: GRAY }}>{props.label}</div>
      <div style={{ ...NUM, fontSize: 14, fontWeight: 600, color: toneColor(props.net) }}>{money(props.net)}</div>
      <div style={{ ...NUM, fontSize: 11, color: GRAY }}>
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
    <div style={{ display: "grid", gridTemplateColumns: `${a}fr ${b}fr`, gap: 2, height: 4, marginTop: 8, background: "transparent" }}>
      <div style={{ background: toneColor(left) }} />
      <div style={{ background: toneColor(right) }} />
    </div>
  );
}

function Sparkline({ points: curve, color }: { points: CurvePoint[]; color: string }) {
  if (curve.length < 2) return null;
  const vals = curve.map((point) => point.cum);
  const min = Math.min(0, ...vals);
  const max = Math.max(0, ...vals);
  const span = max - min || 1;
  const w = 400;
  const h = 36;
  const d = vals
    .map((value, index) => {
      const x = (index / (vals.length - 1)) * w;
      const y = h - ((value - min) / span) * (h - 2) - 1;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const zeroY = h - ((0 - min) / span) * (h - 2) - 1;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={36} preserveAspectRatio="none" aria-hidden style={{ display: "block", marginTop: 8 }}>
      <line x1={0} x2={w} y1={zeroY} y2={zeroY} stroke={TRACK} strokeWidth={1} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function StrategyCuts(props: { slice: InsightSlice; cut: CutId; onCut: (cut: CutId) => void }) {
  const tabs: { id: CutId; label: string }[] = [
    { id: "hour", label: "Hour" },
    { id: "hold", label: "Hold" },
    { id: "dte", label: "DTE" },
    { id: "day", label: "Day" },
  ];
  const hourly = props.slice.hourCuts ?? [];
  const summary = props.cut === "hour" ? props.slice.timeCuts : [];
  const rows = props.cut === "hour"
    ? hourly
    : props.cut === "hold"
      ? props.slice.holdingCuts
      : props.cut === "dte"
        ? (props.slice.dteCuts ?? [])
        : props.slice.dayCuts;
  const maxAbs = Math.max(1, ...summary.map((row) => Math.abs(row.netPnl)), ...rows.map((row) => Math.abs(row.netPnl)));
  const hold = props.slice.holdSummary;

  return (
    <div style={{ padding: "0 0 10px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)" }}>
        {tabs.map((tab) => {
          const on = props.cut === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => props.onCut(tab.id)}
              aria-pressed={on}
              style={{
                minHeight: 44,
                background: "transparent",
                border: "none",
                borderBottom: on ? `2px solid ${GOLD}` : "2px solid transparent",
                color: on ? WHITE : GRAY,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {props.cut === "hold" && hold ? (
        <div style={{ ...NUM, fontSize: 11, color: GRAY, paddingTop: 8 }}>
          Avg positive hold {holdPhrase(hold.avgPositiveMin)} · Avg negative hold {holdPhrase(hold.avgNegativeMin)}
        </div>
      ) : null}
      {summary.map((row) => (
        <CutRow key={row.key} row={row} maxAbs={maxAbs} />
      ))}
      {rows.length === 0 && summary.length === 0 ? (
        <div style={{ padding: "8px 0", color: GRAY, fontSize: 12 }}>{EMPTY_CLOSED}</div>
      ) : (
        rows.map((row) => <CutRow key={row.key} row={row} maxAbs={maxAbs} />)
      )}
      {props.slice.recordedLine ? (
        <div style={{ fontSize: 11, color: DIM, paddingTop: 6 }}>{props.slice.recordedLine}</div>
      ) : null}
      {props.slice.perspective ? (
        <p style={{ margin: "8px 0 0", color: GRAY, fontSize: 12, lineHeight: 1.45 }}>{props.slice.perspective}</p>
      ) : null}
    </div>
  );
}

function CutRow({ row, maxAbs }: { row: CutStat; maxAbs: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) auto", gap: 8, padding: "7px 0", borderTop: `1px solid ${BORDER}` }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: WHITE }}>{row.label}</div>
        <div style={{ ...NUM, fontSize: 11, color: GRAY }}>
          {row.trades} {row.trades === 1 ? "trade" : "trades"} · exp {money(row.expectancy)}
        </div>
        <div aria-hidden style={{ height: 3, marginTop: 5, background: TRACK }}>
          <div style={{ height: "100%", width: `${Math.max(4, (Math.abs(row.netPnl) / maxAbs) * 100)}%`, background: toneColor(row.netPnl) }} />
        </div>
      </div>
      <div style={{ ...NUM, fontSize: 13, fontWeight: 600, color: toneColor(row.netPnl), alignSelf: "center" }}>{money(row.netPnl)}</div>
    </div>
  );
}
