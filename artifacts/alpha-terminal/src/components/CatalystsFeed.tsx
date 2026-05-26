import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
  catalystCardPhase,
  daysUntilEarnings,
  driftVsSpy5d,
  earningsDaysAwayLabel,
  fmtEarningsShort,
  fmtPct,
  pctColor,
  shouldFallOffCatalyst,
} from "@/lib/catalystsSession";

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

function fmtBuiltAt(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
      timeZoneName: "short",
    });
  } catch {
    return "";
  }
}

function feedStatusLabel(feed: CatalystsFeed | undefined): string {
  if (!feed?.builtAt) return "Waiting for first snapshot";
  const stamped = fmtBuiltAt(feed.builtAt);
  return stamped ? `Built ${stamped}` : "Waiting for first snapshot";
}

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
        <span className="font-mono tracking-wider" style={{ color: MUTED, fontSize: ROW_FONT_PX }}>
          Symbol
        </span>
      </CollapsedCell>
      <CollapsedCell>
        <span className="font-mono tracking-wider whitespace-nowrap" style={{ color: MUTED, fontSize: ROW_FONT_PX }}>
          10-Day Drift
        </span>
      </CollapsedCell>
      <CollapsedCell>
        <span className="font-mono tracking-wider whitespace-nowrap" style={{ color: MUTED, fontSize: ROW_FONT_PX }}>
          Earnings
        </span>
      </CollapsedCell>
      <CollapsedCell>
        <span className="font-mono tracking-wider whitespace-nowrap" style={{ color: MUTED, fontSize: ROW_FONT_PX }}>
          vs S&P
        </span>
      </CollapsedCell>
    </div>
  );
}

function CatalystRow({
  card,
  held,
  expanded,
  benchmarkDrift5dPct,
  onToggle,
  onNavigate,
}: {
  card: CatalystCard;
  held: boolean;
  expanded: boolean;
  benchmarkDrift5dPct: number | null;
  onToggle: () => void;
  onNavigate?: (sym: string) => void;
}) {
  const drift5d = card.snapshot.cumulative5d;
  const vsSpy = driftVsSpy5d(card, benchmarkDrift5dPct);
  const streakHot = card.snapshot.streak >= 5;
  const tickerColor = drift5d >= 0 ? GREEN : RED;
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
          <p className="font-mono truncate w-full mt-0.5" style={{ color: TEXT_SECONDARY, fontSize: MIN_FONT_PX }}>
            {held && (
              <span style={{ color: BLUE, fontWeight: 700 }}>HELD · </span>
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
            style={{ color: pctColor(vsSpy ?? drift5d), fontSize: ROW_FONT_PX }}
          >
            {vsSpy != null ? fmtPct(vsSpy) : benchmarkDrift5dPct == null ? "—" : fmtPct(drift5d)}
          </span>
          <span className="font-mono mt-0.5 whitespace-nowrap" style={{ color: MUTED, fontSize: MIN_FONT_PX }}>
            {vsSpy != null ? `raw ${fmtPct(drift5d)}` : benchmarkDrift5dPct == null ? "SPY n/a" : "vs SPY n/a"}
          </span>
        </CollapsedCell>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-2" style={{ paddingLeft: 36 }}>
          <p className="font-mono" style={{ color: TEXT_PRIMARY, fontSize: ROW_FONT_PX, lineHeight: BODY_LINE_HEIGHT }}>
            {card.snapshot.patternRead}
          </p>
          <div
            className="grid grid-cols-5 gap-2 text-center font-mono border rounded-lg py-2"
            style={{ borderColor: BORDER, background: PANEL, fontSize: ROW_FONT_PX }}
          >
            {(
              [
                ["1D", card.snapshot.cumulative1d],
                ["2D", card.snapshot.cumulative2d],
                ["3D", card.snapshot.cumulative3d],
                ["4D", card.snapshot.cumulative4d],
                ["5D", card.snapshot.cumulative5d],
              ] as const
            ).map(([label, val]) => (
              <div key={label}>
                <p style={{ color: MUTED, fontSize: MIN_FONT_PX }}>{label}</p>
                <p className="font-bold mt-0.5" style={{ color: pctColor(val) }}>
                  {fmtPct(val)}
                </p>
              </div>
            ))}
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
          {onNavigate && (
            <button
              type="button"
              className="font-mono font-bold tracking-wider mt-1"
              style={{ color: GOLD, fontSize: ROW_FONT_PX }}
              onClick={() => onNavigate(card.symbol)}
            >
              OPEN IN MARKETS →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function CatalystsFeed({
  onNavigateToSymbol,
  subscribeEquitySymbols,
}: {
  onNavigateToSymbol?: (sym: string) => void;
  subscribeEquitySymbols?: (syms: string[]) => void;
}) {
  const queryClient = useQueryClient();
  const catalystGateSettings = useTerminalStore((s) => s.catalystGateSettings);
  const setCatalystGateSettings = useTerminalStore((s) => s.setCatalystGateSettings);
  const lastManualRefreshAt = useRef(0);
  const [sortKey, setSortKey] = useState<SortKey>("soonest");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [manualRefreshing, setManualRefreshing] = useState(false);
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
      return (await res.json()) as CatalystsFeed;
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
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

  useEffect(() => {
    if (!subscribeEquitySymbols || visibleCards.length === 0) return;
    subscribeEquitySymbols(visibleCards.map((c: CatalystCard) => c.symbol));
  }, [visibleCards, subscribeEquitySymbols]);

  const sorted = useMemo(() => {
    const list = [...visibleCards];
    switch (sortKey) {
      case "fiveDayMove":
        list.sort(
          (a, b) =>
            Math.abs(b.snapshot.cumulative5d) - Math.abs(a.snapshot.cumulative5d),
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
        body: JSON.stringify({ settings: catalystGateSettings }),
      });
      if (!res.ok) throw new Error(`Catalysts refresh HTTP ${res.status}`);
      const body = (await res.json()) as { ok: boolean; feed: CatalystsFeed };
      queryClient.setQueryData(["catalysts-feed"], body.feed);
    } catch {
      await queryClient.invalidateQueries({ queryKey: ["catalysts-feed"] });
    } finally {
      setManualRefreshing(false);
    }
  }, [queryClient, catalystGateSettings]);

  const building = data?.status === "building" || (data?.status === "empty" && !data.builtAt);
  const refreshBusy = manualRefreshing || isFetching;
  const benchmarkDrift5dPct = data?.benchmarkDrift5dPct ?? null;

  return (
    <div className="flex flex-col min-h-full" style={{ background: BG, color: TEXT_PRIMARY }}>
      <div
        className="flex items-center justify-between px-3 py-2 border-b shrink-0"
        style={{ borderColor: BORDER, background: PANEL }}
      >
        <div className="min-w-0">
          <h1 className="font-mono font-bold tracking-[0.2em]" style={{ color: GOLD, fontSize: ROW_FONT_PX }}>
            CATALYSTS
          </h1>
          <p className="font-mono mt-0.5 truncate" style={{ color: TEXT_SECONDARY, fontSize: MIN_FONT_PX }}>
            Earnings next 10 days · drift vs S&P 500
          </p>
          <p className="font-mono mt-0.5 truncate" style={{ color: MUTED, fontSize: MIN_FONT_PX }}>
            {feedStatusLabel(data)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={refreshBusy}
          className="p-2 rounded-lg border transition-opacity disabled:opacity-40 shrink-0"
          style={{ borderColor: BORDER, color: MUTED }}
          aria-label="Refresh catalysts"
        >
          {refreshBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
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
                color: active ? GOLD : MUTED,
                background: active ? "rgba(255, 184, 0, 0.08)" : "transparent",
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
              {sorted.map((card) => (
                <CatalystRow
                  key={card.symbol}
                  card={card}
                  held={heldSymbols.has(card.symbol)}
                  expanded={!!expanded[card.symbol]}
                  benchmarkDrift5dPct={benchmarkDrift5dPct}
                  onToggle={() => toggle(card.symbol)}
                  onNavigate={onNavigateToSymbol}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
