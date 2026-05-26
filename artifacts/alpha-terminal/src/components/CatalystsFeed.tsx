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
  CatalystsFeed,
  CatalystsSortKey,
} from "@workspace/catalysts-types";
import { MOVERS_MANUAL_REFRESH_DEBOUNCE_MS } from "@workspace/movers-types";
import { useTerminalStore } from "@/lib/store";
import { normalizeCatalystGateSettings } from "@workspace/catalysts-types";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePortfolioStreamStore } from "@/lib/portfolio-stream-store";
import { useQuote } from "@/hooks/useQuote";
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
import { CatalystExpandedBody } from "@/components/CatalystExpandedBody";

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

/** Cap DOM rows; mounted rows use on-demand live quotes (same path as search/quote). */
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
  const { data: stockQuote } = useQuote(card.symbol);
  const { data: spyQuote } = useQuote("SPY");

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
        <CatalystExpandedBody
          card={card}
          spyHistoryOk={spyHistoryOk}
          stockQuote={stockQuote}
          spyQuote={spyQuote}
          onNavigate={onNavigate}
          onSendToStrategist={onSendToStrategist}
          strategistSent={strategistSent}
          onStrategistClick={() => {
            if (strategistSent || !onSendToStrategist) return;
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
        />
      )}
    </div>
  );
});

export function CatalystsFeed({
  onNavigateToSymbol,
  onSendToStrategist,
  subscribeEquitySymbols,
}: {
  onNavigateToSymbol?: (sym: string) => void;
  onSendToStrategist?: (sym: string, flowContext: string) => void;
  /** Same on-demand path as search/quote — registers symbols with the market stream. */
  subscribeEquitySymbols?: (syms: string[]) => void;
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

  useEffect(() => {
    if (!subscribeEquitySymbols || displayed.length === 0) return;
    const syms = [...new Set([...displayed.map((c) => c.symbol.toUpperCase()), "SPY"])];
    subscribeEquitySymbols(syms);
  }, [displayed, subscribeEquitySymbols]);

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
        className="flex items-center justify-between px-3 py-2 border-b shrink-0"
        style={{ borderColor: BORDER, background: PANEL }}
      >
        <h1 className="font-mono font-bold tracking-[0.2em]" style={{ color: GOLD, fontSize: ROW_FONT_PX }}>
          CATALYSTS
        </h1>
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
                  Live quotes apply to visible rows only.
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
