import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Flame, Loader2, RefreshCw } from "lucide-react";
import type {
  CatalystCard,
  CatalystFilterBreakdown,
  CatalystsFeed,
  CatalystsSortKey,
} from "@workspace/catalysts-types";
import { MOVERS_MANUAL_REFRESH_DEBOUNCE_MS } from "@workspace/movers-types";
import { useTerminalStore } from "@/lib/store";
import { normalizeCatalystGateSettings } from "@workspace/catalysts-types";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePortfolioStreamStore } from "@/lib/portfolio-stream-store";
import {
  buildCatalystStrategistFlowContext,
  catalystCardPhase,
  daysUntilEarnings,
  driftVsSpy10d,
  rawDrift10d,
  earningsDaysAwayLabel,
  fmtEarningsShort,
  fmtPct,
  pctColor,
  shouldFallOffCatalyst,
} from "@/lib/catalystsSession";
import { normalizeCatalystsFeed } from "@/lib/normalizeCatalystsFeed";
import {
  buildSettledSessionRowsNewestFirst,
  catalystFeedFreshnessLabel,
} from "@/lib/catalystSessionDisplay";

/** Match Movers feed tokens so both tabs feel like one designer. */
const BG = "#0c0c0c";
const PANEL = "#111";
const BORDER = "rgba(39, 39, 42, 0.8)";
const MUTED = "#71717a";
const GOLD = "#FFB800";
const GREEN = "#00d166";
const RED = "#f23645";
const BLUE = "#0064FF";
const MIN_FONT_PX = 12;
const ROW_FONT_PX = MIN_FONT_PX;
const BODY_LINE_HEIGHT = 1.55;
const COLLAPSED_COLUMN_GAP_PX = 10;
const COLLAPSED_CELL_PAD_PX = 6;
const TEXT_PRIMARY = "#fafafa";
const TEXT_SECONDARY = "#e4e4e7";

const COLLAPSED_GRID =
  "20px minmax(0, 1.35fr) minmax(0, 0.95fr) minmax(0, 0.95fr) minmax(0, 1fr)";

const collapsedRowGridStyle = {
  gridTemplateColumns: COLLAPSED_GRID,
  columnGap: COLLAPSED_COLUMN_GAP_PX,
  paddingLeft: 8,
  paddingRight: 8,
} as const;

type SortKey = CatalystsSortKey;

const SORT_CHIPS: { key: SortKey; label: string }[] = [
  { key: "soonest", label: "SOONEST" },
  { key: "fiveDayMove", label: "10-DAY DRIFT" },
  { key: "streak", label: "STREAK" },
];

/** Avoid mounting 1000+ rows — drift is cached; live quotes are not used on this tab. */
const CATALYSTS_RENDER_INITIAL = 120;
const CATALYSTS_RENDER_STEP = 120;

function CollapsedCell({
  children,
  align = "center",
}: {
  children: ReactNode;
  align?: "center" | "start";
}) {
  const centered = align === "center";
  return (
    <div
      className={`min-w-0 flex flex-col ${centered ? "items-center justify-center" : "items-start justify-center"}`}
      style={{
        paddingLeft: COLLAPSED_CELL_PAD_PX,
        paddingRight: centered ? COLLAPSED_CELL_PAD_PX : 4,
        textAlign: centered ? "center" : "left",
      }}
    >
      {children}
    </div>
  );
}

function Sparkline({ moves }: { moves: number[] }) {
  const w = 52;
  const h = 22;
  if (moves.length === 0) return null;
  const min = Math.min(...moves, 0);
  const max = Math.max(...moves, 0);
  const range = max - min || 1;
  const last = moves[moves.length - 1] ?? 0;
  const stroke = last >= 0 ? GREEN : RED;
  const points = moves
    .map((v, i) => {
      const x = moves.length === 1 ? w / 2 : (i / (moves.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 2) - 1;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={w} height={h} className="shrink-0" aria-hidden>
      <polyline fill="none" stroke={stroke} strokeWidth="1.5" points={points} />
    </svg>
  );
}

function filterBreakdownSummary(bd: CatalystFilterBreakdown | undefined): string {
  if (!bd) return "";
  const parts: string[] = [];
  const push = (label: string, n: number) => {
    if (n > 0) parts.push(`${label} ${n}`);
  };
  push("no options", bd.NO_OPTIONS);
  push("low volume", bd.LOW_VOLUME);
  push("micro cap", bd.MICRO_CAP);
  push("sub $5", bd.SUB_5);
  push("leveraged ETF", bd.LEVERAGED_ETF);
  push("missing session data", bd.NO_SESSION_DATA);
  return parts.join(" · ");
}

function CatalystsFunnelBar({
  funnel,
  onStreak,
  reportsToday,
}: {
  funnel: CatalystsFeed["funnel"];
  onStreak: number;
  reportsToday: number;
}) {
  const breakdownText = filterBreakdownSummary(funnel.filterBreakdown);
  const items = [
    { label: "SCHEDULED", value: funnel.calendar, color: MUTED },
    { label: "TRADEABLE", value: funnel.tradeable, color: GOLD },
    { label: "ON STREAK", value: onStreak, color: TEXT_PRIMARY },
    { label: "REPORTS TODAY", value: reportsToday, color: reportsToday > 0 ? GOLD : MUTED },
  ];
  return (
    <div
      className="grid grid-cols-4 gap-1 px-3 py-2 border-b font-mono tracking-wider shrink-0"
      style={{ background: PANEL, borderColor: BORDER, fontSize: ROW_FONT_PX }}
    >
      {items.map((item) => (
        <div key={item.label} className="text-center">
          <div style={{ color: TEXT_SECONDARY, fontSize: MIN_FONT_PX }}>{item.label}</div>
          <div className="font-bold mt-0.5" style={{ color: item.color, fontSize: ROW_FONT_PX }}>
            {item.value}
          </div>
        </div>
      ))}
      {breakdownText ? (
        <div
          className="col-span-4 text-center font-mono mt-1 px-1"
          style={{ color: MUTED, fontSize: MIN_FONT_PX, lineHeight: BODY_LINE_HEIGHT }}
        >
          Filtered out: {breakdownText}
        </div>
      ) : null}
    </div>
  );
}

function CatalystsListHeader() {
  return (
    <div
      className="grid items-center border-b shrink-0"
      style={{
        background: PANEL,
        borderColor: BORDER,
        ...collapsedRowGridStyle,
      }}
    >
      <span />
      <CollapsedCell align="start">
        <span className="font-mono tracking-wider" style={{ color: TEXT_PRIMARY, fontSize: ROW_FONT_PX }}>
          Symbol
        </span>
      </CollapsedCell>
      <CollapsedCell>
        <span className="font-mono tracking-wider whitespace-nowrap" style={{ color: TEXT_PRIMARY, fontSize: ROW_FONT_PX }}>
          10-Session Drift
        </span>
      </CollapsedCell>
      <CollapsedCell>
        <span className="font-mono tracking-wider whitespace-nowrap" style={{ color: TEXT_PRIMARY, fontSize: ROW_FONT_PX }}>
          Earnings
        </span>
      </CollapsedCell>
      <CollapsedCell>
        <span className="font-mono tracking-wider whitespace-nowrap" style={{ color: TEXT_PRIMARY, fontSize: ROW_FONT_PX }}>
          vs S&amp;P
        </span>
      </CollapsedCell>
    </div>
  );
}

const CatalystRow = memo(function CatalystRow({
  card,
  held,
  expanded,
  spyHistoryOk,
  onToggle,
  onNavigate,
  onSendToStrategist,
}: {
  card: CatalystCard;
  held: boolean;
  expanded: boolean;
  spyHistoryOk: boolean;
  onToggle: () => void;
  onNavigate?: (sym: string) => void;
  onSendToStrategist?: (sym: string, flowContext: string) => void;
}) {
  const [strategistSent, setStrategistSent] = useState(false);
  const strategistSentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rel10 = driftVsSpy10d(card);
  const raw10 = rawDrift10d(card);
  const vsDisplay = spyHistoryOk ? rel10 : raw10;
  const streakHot = card.snapshot.streak >= 5;
  const tickerColor = rel10 >= 0 ? GREEN : RED;
  const phase = catalystCardPhase(card);
  const earningsAccent = phase === "reports_today" || phase === "reporting_after_close";

  const rowStyle: CSSProperties = {
    borderColor: BORDER,
    background: BG,
    minHeight: 44,
    ...collapsedRowGridStyle,
  };

  return (
    <div className="border-b" style={{ borderColor: BORDER, background: BG }}>
      <button type="button" className="w-full text-left grid items-center py-2.5" style={rowStyle} onClick={onToggle}>
        {expanded ? (
          <ChevronDown className="w-4 h-4 shrink-0 justify-self-center" style={{ color: MUTED }} />
        ) : (
          <ChevronRight className="w-4 h-4 shrink-0 justify-self-center" style={{ color: MUTED }} />
        )}
        <CollapsedCell align="start">
          <div className="flex items-center gap-1 min-w-0 max-w-full">
            <span
              className="font-mono font-bold tracking-wider shrink-0"
              style={{ color: tickerColor, fontSize: ROW_FONT_PX }}
            >
              {card.symbol}
            </span>
              {streakHot && <Flame className="w-3.5 h-3.5 shrink-0" style={{ color: GOLD }} />}
            </div>
            <p className="font-mono truncate w-full mt-0.5" style={{ color: TEXT_PRIMARY, fontSize: MIN_FONT_PX }}>
              {held && (
                <span style={{ color: BLUE, fontWeight: 700 }}>HELD · </span>
              )}
              {card.optionsChainUnconfirmed && (
                <span style={{ color: GOLD, fontWeight: 700 }}>OPTIONS UNCONFIRMED · </span>
              )}
              {card.name}
            </p>
        </CollapsedCell>
        <CollapsedCell>
          <Sparkline moves={card.snapshot.sessionMovesPct} />
        </CollapsedCell>
        <CollapsedCell>
          <span
            className="font-mono font-bold whitespace-nowrap"
            style={{ color: earningsAccent ? GOLD : TEXT_PRIMARY, fontSize: ROW_FONT_PX }}
          >
            {fmtEarningsShort(card.earningsDate)}
          </span>
          <span className="font-mono mt-0.5 whitespace-nowrap" style={{ color: MUTED, fontSize: MIN_FONT_PX }}>
            {earningsDaysAwayLabel(card)}
          </span>
        </CollapsedCell>
        <CollapsedCell>
          <span
            className="font-mono font-bold tabular-nums whitespace-nowrap"
            style={{ color: pctColor(vsDisplay), fontSize: ROW_FONT_PX }}
          >
            {fmtPct(vsDisplay)}
          </span>
          <span className="font-mono mt-0.5 whitespace-nowrap" style={{ color: TEXT_PRIMARY, fontSize: MIN_FONT_PX }}>
            {spyHistoryOk ? `raw ${fmtPct(raw10)}` : "raw only"}
          </span>
        </CollapsedCell>
      </button>

      {expanded && (
        <div className="px-3 pb-2 pt-1 space-y-1.5" style={{ paddingLeft: 36 }}>
          <p className="font-mono" style={{ color: TEXT_PRIMARY, fontSize: ROW_FONT_PX, lineHeight: BODY_LINE_HEIGHT }}>
            {card.snapshot.patternRead}
          </p>
          <p className="font-mono" style={{ color: TEXT_PRIMARY, fontSize: MIN_FONT_PX, lineHeight: BODY_LINE_HEIGHT }}>
            Cumulative drift (sum of daily moves vs S&amp;P 500)
          </p>
          <div
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono"
            style={{ fontSize: ROW_FONT_PX }}
          >
            {(
              [
                ["T-1", card.snapshot.cumulative1d],
                ["T-3", card.snapshot.cumulative3d],
                ["T-5", card.snapshot.cumulative5d],
                ["T-10", card.snapshot.cumulative10d],
              ] as const
            ).map(([label, val]) => (
              <span key={label} className="tabular-nums whitespace-nowrap">
                <span style={{ color: TEXT_PRIMARY }}>{label} </span>
                <span className="font-bold" style={{ color: pctColor(val) }}>
                  {fmtPct(val)}
                </span>
              </span>
            ))}
          </div>
          <div>
            <p className="font-mono mb-1" style={{ color: TEXT_PRIMARY, fontSize: MIN_FONT_PX }}>
              SETTLED SESSIONS (T-1 … T-10) · cached at feed build
            </p>
            <div
              className="grid font-mono gap-x-2 py-0.5"
              style={{
                fontSize: MIN_FONT_PX,
                gridTemplateColumns: "minmax(2.5rem, auto) 1fr 1fr 1fr",
              }}
            >
              <span style={{ color: TEXT_PRIMARY }} />
              <span className="text-right" style={{ color: TEXT_PRIMARY }}>
                RAW
              </span>
              <span className="text-right" style={{ color: TEXT_PRIMARY }}>
                S&amp;P
              </span>
              <span className="text-right" style={{ color: TEXT_PRIMARY }}>
                VS S&amp;P
              </span>
              {buildSettledSessionRowsNewestFirst(card, spyHistoryOk).map((row) => (
                <div key={`${row.dateYmd}-${row.label}`} className="contents">
                  <span style={{ color: TEXT_PRIMARY }}>{row.label}</span>
                  <span className="text-right tabular-nums" style={{ color: pctColor(row.rawPct) }}>
                    {fmtPct(row.rawPct)}
                  </span>
                  <span className="text-right tabular-nums" style={{ color: pctColor(row.spyPct) }}>
                    {spyHistoryOk ? fmtPct(row.spyPct) : "—"}
                  </span>
                  <span className="text-right tabular-nums" style={{ color: pctColor(row.vsSpyPct) }}>
                    {fmtPct(row.vsSpyPct)}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 font-mono" style={{ fontSize: ROW_FONT_PX }}>
            <span style={{ color: TEXT_SECONDARY }}>
              LAST {card.lastPrice != null ? `$${card.lastPrice.toFixed(2)}` : "—"}
            </span>
            <span style={{ color: TEXT_SECONDARY }}>
              IMPLIED{" "}
              {card.impliedMovePct != null && Number.isFinite(card.impliedMovePct) ? (
                <span style={{ color: GOLD, fontWeight: 700 }}>±{card.impliedMovePct.toFixed(1)}%</span>
              ) : (
                "—"
              )}
            </span>
            <span style={{ color: TEXT_SECONDARY }}>
              STREAK {card.snapshot.streak}
              {!card.earningsConfirmed ? " · EST." : ""}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 mt-2 font-mono font-bold tracking-wider">
            {onNavigate ? (
              <button
                type="button"
                className="shrink-0"
                style={{ color: GOLD, fontSize: ROW_FONT_PX }}
                onClick={() => onNavigate(card.symbol)}
              >
                Open {card.symbol} →
              </button>
            ) : (
              <span />
            )}
            {onSendToStrategist ? (
              <button
                type="button"
                className="shrink-0 ml-auto"
                style={{ color: BLUE, fontSize: ROW_FONT_PX }}
                onClick={() => {
                  if (strategistSent) return;
                  onSendToStrategist(
                    card.symbol,
                    buildCatalystStrategistFlowContext(card, spyHistoryOk),
                  );
                  setStrategistSent(true);
                  if (strategistSentTimerRef.current) clearTimeout(strategistSentTimerRef.current);
                  strategistSentTimerRef.current = setTimeout(() => {
                    setStrategistSent(false);
                    strategistSentTimerRef.current = null;
                  }, 2000);
                }}
              >
                {strategistSent ? "Sent to Strategist" : "Send to Strategist"}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
});

export function CatalystsFeed({
  onNavigateToSymbol,
  onSendToStrategist,
}: {
  onNavigateToSymbol?: (sym: string) => void;
  onSendToStrategist?: (sym: string, flowContext: string) => void;
}) {
  const queryClient = useQueryClient();
  const setCatalystGateSettings = useTerminalStore((s) => s.setCatalystGateSettings);
  const lastManualRefreshAt = useRef(0);
  const [sortKey, setSortKey] = useState<SortKey>("soonest");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [renderLimit, setRenderLimit] = useState(CATALYSTS_RENDER_INITIAL);
  const account = usePortfolioStreamStore((s) => s.account);

  const heldSymbols = useMemo(() => {
    const set = new Set<string>();
    for (const p of account?.positions ?? []) {
      const sym =
        (p as { symbol?: string; instrument?: { symbol?: string } }).symbol ??
        (p as { instrument?: { symbol?: string } }).instrument?.symbol;
      if (sym) set.add(String(sym).toUpperCase());
    }
    return set;
  }, [account?.positions]);

  useEffect(() => {
    fetchWithAuth("/api/catalysts/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { settings?: unknown } | null) => {
        if (body?.settings) {
          setCatalystGateSettings(normalizeCatalystGateSettings(body.settings as never));
        }
      })
      .catch(() => {});
  }, [setCatalystGateSettings]);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["catalysts-feed"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/catalysts");
      if (!res.ok) throw new Error(`Catalysts feed HTTP ${res.status}`);
      return normalizeCatalystsFeed((await res.json()) as CatalystsFeed);
    },
    staleTime: 120_000,
    refetchInterval: false,
  });

  const visibleCards = useMemo(() => {
    const cards = data?.cards ?? [];
    const now = new Date();
    return cards.filter((c: CatalystCard) => !shouldFallOffCatalyst(c, now));
  }, [data?.cards]);

  const summary = useMemo(() => {
    const now = new Date();
    let onStreak = 0;
    let reportsToday = 0;
    for (const c of visibleCards) {
      if (c.snapshot.streak >= 5) onStreak += 1;
      const phase = catalystCardPhase(c, now);
      if (phase === "reports_today" || phase === "reporting_after_close") reportsToday += 1;
    }
    return { onStreak, reportsToday };
  }, [visibleCards]);

  const sorted = useMemo(() => {
    const list = [...visibleCards];
    switch (sortKey) {
      case "fiveDayMove":
        list.sort(
          (a, b) =>
            Math.abs(b.snapshot.cumulative10d) - Math.abs(a.snapshot.cumulative10d),
        );
        break;
      case "streak":
        list.sort((a, b) => b.snapshot.streak - a.snapshot.streak);
        break;
      case "soonest":
      default:
        list.sort(
          (a, b) =>
            daysUntilEarnings(a.earningsDate) - daysUntilEarnings(b.earningsDate) ||
            a.symbol.localeCompare(b.symbol),
        );
    }
    return list;
  }, [visibleCards, sortKey]);

  useEffect(() => {
    setRenderLimit(CATALYSTS_RENDER_INITIAL);
  }, [sortKey, data?.builtAt, visibleCards.length]);

  const displayed = useMemo(
    () => sorted.slice(0, renderLimit),
    [sorted, renderLimit],
  );
  const hasMore = sorted.length > displayed.length;

  const toggle = useCallback((sym: string) => {
    setExpanded((prev) => ({ ...prev, [sym]: !prev[sym] }));
  }, []);

  const onRefresh = useCallback(async () => {
    const now = Date.now();
    if (now - lastManualRefreshAt.current < MOVERS_MANUAL_REFRESH_DEBOUNCE_MS) return;
    lastManualRefreshAt.current = now;

    setManualRefreshing(true);
    try {
      const res = await fetchWithAuth("/api/catalysts/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: useTerminalStore.getState().catalystGateSettings }),
      });
      if (!res.ok) throw new Error(`Catalysts refresh HTTP ${res.status}`);
      const body = (await res.json()) as { ok: boolean; feed: CatalystsFeed };
      queryClient.setQueryData(["catalysts-feed"], normalizeCatalystsFeed(body.feed));
    } catch {
      await queryClient.invalidateQueries({ queryKey: ["catalysts-feed"] });
    } finally {
      setManualRefreshing(false);
    }
  }, [queryClient]);

  const building = data?.status === "building" || (data?.status === "empty" && !data.builtAt);
  const refreshBusy = manualRefreshing || isFetching;
  const spyHistoryOk = data?.benchmarkDrift10dPct != null;

  return (
    <div className="flex flex-col min-h-full" style={{ background: BG, color: TEXT_PRIMARY }}>
      <div
        className="flex items-start justify-between gap-2 px-3 py-2 border-b shrink-0"
        style={{ borderColor: BORDER, background: PANEL }}
      >
        <div className="min-w-0 flex-1">
          <h1 className="font-mono font-bold tracking-[0.2em]" style={{ color: GOLD, fontSize: ROW_FONT_PX }}>
            CATALYSTS
          </h1>
          <p className="font-mono truncate" style={{ color: TEXT_PRIMARY, fontSize: MIN_FONT_PX }}>
            Earnings next 10 days · drift vs S&P 500
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {data?.builtAt ? (
            <span
              className="font-mono text-right max-w-[14rem] leading-snug"
              style={{ color: TEXT_PRIMARY, fontSize: MIN_FONT_PX }}
            >
              {catalystFeedFreshnessLabel(data.builtAt)}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={refreshBusy}
            className="p-2 rounded-lg border transition-opacity disabled:opacity-40"
            style={{ borderColor: BORDER, color: TEXT_PRIMARY }}
            aria-label="Refresh catalysts"
          >
            {refreshBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {data && !building && (
        <CatalystsFunnelBar
          funnel={data.funnel}
          onStreak={summary.onStreak}
          reportsToday={summary.reportsToday}
        />
      )}

      <div
        className="flex gap-2 px-3 py-2 border-b shrink-0 overflow-x-auto"
        style={{ borderColor: BORDER, background: PANEL }}
      >
        {SORT_CHIPS.map((chip) => {
          const active = sortKey === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => setSortKey(chip.key)}
              className="shrink-0 px-3 py-1.5 rounded-lg font-mono font-bold tracking-wider transition-colors"
              style={{
                fontSize: ROW_FONT_PX,
                border: `1px solid ${active ? GOLD : BORDER}`,
                color: active ? GOLD : TEXT_PRIMARY,
                background: "transparent",
              }}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {isLoading && !data && (
        <div className="flex flex-1 items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: GOLD }} />
        </div>
      )}

      {error && !data && (
        <p className="px-3 py-6 font-mono text-center" style={{ color: RED, fontSize: ROW_FONT_PX }}>
          Failed to load catalysts feed
        </p>
      )}

      {building && (
        <p className="px-3 py-8 font-mono text-center" style={{ color: MUTED, fontSize: ROW_FONT_PX }}>
          Building catalysts snapshot — first load may take a minute.
        </p>
      )}

      {data && !building && (
        <div className="flex-1 min-h-0 flex flex-col">
          {sorted.length === 0 ? (
            <p className="px-3 py-8 font-mono text-center" style={{ color: MUTED, fontSize: ROW_FONT_PX }}>
              No upcoming earnings names passed the tradeability gate in the next 10 days.
            </p>
          ) : (
            <>
              <CatalystsListHeader />
              {hasMore && (
                <p
                  className="px-3 py-2 font-mono text-center border-b"
                  style={{ color: TEXT_PRIMARY, fontSize: MIN_FONT_PX, borderColor: BORDER }}
                >
                  Showing {displayed.length} of {sorted.length} — tighten gates or load more below.
                  Large lists do not subscribe live quotes (keeps the app responsive).
                </p>
              )}
              {displayed.map((card) => (
                <CatalystRow
                  key={card.symbol}
                  card={card}
                  held={heldSymbols.has(card.symbol)}
                  expanded={!!expanded[card.symbol]}
                  spyHistoryOk={spyHistoryOk}
                  onToggle={() => toggle(card.symbol)}
                  onNavigate={onNavigateToSymbol}
                  onSendToStrategist={onSendToStrategist}
                />
              ))}
              {hasMore && (
                <button
                  type="button"
                  className="w-full py-3 font-mono font-bold border-t"
                  style={{ color: GOLD, fontSize: ROW_FONT_PX, borderColor: BORDER }}
                  onClick={() =>
                    setRenderLimit((n) => Math.min(sorted.length, n + CATALYSTS_RENDER_STEP))
                  }
                >
                  Load {Math.min(CATALYSTS_RENDER_STEP, sorted.length - displayed.length)} more
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
