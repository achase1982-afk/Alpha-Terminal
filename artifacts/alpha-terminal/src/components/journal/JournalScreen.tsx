import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { CategoryStat, CutStat, InsightSlice, InsightsPayload, JournalPeriod, JournalView, MetricBlock, PositionView } from "./journalModel";
import { BENCHMARK_UNAVAILABLE, money, signColor, signedPct } from "./journalModel";

const C = {
  bg: "#0c0c0c",
  card: "#18181b",
  border: "#27272a",
  text: "#e4e4e7",
  muted: "#a1a1aa",
  dim: "#71717a",
  gold: "#FFB800",
  green: "#00d166",
  red: "#dc2626",
};

const FONT = `'Inter','SF Pro Text',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;

export interface JournalScreenProps {
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
}

export function JournalScreen(props: JournalScreenProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const overviewScrollRef = useRef<number | null>(null);
  const slice = props.strategy ? props.payload?.byStrategy[props.strategy] ?? null : props.payload?.account ?? null;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const scroller = nearestScrollParent(root);
    if (!scroller) return;
    const savedOverview = overviewScrollRef.current;
    const place = () => {
      if (props.strategy) {
        const drill = root.querySelector<HTMLElement>("[data-journal-drill]");
        if (drill) alignDrillUnderSticky(drill, scroller);
        return;
      }
      if (savedOverview != null) scroller.scrollTop = savedOverview;
    };
    place();
    const frame = requestAnimationFrame(() => {
      place();
      if (!props.strategy) overviewScrollRef.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [props.strategy]);

  const openStrategy = (strategy: string) => {
    const scroller = nearestScrollParent(rootRef.current);
    overviewScrollRef.current = scroller?.scrollTop ?? 0;
    props.onStrategy(strategy);
  };

  return (
    <div ref={rootRef} data-journal-root style={{ fontFamily: FONT, color: C.text, background: C.bg, overflowAnchor: "none" }}>
      {props.exampleBanner ? (
        <div style={{ background: C.gold, color: "#1a1400", textAlign: "center", fontSize: 11, fontWeight: 800, letterSpacing: 0.6, padding: "6px 10px" }}>
          EXAMPLE DATA — NOT ACCOUNT FIGURES
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 6, padding: "10px 12px 0" }}>
        <Segmented
          value={props.view}
          options={[{ id: "insights", label: "Insights" }, { id: "trades", label: "Trades" }]}
          onChange={(value) => {
            props.onView(value);
            if (value === "trades") props.onStrategy(null);
          }}
        />
      </div>
      {props.loading && !props.payload ? <StatusLine>Loading journal…</StatusLine> : null}
      {props.error ? (
        <StatusLine>
          {props.error}
          {props.onRetry ? (
            <button type="button" onClick={props.onRetry} style={textButton}>Retry</button>
          ) : null}
        </StatusLine>
      ) : null}
      {props.payload && props.view === "trades" ? <TradesList positions={props.payload.positions} /> : null}
      {props.payload && props.view === "insights" && props.strategy ? (
        <div data-journal-drill>
          <Drilldown
            name={props.strategy}
            period={props.period}
            onPeriod={props.onPeriod}
            onBack={() => props.onStrategy(null)}
            slice={slice}
          />
        </div>
      ) : null}
      {props.payload && props.view === "insights" && !props.strategy ? (
        <AccountInsights payload={props.payload} period={props.period} onPeriod={props.onPeriod} onStrategy={openStrategy} />
      ) : null}
    </div>
  );
}

function AccountInsights(props: {
  payload: InsightsPayload;
  period: JournalPeriod;
  onPeriod: (period: JournalPeriod) => void;
  onStrategy: (strategy: string) => void;
}) {
  const metrics = props.payload.account?.metrics ?? null;
  return (
    <div>
      <PeriodRow period={props.period} onPeriod={props.onPeriod} />
      {props.payload.empty || !props.payload.headline || !metrics ? (
        <div data-journal-headline data-journal-empty style={{ padding: "28px 16px 8px", fontSize: 16, fontWeight: 650, color: C.text }}>
          {props.payload.emptyMessage ?? "No closed trades in this period."}
        </div>
      ) : (
        <Headline
          label={props.payload.headline.label}
          tone={props.payload.headline.tone}
          net={props.payload.headline.netPnl}
          subtitle="Net after fees · closed trades only"
        />
      )}
      <Comparison payload={props.payload} />
      {metrics ? <MetricGrid metrics={metrics} mode="account" /> : null}
      {props.payload.assetClasses.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "0 12px 8px" }}>
          {props.payload.assetClasses.map((row) => (
            <article key={row.key} style={card}>
              <div style={kicker}>{row.label}</div>
              <div style={{ fontSize: 20, fontWeight: 750, color: signColor(row.netPnl), fontVariantNumeric: "tabular-nums" }}>{money(row.netPnl)}</div>
              <div style={fine}>{row.trades} trades · exp. {money(row.expectancy)}</div>
            </article>
          ))}
        </div>
      ) : null}
      {props.payload.strategies.length > 0 ? (
        <section style={{ padding: "4px 12px 8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <div style={kicker}>By strategy</div>
            <div style={{ fontSize: 11, color: C.dim }}>Tap a row for detail</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {props.payload.strategies.map((row) => (
              <StrategyRow key={row.key} row={row} onOpen={() => props.onStrategy(row.key)} />
            ))}
          </div>
        </section>
      ) : null}
      {props.payload.account?.perspective ? <Perspective text={props.payload.account.perspective} /> : null}
    </div>
  );
}

function Drilldown(props: {
  name: string;
  period: JournalPeriod;
  onPeriod: (period: JournalPeriod) => void;
  onBack: () => void;
  slice: InsightSlice | null;
}) {
  if (!props.slice || props.slice.metrics.closedTrades === 0) {
    return (
      <div>
        <DrillBar name={props.name} period={props.period} onPeriod={props.onPeriod} onBack={props.onBack} />
        <div data-journal-empty style={{ padding: "28px 16px", fontSize: 16 }}>No closed trades in this period.</div>
      </div>
    );
  }
  const metrics = props.slice.metrics;
  const tone = metrics.netPnl > 0 ? "positive" : metrics.netPnl < 0 ? "negative" : "flat";
  const label = metrics.netPnl > 0 ? "IN THE BLACK" : metrics.netPnl < 0 ? "IN THE RED" : "FLAT";
  return (
    <div>
      <DrillBar name={props.name} period={props.period} onPeriod={props.onPeriod} onBack={props.onBack} />
      <Headline
        label={label}
        tone={tone}
        net={metrics.netPnl}
        subtitle={`Net after fees · ${metrics.closedTrades} closed trade${metrics.closedTrades === 1 ? "" : "s"}${metrics.closedTrades >= 30 ? " · enough trades" : ""}`}
      />
      <MetricGrid metrics={metrics} mode="drill" />
      <CutGrid cuts={props.slice.timeCuts} columns={2} />
      <CutGrid cuts={props.slice.holdingCuts} columns={3} />
      {props.slice.perspective ? <Perspective text={props.slice.perspective} /> : null}
      <ClosedTrades trades={props.slice.closedTrades} />
      <CutGrid cuts={props.slice.dayCuts.filter((cut) => cut.trades > 0)} columns={2} />
    </div>
  );
}

function Comparison(props: { payload: InsightsPayload }) {
  const comparison = props.payload.comparison;
  const benchmark = comparison.benchmarkStatus === "ok" ? signedPct(comparison.benchmarkReturn) : BENCHMARK_UNAVAILABLE;
  return (
    <div data-journal-benchmark style={{ padding: "0 16px 12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={kicker}>Account</div>
          <div style={{ fontSize: comparison.accountReturn == null ? 13 : 22, fontWeight: 750, color: signColor(comparison.accountReturn), fontVariantNumeric: "tabular-nums" }}>{comparison.accountReturn == null ? "Unavailable" : signedPct(comparison.accountReturn)}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={kicker}>S&amp;P 500</div>
          <div style={{ fontSize: comparison.benchmarkStatus === "ok" ? 22 : 13, fontWeight: 750, color: comparison.benchmarkStatus === "ok" ? signColor(comparison.benchmarkReturn) : C.muted, fontVariantNumeric: "tabular-nums" }}>{benchmark}</div>
        </div>
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.45, color: C.dim }}>{comparison.footnote}</p>
    </div>
  );
}

function Headline(props: { label: string; tone: "positive" | "negative" | "flat"; net: number; subtitle: string }) {
  const color = props.tone === "positive" ? C.green : props.tone === "negative" ? C.red : C.muted;
  return (
    <div data-journal-headline style={{ padding: "12px 16px 8px" }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.8, color }}>{props.label}</div>
      <div style={{ fontSize: 34, fontWeight: 760, letterSpacing: -0.8, color, fontVariantNumeric: "tabular-nums", lineHeight: 1.05 }}>{money(props.net)}</div>
      <div style={{ marginTop: 4, fontSize: 13, color: C.muted }}>{props.subtitle}</div>
    </div>
  );
}

function MetricGrid(props: { metrics: MetricBlock; mode: "account" | "drill" }) {
  const positive = props.metrics.pctClosedPositive == null ? "—" : `${Math.round(props.metrics.pctClosedPositive * 100)}%`;
  const avg = `${money(props.metrics.avgGain)} / ${money(props.metrics.avgLoss)}`;
  const cells = [
    { label: "Expectancy", value: money(props.metrics.expectancy), color: signColor(props.metrics.expectancy) },
    { label: "Avg gain / loss", value: avg, color: C.text },
    { label: "Profit factor", value: props.metrics.profitFactor == null ? "—" : props.metrics.profitFactor.toFixed(2), color: C.text },
    props.mode === "drill"
      ? { label: "Max drawdown", value: money(props.metrics.maxDrawdown), color: signColor(props.metrics.maxDrawdown) }
      : { label: "Closed trades", value: String(props.metrics.closedTrades), color: C.text },
    { label: "% closed positive", value: positive, color: C.text },
    { label: "Fees", value: money(props.metrics.fees).replace("+", ""), color: C.text },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, padding: "0 12px 10px" }}>
      {cells.map((cell) => (
        <article key={cell.label} style={card}>
          <div style={kicker}>{cell.label}</div>
          {cell.label === "Avg gain / loss" ? (
            <div style={{ marginTop: 4, fontSize: 14, fontWeight: 720, fontVariantNumeric: "tabular-nums", lineHeight: 1.25 }}>
              <div style={{ color: signColor(props.metrics.avgGain) }}>{money(props.metrics.avgGain)}</div>
              <div style={{ color: signColor(props.metrics.avgLoss) }}>{money(props.metrics.avgLoss)}</div>
            </div>
          ) : (
            <div style={{ marginTop: 4, fontSize: 15, fontWeight: 720, color: cell.color, fontVariantNumeric: "tabular-nums" }}>{cell.value}</div>
          )}
        </article>
      ))}
    </div>
  );
}

function CutGrid(props: { cuts: CutStat[]; columns: 2 | 3 }) {
  if (props.cuts.length === 0) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))`, gap: 8, padding: "0 12px 8px" }}>
      {props.cuts.map((cut) => (
        <article key={cut.key} style={card}>
          <div style={kicker}>{cut.label}</div>
          <div style={{ marginTop: 4, fontSize: 16, fontWeight: 740, color: signColor(cut.netPnl), fontVariantNumeric: "tabular-nums" }}>{money(cut.netPnl)}</div>
          <div style={fine}>{cut.trades} trade{cut.trades === 1 ? "" : "s"} · exp. {money(cut.expectancy)}</div>
        </article>
      ))}
    </div>
  );
}

function StrategyRow(props: { row: CategoryStat; onOpen: () => void }) {
  return (
    <button type="button" onClick={props.onOpen} style={{ ...card, width: "100%", display: "flex", justifyContent: "space-between", gap: 10, textAlign: "left", cursor: "pointer", color: C.text }}>
      <span>
        <span style={{ display: "block", fontSize: 15, fontWeight: 680 }}>{props.row.label}</span>
        <span style={{ display: "block", marginTop: 3, ...fine }}>{props.row.trades} trades · exp. {money(props.row.expectancy)}</span>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {props.row.sample === "short" ? (
          <span style={{ border: `1px solid ${C.gold}`, color: C.gold, borderRadius: 999, padding: "3px 8px", fontSize: 10, fontWeight: 700, letterSpacing: 0.2 }}>Not enough trades yet</span>
        ) : (
          <Bars />
        )}
        <span style={{ fontSize: 16, fontWeight: 740, color: signColor(props.row.netPnl), fontVariantNumeric: "tabular-nums" }}>{money(props.row.netPnl)}</span>
      </span>
    </button>
  );
}

function TradesList(props: { positions: PositionView[] }) {
  if (props.positions.length === 0) {
    return <div data-journal-empty style={{ padding: "28px 16px", fontSize: 16 }}>No closed trades in this period.</div>;
  }
  return (
    <div style={{ padding: "10px 12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      {props.positions.map((position) => {
        const flat = position.status !== "open" && position.status !== "partial";
        const value = flat ? position.netPnl : position.unrealizedPnl;
        return (
          <article key={position.id} style={{ ...card, display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{position.label}</div>
              <div style={{ marginTop: 3, fontSize: 12, color: C.muted }}>{position.detail}</div>
            </div>
            <div style={{ fontSize: 15, fontWeight: 740, color: signColor(value), fontVariantNumeric: "tabular-nums" }}>{money(value)}</div>
          </article>
        );
      })}
    </div>
  );
}

function ClosedTrades(props: { trades: InsightSlice["closedTrades"] }) {
  return (
    <section style={{ padding: "4px 12px 18px" }}>
      <div style={{ ...kicker, marginBottom: 6 }}>Closed trades</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {props.trades.map((trade) => (
          <article key={trade.id} style={{ ...card, display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{trade.label}</div>
              <div style={{ marginTop: 3, fontSize: 12, color: C.muted }}>{trade.detail}</div>
            </div>
            <div style={{ fontSize: 15, fontWeight: 740, color: signColor(trade.netPnl), fontVariantNumeric: "tabular-nums" }}>{money(trade.netPnl)}</div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Perspective(props: { text: string }) {
  return (
    <section style={{ padding: "4px 12px 12px" }}>
      <div style={{ ...kicker, marginBottom: 6 }}>Perspective</div>
      <p style={{ ...card, margin: 0, fontSize: 13, lineHeight: 1.5, color: C.muted }}>{props.text}</p>
    </section>
  );
}

function PeriodRow(props: { period: JournalPeriod; onPeriod: (period: JournalPeriod) => void }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 12px" }}>
      <span style={{ ...kicker, marginRight: 4 }}>Period</span>
      {(["ytd", "lifetime"] as const).map((period) => {
        const active = props.period === period;
        return (
          <button
            key={period}
            type="button"
            onClick={() => props.onPeriod(period)}
            style={{
              borderRadius: 999,
              border: `1px solid ${active ? C.gold : C.border}`,
              background: active ? "#2a2208" : "transparent",
              color: active ? C.gold : C.muted,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0.4,
              padding: "5px 12px",
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            {period === "ytd" ? "YTD" : "Lifetime"}
          </button>
        );
      })}
    </div>
  );
}

function DrillBar(props: { name: string; period: JournalPeriod; onPeriod: (period: JournalPeriod) => void; onBack: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px 0" }}>
      <button type="button" onClick={props.onBack} aria-label="Back to insights" style={{ ...textButton, fontSize: 18, padding: "0 4px" }}>‹</button>
      <div style={{ fontSize: 16, fontWeight: 740, flex: 1 }}>{props.name}</div>
      <button
        type="button"
        onClick={() => props.onPeriod(props.period === "ytd" ? "lifetime" : "ytd")}
        style={{ background: "transparent", border: "none", color: C.gold, fontSize: 12, fontWeight: 750, letterSpacing: 0.4, cursor: "pointer", fontFamily: FONT }}
      >
        {props.period === "ytd" ? "YTD" : "LIFETIME"}
      </button>
    </div>
  );
}

function Segmented(props: { value: JournalView; options: { id: JournalView; label: string }[]; onChange: (value: JournalView) => void }) {
  return (
    <div style={{ display: "flex", width: "100%", background: "#141416", borderRadius: 12, padding: 3, border: `1px solid ${C.border}` }}>
      {props.options.map((option) => {
        const active = props.value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => props.onChange(option.id)}
            style={{
              flex: 1,
              border: "none",
              borderRadius: 9,
              background: active ? "#2a2a2e" : "transparent",
              color: active ? C.text : C.dim,
              fontWeight: 700,
              fontSize: 14,
              padding: "7px 0",
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function StatusLine(props: { children: ReactNode }) {
  return <div style={{ padding: "22px 16px", color: C.muted, fontSize: 14 }}>{props.children}</div>;
}

function Bars() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1" y="8" width="3" height="6" rx="0.5" fill={C.gold} />
      <rect x="6.5" y="4" width="3" height="10" rx="0.5" fill={C.gold} />
      <rect x="12" y="1" width="3" height="13" rx="0.5" fill={C.gold} />
    </svg>
  );
}

const card: CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: "10px 12px",
};

const kicker: CSSProperties = {
  fontSize: 10,
  fontWeight: 750,
  letterSpacing: 0.7,
  textTransform: "uppercase",
  color: C.dim,
};

const fine: CSSProperties = {
  marginTop: 3,
  fontSize: 11,
  color: C.dim,
};

const textButton: CSSProperties = {
  background: "transparent",
  border: "none",
  color: C.gold,
  cursor: "pointer",
  fontFamily: FONT,
  fontWeight: 700,
};

function nearestScrollParent(node: HTMLElement | null): HTMLElement | null {
  let el = node?.parentElement ?? null;
  while (el) {
    const oy = getComputedStyle(el).overflowY;
    if (oy === "auto" || oy === "scroll") return el;
    el = el.parentElement;
  }
  return null;
}

/** Put the strategy detail just under the sticky portfolio head, which stays put. */
function alignDrillUnderSticky(drill: HTMLElement, scroller: HTMLElement) {
  const sticky = scroller.querySelector<HTMLElement>("[data-pf-sticky-head]");
  const coverBottom = sticky ? sticky.getBoundingClientRect().bottom : scroller.getBoundingClientRect().top;
  const delta = drill.getBoundingClientRect().top - coverBottom;
  if (Math.abs(delta) > 1) scroller.scrollTop += delta;
}
