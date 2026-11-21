import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  BENCHMARK_UNAVAILABLE,
  holdPhrase,
  money,
  signColor,
  signedPct,
  unsignedMoney,
  type InsightSlice,
  type InsightsPayload,
  type JournalBook,
  type JournalPeriod,
  type JournalView,
  type PositionView,
} from "./journalModel";

const C = {
  bg: "#0c0c0c",
  card: "#18181b",
  border: "#27272a",
  text: "#e4e4e7",
  muted: "#a1a1aa",
  dim: "#71717a",
  green: "#00d166",
  red: "#dc2626",
  paper: "#22d3ee",
};

const PERIODS: { id: JournalPeriod; label: string }[] = [
  { id: "30d", label: "30D" },
  { id: "90d", label: "90D" },
  { id: "ytd", label: "YTD" },
  { id: "lifetime", label: "All" },
];

const FORMATS = [
  { id: "schwab", label: "Schwab" },
  { id: "webull", label: "Webull" },
  { id: "generic", label: "Generic CSV" },
];

export function JournalScreen(props: {
  payload: InsightsPayload | null;
  loading: boolean;
  error: string | null;
  period: JournalPeriod;
  onPeriod: (period: JournalPeriod) => void;
  view: JournalView;
  onView: (view: JournalView) => void;
  strategy: string | null;
  onStrategy: (strategy: string | null) => void;
  onRetry?: () => void;
  exampleBanner?: boolean;
  accountId?: string;
  onAccount?: (id: string) => void;
  syncNote?: string | null;
  onImportCsv?: (input: { format: string; accountId: string; csv: string }) => Promise<{ importedTrades: number; skippedDuplicates: number } | { error: string }>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const overviewScrollRef = useRef<number | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [stickyTop, setStickyTop] = useState(0);
  const [tradeQuery, setTradeQuery] = useState("");
  const accountId = props.accountId ?? props.payload?.accountId ?? "all_live";
  const books = props.payload?.books ?? [];

  useLayoutEffect(() => {
    const head = document.querySelector("[data-pf-sticky-head]");
    if (head instanceof HTMLElement) setStickyTop(head.offsetHeight);
  }, []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const scroller = nearestScrollParent(root);
    if (!scroller) return;
    if (props.strategy) {
      scroller.scrollTop = 0;
      return;
    }
    if (overviewScrollRef.current != null) {
      scroller.scrollTop = overviewScrollRef.current;
      overviewScrollRef.current = null;
    }
  }, [props.strategy]);

  function openStrategy(key: string) {
    const scroller = rootRef.current ? nearestScrollParent(rootRef.current) : null;
    if (scroller) overviewScrollRef.current = scroller.scrollTop;
    props.onStrategy(key);
  }

  const accountLabel = books.find((book) => book.id === accountId)?.label
    ?? (accountId === "paper_sandbox" ? "Paper Sandbox" : accountId === "all_live" ? "All Live" : "Account");

  return (
    <div ref={rootRef} data-journal-root="" style={{ color: C.text, fontFamily: "inherit", fontSize: 16 }}>
      {props.exampleBanner && (
        <div style={{ background: "#FFB800", color: "#1a1400", textAlign: "center", fontSize: 16, fontWeight: 800, letterSpacing: 0.6, padding: "6px 10px" }}>
          EXAMPLE DATA — NOT ACCOUNT FIGURES
        </div>
      )}
      {props.payload?.paper && (
        <div style={{ margin: "8px 12px 0", padding: "8px 10px", background: "#083344", color: C.paper, fontSize: 16, letterSpacing: 0.4 }}>
          PAPER SANDBOX · Simulated fills
        </div>
      )}
      <div style={{ position: "sticky", top: stickyTop, zIndex: 5, background: C.bg, padding: "8px 12px", borderBottom: `1px solid ${C.border}` }}>
        {props.strategy ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              aria-label="Back"
              onClick={() => props.onStrategy(null)}
              style={{ minWidth: 44, minHeight: 44, padding: 0, background: "transparent", color: C.text, border: "none", fontSize: 18, cursor: "pointer" }}
            >
              ‹
            </button>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{props.strategy}</div>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Segmented value={props.view} onChange={props.onView} />
            <button type="button" onClick={() => setAccountOpen(true)} style={pill}>
              <span style={{ width: 8, height: 8, borderRadius: 8, background: props.payload?.paper ? C.paper : C.green, display: "inline-block" }} />
              {accountLabel}
            </button>
            <button type="button" onClick={() => setCsvOpen(true)} style={pill}>CSV</button>
          </div>
        )}
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          {PERIODS.map((period) => (
            <button key={period.id} type="button" onClick={() => props.onPeriod(period.id)} style={{ ...pill, minHeight: 44, background: props.period === period.id ? "#27272a" : "transparent" }}>
              {period.label}
            </button>
          ))}
        </div>
        {props.syncNote && <div style={{ marginTop: 6, color: C.dim, fontSize: 16 }}>{props.syncNote}</div>}
      </div>

      {props.loading && !props.payload && <div style={{ padding: 16, color: C.muted }}>Loading journal…</div>}
      {props.error && (
        <div style={{ padding: 16 }}>
          <div style={{ color: C.muted }}>{props.error}</div>
          {props.onRetry ? <button type="button" onClick={props.onRetry} style={{ ...pill, marginTop: 8 }}>Retry</button> : null}
        </div>
      )}
      {props.payload && !props.strategy && props.view === "insights" && (
        <AccountInsights payload={props.payload} onStrategy={openStrategy} onInfo={() => setInfoOpen(true)} onSymbol={(symbol) => { setTradeQuery(symbol); props.onView("trades"); }} />
      )}
      {props.payload && props.strategy && (
        <Drilldown payload={props.payload} strategy={props.strategy} onTrades={() => { setTradeQuery(props.strategy ?? ""); props.onStrategy(null); props.onView("trades"); }} />
      )}
      {props.payload && !props.strategy && props.view === "trades" && (
        <TradesList payload={props.payload} period={props.period} query={tradeQuery} onQuery={setTradeQuery} onImport={() => setCsvOpen(true)} />
      )}

      {accountOpen && (
        <Sheet title="Account" onClose={() => setAccountOpen(false)}>
          {accountChoices(books).map((book) => (
            <button key={book.id} type="button" onClick={() => { props.onAccount?.(book.id); setAccountOpen(false); }} style={sheetRow}>
              <span style={{ width: 8, height: 8, borderRadius: 8, background: book.paper ? C.paper : C.green }} />
              <span>{book.label}</span>
              {book.id === accountId && <span style={{ marginLeft: "auto", color: C.dim }}>Selected</span>}
            </button>
          ))}
        </Sheet>
      )}
      {csvOpen && props.onImportCsv && (
        <CsvSheet
          books={accountChoices(books).filter((book) => book.id !== "all_live")}
          onClose={() => setCsvOpen(false)}
          onImport={props.onImportCsv}
        />
      )}
      {infoOpen && props.payload && (
        <Sheet title="S&P 500 comparison" onClose={() => setInfoOpen(false)}>
          <p style={{ color: C.muted, fontSize: 16, lineHeight: 1.45, margin: "8px 12px 16px" }}>{props.payload.comparison.footnote}</p>
        </Sheet>
      )}
    </div>
  );
}

function accountChoices(books: JournalBook[]): JournalBook[] {
  if (books.length > 0) return books;
  return [
    { id: "all_live", label: "All Live Accounts", paper: false },
    { id: "paper_sandbox", label: "Paper Sandbox", paper: true },
  ];
}

function AccountInsights(props: { payload: InsightsPayload; onStrategy: (key: string) => void; onInfo: () => void; onSymbol: (symbol: string) => void }) {
  const payload = props.payload;
  const metrics = payload.account?.metrics;
  const maxAbs = Math.max(1, ...payload.strategies.map((row) => Math.abs(row.netPnl)));
  return (
    <div style={{ padding: "12px 12px 28px" }}>
      <div data-journal-headline="" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 16, letterSpacing: 1, color: payload.headline ? signColor(payload.headline.netPnl) : C.muted }}>{payload.headline?.label ?? "FLAT"}</div>
          <div style={{ fontSize: 34, fontWeight: 650, letterSpacing: -0.8, color: payload.headline ? signColor(payload.headline.netPnl) : C.text }}>{payload.headline ? money(payload.headline.netPnl) : "—"}</div>
          <div style={{ color: C.muted, fontSize: 16 }}>Net after fees · {payload.headline?.closedTrades ?? 0} closed trades</div>
        </div>
        <Spark points={payload.account?.curve ?? []} />
      </div>
      <button type="button" data-journal-benchmark="" onClick={props.onInfo} style={{ marginTop: 8, background: "transparent", border: "none", color: C.muted, fontSize: 16, textAlign: "left", padding: 0, minHeight: 44 }}>
        <BenchmarkLine payload={payload} />
      </button>
      {payload.empty && <div data-journal-empty="" style={{ marginTop: 16, color: C.muted }}>{payload.emptyMessage}</div>}
      {metrics && <MetricStrip metrics={metrics} />}
      {payload.assetClasses.length > 0 && <AssetSplit rows={payload.assetClasses} />}
      {(payload.underlyings?.length ?? 0) > 0 && (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", marginTop: 14, paddingBottom: 4 }}>
          {payload.underlyings?.map((row) => (
            <button key={row.symbol} type="button" onClick={() => props.onSymbol(row.symbol)} style={{ ...pill, flex: "0 0 auto" }}>
              {row.symbol} · {row.trades} · {money(row.netPnl)}
            </button>
          ))}
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        {payload.strategies.map((row) => (
          <button key={row.key} type="button" onClick={() => props.onStrategy(row.key)} style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", borderTop: `1px solid ${C.border}`, color: C.text, padding: "12px 0", minHeight: 44, cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{row.label}{row.trades < 10 ? <span style={{ color: C.dim }}> n={row.trades}</span> : null}</span>
              <span style={{ color: signColor(row.netPnl) }}>{money(row.netPnl)} ›</span>
            </div>
            <div style={{ color: C.dim, fontSize: 16, marginTop: 4 }}>{row.trades} trades · exp {row.expectancy == null ? "—" : money(row.expectancy)}</div>
            <div style={{ marginTop: 6, height: 3, background: "#27272a" }}>
              <div style={{ width: `${Math.min(100, (Math.abs(row.netPnl) / maxAbs) * 100)}%`, height: 3, background: signColor(row.netPnl) }} />
            </div>
          </button>
        ))}
      </div>
      {payload.takeaway && <p style={{ color: C.muted, fontSize: 16, lineHeight: 1.45 }}>{payload.takeaway}</p>}
    </div>
  );
}

function BenchmarkLine(props: { payload: InsightsPayload }) {
  const account = props.payload.comparison.accountReturn == null ? "Unavailable" : signedPct(props.payload.comparison.accountReturn);
  return (
    <>
      <span>vs S&P 500 · Acct: {account} · </span>
      {props.payload.comparison.benchmarkStatus === "unavailable"
        ? <span>{BENCHMARK_UNAVAILABLE}</span>
        : <span>SPY {signedPct(props.payload.comparison.benchmarkReturn)}</span>}
    </>
  );
}

function MetricStrip(props: { metrics: InsightSlice["metrics"] }) {
  const metrics = props.metrics;
  const pct = metrics.pctClosedPositive == null ? "—" : `${(metrics.pctClosedPositive * 100).toFixed(1)}%`;
  return (
    <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <Cell label="Expectancy" value={metrics.expectancy == null ? "—" : money(metrics.expectancy)} color={signColor(metrics.expectancy)} />
        <Cell label="Profit Factor" value={metrics.profitFactor == null ? "n/a" : metrics.profitFactor.toFixed(2)} />
        <Cell label="% Closed Positive" value={pct} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <Cell label="Avg Gain / Avg Loss" value={`${metrics.avgGain == null ? "—" : money(metrics.avgGain)} / ${metrics.avgLoss == null ? "—" : money(metrics.avgLoss)}`} />
        <Cell label="Closed DD" value={metrics.maxDrawdown == null ? "—" : money(metrics.maxDrawdown)} color={signColor(metrics.maxDrawdown)} />
        <Cell label="Fees" value={unsignedMoney(metrics.fees)} />
      </div>
    </div>
  );
}

function Cell(props: { label: string; value: string; color?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 16, letterSpacing: 0.4, color: C.dim }}>{props.label}</div>
      <div style={{ fontSize: 16, color: props.color ?? C.text, fontVariantNumeric: "tabular-nums" }}>{props.value}</div>
    </div>
  );
}

function AssetSplit(props: { rows: InsightsPayload["assetClasses"] }) {
  const total = props.rows.reduce((sum, row) => sum + row.trades, 0) || 1;
  return (
    <div style={{ marginTop: 14 }}>
      {props.rows.map((row) => (
        <div key={row.key} style={{ display: "flex", justifyContent: "space-between", color: C.muted, fontSize: 16, marginBottom: 4 }}>
          <span>{row.label}</span>
          <span>{row.trades} · exp {row.expectancy == null ? "—" : money(row.expectancy)}</span>
        </div>
      ))}
      <div style={{ display: "flex", height: 4, background: "#27272a" }}>
        {props.rows.map((row) => (
          <div key={row.key} style={{ width: `${(row.trades / total) * 100}%`, background: row.key === "equity" ? "#a1a1aa" : C.green }} />
        ))}
      </div>
    </div>
  );
}

function Drilldown(props: { payload: InsightsPayload; strategy: string; onTrades: () => void }) {
  const slice = props.payload.byStrategy[props.strategy];
  const [tab, setTab] = useState<"hour" | "hold" | "dte" | "day">("hour");
  if (!slice) return <div data-journal-drill="" style={{ padding: 16, color: C.muted }}>No closed trades in this period.</div>;
  const cuts = tab === "hour" ? slice.hourCuts : tab === "hold" ? slice.holdingCuts : tab === "dte" ? slice.dteCuts : slice.dayCuts;
  const hold = slice.holdSummary;
  return (
    <div data-journal-drill="" style={{ padding: "12px 12px 28px" }}>
      <div data-journal-headline="" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 16, letterSpacing: 1, color: signColor(slice.metrics.netPnl) }}>{slice.metrics.netPnl > 0 ? "IN THE BLACK" : slice.metrics.netPnl < 0 ? "IN THE RED" : "FLAT"}</div>
          <div style={{ fontSize: 34, fontWeight: 650, color: signColor(slice.metrics.netPnl) }}>{money(slice.metrics.netPnl)}</div>
          <div style={{ color: C.muted, fontSize: 16 }}>Net after fees · {slice.metrics.closedTrades} closed trades</div>
        </div>
        <Spark points={slice.curve ?? []} />
      </div>
      <MetricStrip metrics={slice.metrics} />
      <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
        {(["hour", "hold", "dte", "day"] as const).map((key) => (
          <button key={key} type="button" onClick={() => setTab(key)} style={{ ...pill, minHeight: 44, background: tab === key ? "#27272a" : "transparent" }}>{key === "hour" ? "Hour" : key === "hold" ? "Hold" : key === "dte" ? "DTE" : "Day"}</button>
        ))}
      </div>
      {tab === "hold" && hold && (
        <div style={{ color: C.muted, fontSize: 16, marginTop: 8 }}>Avg Positive Hold: {holdPhrase(hold.avgPositiveMin)} · Avg Negative Hold: {holdPhrase(hold.avgNegativeMin)}</div>
      )}
      <div style={{ marginTop: 8 }}>
        {(cuts ?? []).filter((cut) => cut.trades > 0).map((cut) => (
          <div key={cut.key} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: `1px solid ${C.border}`, fontSize: 16 }}>
            <span>{cut.label} · {cut.trades}</span>
            <span style={{ color: signColor(cut.netPnl) }}>{money(cut.netPnl)}</span>
          </div>
        ))}
        {(cuts ?? []).every((cut) => cut.trades === 0) && <div style={{ color: C.muted, marginTop: 8 }}>No closed trades in this period.</div>}
      </div>
      {slice.recordedLine && <p style={{ color: C.muted, fontSize: 16 }}>{slice.recordedLine}</p>}
      <p style={{ color: C.muted, fontSize: 16, lineHeight: 1.45 }}>{drillSummary(props.strategy, slice)}</p>
      <div style={{ marginTop: 8 }}>
        {slice.closedTrades.map((trade) => (
          <div key={trade.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "8px 0", borderTop: `1px solid ${C.border}`, fontSize: 16 }}>
            <span>{trade.label}<div style={{ color: C.dim }}>{trade.detail}</div></span>
            <span style={{ color: signColor(trade.netPnl) }}>{money(trade.netPnl)}</span>
          </div>
        ))}
      </div>
      <button type="button" onClick={props.onTrades} style={{ ...pill, marginTop: 8 }}>Filter in Trades →</button>
    </div>
  );
}

function drillSummary(name: string, slice: InsightSlice): string {
  const fees = unsignedMoney(slice.metrics.fees);
  return `${name}: ${money(slice.metrics.netPnl)} net after fees on ${slice.metrics.closedTrades} closed trades. Fees totaled ${fees}.`;
}

function TradesList(props: { payload: InsightsPayload; period: JournalPeriod; query: string; onQuery: (query: string) => void; onImport: () => void }) {
  const query = props.query;
  const setQuery = props.onQuery;
  const [filter, setFilter] = useState<"all" | "positive" | "negative" | "options" | "equities" | "open">("all");
  const [sort, setSort] = useState<"newest" | "top_gain" | "top_loss">("newest");
  const [scope, setScope] = useState<"all" | "period">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const start = props.payload.comparison.windowStart;
  let rows = props.payload.positions.filter((row) => {
    const hay = `${row.label} ${row.strategy} ${row.underlying ?? ""}`.toLowerCase();
    if (query && !hay.includes(query.toLowerCase())) return false;
    if (filter === "positive") return (row.netPnl ?? 0) > 0;
    if (filter === "negative") return (row.netPnl ?? 0) < 0;
    if (filter === "options") return row.assetClass === "option";
    if (filter === "equities") return row.assetClass === "equity";
    if (filter === "open") return row.status === "open" || row.status === "partial";
    return true;
  });
  if (scope === "period" && start) {
    rows = rows.filter((row) => row.status === "open" || row.status === "partial" || (row.closedAt != null && row.closedAt >= start));
  }
  rows = rows.slice().sort((a, b) => {
    if (sort === "top_gain") return (b.netPnl ?? 0) - (a.netPnl ?? 0);
    if (sort === "top_loss") return (a.netPnl ?? 0) - (b.netPnl ?? 0);
    return (b.closedAt ?? b.openedAt).localeCompare(a.closedAt ?? a.openedAt);
  });
  return (
    <div style={{ padding: "12px 12px 28px" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Underlying or strategy" style={{ flex: 1, minHeight: 44, background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: "0 10px" }} />
        <button type="button" onClick={props.onImport} style={pill}>+ Import CSV</button>
      </div>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", marginTop: 8 }}>
        {(["all", "positive", "negative", "options", "equities", "open"] as const).map((key) => (
          <button key={key} type="button" onClick={() => setFilter(key)} style={{ ...pill, background: filter === key ? "#27272a" : "transparent" }}>{key === "all" ? "All" : key === "positive" ? "Positive" : key === "negative" ? "Negative" : key === "options" ? "Options" : key === "equities" ? "Equities" : "Open"}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        {([["newest", "Newest"], ["top_gain", "Top Win"], ["top_loss", "Top Loss"]] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setSort(key)} style={{ ...pill, background: sort === key ? "#27272a" : "transparent" }}>{label}</button>
        ))}
        <button type="button" onClick={() => setScope(scope === "all" ? "period" : "all")} style={pill}>{scope === "all" ? "All History" : props.period.toUpperCase()}</button>
      </div>
      {rows.length === 0 && <div style={{ color: C.muted, marginTop: 16 }}>No closed trades in this period.</div>}
      {rows.map((row) => (
        <TradeCard key={row.id} row={row} open={openId === row.id} onToggle={() => setOpenId(openId === row.id ? null : row.id)} />
      ))}
    </div>
  );
}

function TradeCard(props: { row: PositionView; open: boolean; onToggle: () => void }) {
  const row = props.row;
  return (
    <button type="button" onClick={props.onToggle} style={{ width: "100%", textAlign: "left", background: "transparent", color: C.text, border: "none", borderTop: `1px solid ${C.border}`, padding: "12px 0", minHeight: 44, cursor: "pointer" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span>{row.label}<div style={{ color: C.dim, fontSize: 16 }}>{row.strategy} · {row.statusLabel}</div></span>
        <span style={{ color: signColor(row.netPnl) }}>{row.netPnl == null ? "—" : money(row.netPnl)}</span>
      </div>
      {props.open && (
        <div style={{ marginTop: 8, color: C.muted, fontSize: 16 }}>
          <div>{row.detail}</div>
          <div>Fees {unsignedMoney(row.fees ?? null)}</div>
          <div style={{ color: row.excursion?.record === "full" ? C.muted : C.dim }}>{row.excursion?.label ?? "Not recorded"}</div>
        </div>
      )}
    </button>
  );
}

function Spark(props: { points: { cum: number }[] }) {
  if (props.points.length < 2) return null;
  const values = props.points.map((point) => point.cum);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const width = 112;
  const height = 40;
  const path = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - min) / span) * height;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const zero = height - ((0 - min) / span) * height;
  const last = values[values.length - 1] ?? 0;
  return (
    <svg width={width} height={height} aria-hidden="true">
      <line x1={0} x2={width} y1={zero} y2={zero} stroke="#27272a" />
      <path d={path} fill="none" stroke={last >= 0 ? C.green : C.red} strokeWidth={1.5} />
    </svg>
  );
}

function Segmented(props: { value: JournalView; onChange: (view: JournalView) => void }) {
  return (
    <div style={{ display: "flex", background: C.card, borderRadius: 8, padding: 2 }}>
      {(["insights", "trades"] as const).map((view) => (
        <button key={view} type="button" onClick={() => props.onChange(view)} style={{ minHeight: 44, padding: "0 12px", border: "none", borderRadius: 6, background: props.value === view ? "#3f3f46" : "transparent", color: C.text, cursor: "pointer" }}>
          {view === "insights" ? "Insights" : "Trades"}
        </button>
      ))}
    </div>
  );
}

function Sheet(props: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 40, display: "flex", alignItems: "flex-end" }} onClick={props.onClose}>
      <div onClick={(event) => event.stopPropagation()} style={{ width: "100%", background: C.card, borderTop: `1px solid ${C.border}`, borderRadius: "12px 12px 0 0", paddingBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px" }}>
          <div style={{ fontSize: 16 }}>{props.title}</div>
          <button type="button" onClick={props.onClose} style={{ ...pill, minWidth: 44 }}>Close</button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

function CsvSheet(props: {
  books: JournalBook[];
  onClose: () => void;
  onImport: (input: { format: string; accountId: string; csv: string }) => Promise<{ importedTrades: number; skippedDuplicates: number } | { error: string }>;
}) {
  const [format, setFormat] = useState("generic");
  const [accountId, setAccountId] = useState(props.books[0]?.id ?? "paper_sandbox");
  const [note, setNote] = useState<string | null>(null);
  return (
    <Sheet title="Import CSV" onClose={props.onClose}>
      <div style={{ display: "flex", gap: 6, padding: "0 12px", flexWrap: "wrap" }}>
        {FORMATS.map((item) => (
          <button key={item.id} type="button" onClick={() => setFormat(item.id)} style={{ ...pill, background: format === item.id ? "#27272a" : "transparent" }}>{item.label}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, padding: "8px 12px", flexWrap: "wrap" }}>
        {props.books.map((book) => (
          <button key={book.id} type="button" onClick={() => setAccountId(book.id)} style={{ ...pill, background: accountId === book.id ? "#27272a" : "transparent" }}>{book.label}</button>
        ))}
      </div>
      <label style={{ ...pill, margin: "0 12px" }}>
        Choose file
        <input
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            void file.text().then(async (csv) => {
              const result = await props.onImport({ format, accountId, csv });
              if ("error" in result) setNote(result.error);
              else setNote(`Imported ${result.importedTrades}. Skipped ${result.skippedDuplicates} duplicates.`);
            });
          }}
        />
      </label>
      {note && <div style={{ color: C.muted, fontSize: 16, padding: "8px 12px" }}>{note}</div>}
    </Sheet>
  );
}

const pill: CSSProperties = {
  minHeight: 44,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "0 10px",
  borderRadius: 8,
  border: `1px solid ${C.border}`,
  background: "transparent",
  color: C.text,
  cursor: "pointer",
  fontSize: 16,
};

const sheetRow: CSSProperties = {
  width: "100%",
  minHeight: 44,
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "0 12px",
  background: "transparent",
  color: C.text,
  border: "none",
  borderTop: `1px solid ${C.border}`,
  cursor: "pointer",
  textAlign: "left",
};

function nearestScrollParent(node: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = node.parentElement;
  while (current) {
    const style = getComputedStyle(current);
    if (/(auto|scroll)/.test(style.overflowY)) return current;
    current = current.parentElement;
  }
  return null;
}
