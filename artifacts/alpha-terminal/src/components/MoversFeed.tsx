import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import type {
  FilteredName,
  MoversCatalystType,
  MoversFeed,
  MoversPosture,
  MoversSituationRead,
  Situation,
  TickerStat,
} from "@workspace/movers-types";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { MOVERS_MANUAL_REFRESH_DEBOUNCE_MS, MOVERS_POLL_INTERVAL_MS } from "@workspace/movers-types";

const BG = "#0c0c0c";
const PANEL = "#111";
const BORDER = "rgba(39, 39, 42, 0.8)";
const MUTED = "#71717a";
const GOLD = "#FFB800";
const GREEN = "#00d166";
const RED = "#f23645";
/** Minimum readable size at arm's length on mobile — nothing smaller in Movers UI. */
const MIN_FONT_PX = 12;
const ROW_FONT_PX = MIN_FONT_PX;
const BODY_LINE_HEIGHT = 1.55;
/** Even spacing between collapsed data columns (ticker / price / change / catalyst). */
const COLLAPSED_COLUMN_GAP_PX = 10;
const COLLAPSED_CELL_PAD_PX = 6;
const TEXT_PRIMARY = "#fafafa";
const TEXT_SECONDARY = "#e4e4e7";

type SortKey = "symbol" | "price" | "changePct";
type SortDir = "asc" | "desc";

const VALID_CATALYST_TYPES = new Set<MoversCatalystType>([
  "GOV",
  "ANALYST",
  "CONTRACT",
  "EARNINGS",
  "MA",
  "SECTOR",
  "UNKNOWN",
  "NONE",
]);
const POSTURE_COLORS: Record<MoversPosture, string> = {
  WATCH: "#0064FF",
  WAIT: GOLD,
  PASS: RED,
};

const CATALYST_TYPE_LABELS: Record<MoversCatalystType, string> = {
  GOV: "GOVERNMENT",
  ANALYST: "ANALYST ACTION",
  CONTRACT: "CONTRACT WIN",
  EARNINGS: "EARNINGS",
  MA: "M&A",
  SECTOR: "SECTOR",
  UNKNOWN: "NO CATALYST",
  NONE: "NO CATALYST",
};

/**
 * Collapsed row: chevron + three flexible numeric columns + wider catalyst column
 * (fits "NO CATALYST" and longer labels at 12px without truncation).
 */
const COLLAPSED_GRID = "20px minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(6.75rem, 1.55fr)";

const collapsedRowGridStyle = {
  gridTemplateColumns: COLLAPSED_GRID,
  columnGap: COLLAPSED_COLUMN_GAP_PX,
  paddingLeft: 8,
  paddingRight: 8,
} as const;

/** Coerce legacy feed rows (pre–lazy-read) onto the current Situation shape. */
function normalizeSituation(raw: Situation & { read?: string; posture?: string; confidence?: string }): Situation {
  const catalystType = VALID_CATALYST_TYPES.has(raw.catalystType as MoversCatalystType)
    ? raw.catalystType
    : "NONE";
  return {
    ...raw,
    catalystType,
    catalyst: typeof raw.catalyst === "string" ? raw.catalyst : "",
    newsKey: typeof raw.newsKey === "string" ? raw.newsKey : "",
  };
}

function normalizeFeed(feed: MoversFeed): MoversFeed {
  const situations = feed.situations.map((s) => normalizeSituation(s as Situation & { read?: string }));
  return {
    ...feed,
    situations,
    funnel: { ...feed.funnel, situations: situations.length },
  };
}

function fmtPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toFixed(0);
  if (n >= 100) return n.toFixed(2);
  return n.toFixed(n < 1 ? 3 : 2);
}

function fmtCapturedAt(iso: string): string {
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

function pollStatusLabel(feed: MoversFeed | undefined): string {
  if (!feed?.capturedAt) return "Waiting for first poll";
  const stamped = fmtCapturedAt(feed.capturedAt);
  return stamped ? `Last poll ${stamped}` : "Waiting for first poll";
}

function primaryTicker(s: Situation): TickerStat | undefined {
  return s.tickers[0];
}

function compareSituations(a: Situation, b: Situation, key: SortKey, dir: SortDir): number {
  const ta = primaryTicker(a);
  const tb = primaryTicker(b);
  let cmp = 0;
  switch (key) {
    case "symbol":
      cmp = (ta?.symbol ?? "").localeCompare(tb?.symbol ?? "");
      break;
    case "price":
      cmp = (ta?.price ?? 0) - (tb?.price ?? 0);
      break;
    case "changePct":
      cmp = (ta?.changePct ?? 0) - (tb?.changePct ?? 0);
      break;
  }
  return dir === "asc" ? cmp : -cmp;
}

function SortColumnHeader({
  label,
  columnKey,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  columnKey: SortKey;
  sortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey === columnKey;
  return (
    <button
      type="button"
      onClick={() => onSort(columnKey)}
      className="font-mono tracking-wider flex items-center justify-center gap-0.5 transition-colors min-w-0 w-full"
      style={{
        color: active ? "#a1a1aa" : MUTED,
        fontSize: ROW_FONT_PX,
        padding: "6px 4px",
        textAlign: "center",
      }}
    >
      <span className="truncate">{label}</span>
      {active && (
        <span style={{ fontSize: MIN_FONT_PX, flexShrink: 0 }}>{sortDir === "asc" ? "▲" : "▼"}</span>
      )}
    </button>
  );
}

/** Centers label/value in a grid column; catalyst uses start so full label reads leftward. */
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
      className={`min-w-0 flex items-center ${centered ? "justify-center" : "justify-start"}`}
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

function MoversListHeader({
  sortKey,
  sortDir,
  onSort,
}: {
  sortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
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
      <CollapsedCell>
        <SortColumnHeader label="Ticker" columnKey="symbol" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
      </CollapsedCell>
      <CollapsedCell>
        <SortColumnHeader label="Price" columnKey="price" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
      </CollapsedCell>
      <CollapsedCell>
        <SortColumnHeader
          label="% Change"
          columnKey="changePct"
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
        />
      </CollapsedCell>
      <CollapsedCell align="start">
        <span className="font-mono tracking-wider whitespace-nowrap" style={{ color: MUTED, fontSize: ROW_FONT_PX }}>
          Catalyst
        </span>
      </CollapsedCell>
    </div>
  );
}

function FunnelBar({ funnel }: { funnel: MoversFeed["funnel"] }) {
  const items = [
    { label: "DETECTED", value: funnel.detected, color: MUTED },
    { label: "FILTERED", value: funnel.filtered, color: MUTED },
    { label: "TRADEABLE", value: funnel.tradeable, color: GOLD },
    { label: "SITUATIONS", value: funnel.situations, color: "#fafafa" },
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
    </div>
  );
}

function CatalystTypeLabel({ type }: { type: MoversCatalystType }) {
  const label = CATALYST_TYPE_LABELS[type] ?? type;
  return (
    <span
      className="font-mono font-bold uppercase tracking-wide whitespace-nowrap"
      style={{ color: TEXT_PRIMARY, fontSize: ROW_FONT_PX }}
      title={label}
    >
      {label}
    </span>
  );
}

function PostureOutlineBadge({ posture }: { posture: MoversPosture }) {
  const color = POSTURE_COLORS[posture] ?? GOLD;
  return (
    <span
      className="font-mono font-bold uppercase tracking-wider shrink-0"
      style={{
        fontSize: ROW_FONT_PX,
        color,
        border: `1px solid ${color}`,
        background: "transparent",
        padding: "2px 8px",
        borderRadius: 4,
      }}
    >
      {posture}
    </span>
  );
}

function CatalystExpandedDetail({
  situation,
  read,
  readLoading,
}: {
  situation: Situation;
  read: MoversSituationRead | undefined;
  readLoading: boolean;
}) {
  return (
    <div className="space-y-3 mb-2">
      {situation.catalyst ? (
        <p
          className="font-mono"
          style={{
            color: TEXT_PRIMARY,
            fontSize: ROW_FONT_PX,
            lineHeight: BODY_LINE_HEIGHT,
          }}
        >
          {situation.catalyst}
        </p>
      ) : null}
      {readLoading ? (
        <div className="flex items-center gap-2 py-1" style={{ color: TEXT_PRIMARY, fontSize: ROW_FONT_PX }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="font-mono">Loading read…</span>
        </div>
      ) : read ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <PostureOutlineBadge posture={read.posture} />
            <span
              className="font-mono uppercase tracking-wider"
              style={{ color: TEXT_PRIMARY, fontSize: ROW_FONT_PX }}
            >
              {read.confidence} confidence
            </span>
          </div>
          <p
            className="font-mono"
            style={{
              color: TEXT_PRIMARY,
              fontSize: ROW_FONT_PX,
              lineHeight: BODY_LINE_HEIGHT,
            }}
          >
            {read.read}
          </p>
        </>
      ) : null}
    </div>
  );
}

function tickerColumnLabel(situation: Situation): string {
  if (situation.kind !== "cluster") return situation.tickers[0]?.symbol ?? "";
  if (situation.tickers.length <= 2) {
    return situation.tickers.map((x) => x.symbol).join(", ");
  }
  return `${situation.tickers[0]?.symbol ?? ""}+${situation.tickers.length - 1}`;
}

function SituationCard({
  situation,
  onNavigate,
  sessionRead,
  onReadLoaded,
}: {
  situation: Situation;
  onNavigate?: (sym: string) => void;
  sessionRead: Map<string, MoversSituationRead>;
  onReadLoaded: (situationId: string, read: MoversSituationRead) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [readLoading, setReadLoading] = useState(false);
  const t = primaryTicker(situation);
  if (!t) return null;
  const up = t.changePct >= 0;
  const isCluster = situation.kind === "cluster";
  const cachedRead = sessionRead.get(situation.id);

  useEffect(() => {
    if (!expanded || cachedRead) return;
    let cancelled = false;
    setReadLoading(true);
    void fetchWithAuth(`/api/movers/read?id=${encodeURIComponent(situation.id)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Movers read HTTP ${res.status}`);
        return (await res.json()) as MoversSituationRead;
      })
      .then((data) => {
        if (!cancelled) onReadLoaded(situation.id, data);
      })
      .catch(() => {
        if (!cancelled) {
          onReadLoaded(situation.id, {
            read: "Read unavailable.",
            posture: "WAIT",
            confidence: "LOW",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setReadLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, situation.id, cachedRead, onReadLoaded]);

  return (
    <div className="border-b" style={{ borderColor: BORDER, background: BG }}>
      <button
        type="button"
        className="w-full text-left grid items-center py-2.5"
        style={{
          ...collapsedRowGridStyle,
          minHeight: 44,
        }}
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 shrink-0 justify-self-center" style={{ color: MUTED }} />
        ) : (
          <ChevronRight className="w-4 h-4 shrink-0 justify-self-center" style={{ color: MUTED }} />
        )}
        <CollapsedCell>
          <span className="font-mono font-bold truncate max-w-full" style={{ color: TEXT_PRIMARY, fontSize: ROW_FONT_PX }}>
            {tickerColumnLabel(situation)}
          </span>
        </CollapsedCell>
        <CollapsedCell>
          <span className="font-mono tabular-nums whitespace-nowrap" style={{ color: TEXT_PRIMARY, fontSize: ROW_FONT_PX }}>
            ${fmtPrice(t.price)}
          </span>
        </CollapsedCell>
        <CollapsedCell>
          <span
            className="font-mono font-bold tabular-nums whitespace-nowrap"
            style={{ color: up ? GREEN : RED, fontSize: ROW_FONT_PX }}
          >
            {fmtPct(t.changePct)}
          </span>
        </CollapsedCell>
        <CollapsedCell align="start">
          <CatalystTypeLabel type={situation.catalystType} />
        </CollapsedCell>
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-2" style={{ paddingLeft: 36 }}>
          <CatalystExpandedDetail
            situation={situation}
            read={cachedRead}
            readLoading={readLoading && !cachedRead}
          />
          {isCluster ? (
            situation.tickers.map((ct) => (
              <div
                key={ct.symbol}
                className="flex items-center gap-2 font-mono border-b pb-1"
                style={{ borderColor: BORDER, fontSize: ROW_FONT_PX }}
              >
                <span className="font-bold w-12 shrink-0" style={{ color: "#fafafa" }}>
                  {ct.symbol}
                </span>
                <span className="flex-1 truncate" style={{ color: TEXT_SECONDARY }}>
                  {ct.name}
                </span>
                <span className="tabular-nums" style={{ color: "#e4e4e7" }}>
                  ${fmtPrice(ct.price)}
                </span>
                <span
                  className="font-bold tabular-nums w-14 text-right"
                  style={{ color: ct.changePct >= 0 ? GREEN : RED }}
                >
                  {fmtPct(ct.changePct)}
                </span>
                {onNavigate && (
                  <button
                    type="button"
                    className="font-bold tracking-wider shrink-0"
                    style={{ color: GOLD, fontSize: MIN_FONT_PX }}
                    onClick={() => onNavigate(ct.symbol)}
                  >
                    OPEN →
                  </button>
                )}
              </div>
            ))
          ) : (
            <>
              <p className="font-mono" style={{ color: TEXT_PRIMARY, fontSize: ROW_FONT_PX, lineHeight: BODY_LINE_HEIGHT }}>
                {t.name}
              </p>
              <p className="font-mono" style={{ color: TEXT_SECONDARY, fontSize: ROW_FONT_PX }}>
                {t.exchange}
              </p>
              {onNavigate && (
                <button
                  type="button"
                  className="font-mono font-bold tracking-wider mt-1"
                  style={{ color: GOLD, fontSize: ROW_FONT_PX }}
                  onClick={() => onNavigate(t.symbol)}
                >
                  OPEN IN MARKETS →
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FilteredSection({ filtered }: { filtered: FilteredName[] }) {
  const [open, setOpen] = useState(false);
  if (filtered.length === 0) return null;

  const reasonLabel: Record<FilteredName["reason"], string> = {
    LEVERAGED_ETF: "Leveraged ETF",
    SUB_5: "Sub $5",
    MICRO_CAP: "Micro cap",
    LOW_VOLUME: "Low volume",
    NO_OPTIONS: "No options",
  };

  return (
    <div className="border-t shrink-0" style={{ borderColor: BORDER }}>
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2.5 font-mono font-bold tracking-wider"
        style={{ background: PANEL, color: MUTED, fontSize: ROW_FONT_PX }}
        onClick={() => setOpen((o) => !o)}
      >
        <span>FILTERED ({filtered.length})</span>
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>
      {open && (
        <div style={{ background: BG }}>
          <p
            className="px-3 py-2 font-mono border-b"
            style={{ color: TEXT_SECONDARY, fontSize: MIN_FONT_PX, borderColor: BORDER, lineHeight: BODY_LINE_HEIGHT }}
          >
            Stripped from the movers list — leveraged ETFs, sub-$5 names, and market cap under $500M.
          </p>
          {filtered.map((row) => (
            <div
              key={`${row.symbol}-${row.reason}`}
              className="grid items-center border-b"
              style={{
                borderColor: BORDER,
                minHeight: 36,
                gridTemplateColumns: "56px minmax(0, 1fr) 72px 76px 88px",
                columnGap: 4,
                paddingLeft: 12,
                paddingRight: 8,
              }}
            >
              <span className="font-mono font-bold" style={{ color: "#a1a1aa", fontSize: ROW_FONT_PX }}>
                {row.symbol}
              </span>
              <span className="font-mono truncate" style={{ color: MUTED, fontSize: ROW_FONT_PX }}>
                {row.name}
              </span>
              <span className="font-mono tabular-nums text-right" style={{ color: "#e4e4e7", fontSize: ROW_FONT_PX }}>
                ${fmtPrice(row.price)}
              </span>
              <span
                className="font-mono font-bold tabular-nums text-right"
                style={{ color: row.changePct >= 0 ? GREEN : RED, fontSize: ROW_FONT_PX }}
              >
                {fmtPct(row.changePct)}
              </span>
              <span
                className="font-mono uppercase tracking-wide text-right truncate"
                style={{ color: TEXT_SECONDARY, fontSize: MIN_FONT_PX }}
              >
                {reasonLabel[row.reason]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MoversFeed({ onNavigateToSymbol }: { onNavigateToSymbol?: (sym: string) => void }) {
  const queryClient = useQueryClient();
  const lastManualRefreshAt = useRef(0);
  const sessionReadRef = useRef(new Map<string, MoversSituationRead>());
  const [, bumpReadCache] = useState(0);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const onReadLoaded = useCallback((situationId: string, read: MoversSituationRead) => {
    sessionReadRef.current.set(situationId, read);
    bumpReadCache((n) => n + 1);
  }, []);

  const {
    data,
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ["movers-feed"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/movers");
      if (!res.ok) throw new Error(`Movers feed HTTP ${res.status}`);
      return normalizeFeed((await res.json()) as MoversFeed);
    },
    refetchInterval: MOVERS_POLL_INTERVAL_MS,
    staleTime: 30_000,
  });

  const feed = data;

  const handleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        if (sortDir === "asc") {
          setSortDir("desc");
        } else {
          setSortKey(null);
          setSortDir("asc");
        }
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey, sortDir],
  );

  const sortedSituations = useMemo(() => {
    const list = feed?.situations ?? [];
    if (!sortKey) return list;
    return [...list].sort((a, b) => compareSituations(a, b, sortKey, sortDir));
  }, [feed?.situations, sortKey, sortDir]);

  const onRefresh = useCallback(async () => {
    const now = Date.now();
    if (now - lastManualRefreshAt.current < MOVERS_MANUAL_REFRESH_DEBOUNCE_MS) return;
    lastManualRefreshAt.current = now;

    setManualRefreshing(true);
    try {
      const res = await fetchWithAuth("/api/movers/refresh", { method: "POST" });
      if (!res.ok) throw new Error(`Movers refresh HTTP ${res.status}`);
      const body = (await res.json()) as { feed: MoversFeed; debounced?: boolean };
      queryClient.setQueryData(["movers-feed"], normalizeFeed(body.feed));
    } catch {
      await queryClient.invalidateQueries({ queryKey: ["movers-feed"] });
    } finally {
      setManualRefreshing(false);
    }
  }, [queryClient]);

  const refreshBusy = manualRefreshing || isFetching;

  return (
    <div className="flex flex-col min-h-full" style={{ background: BG, color: "#fafafa" }}>
      <div
        className="flex items-center justify-between px-3 py-2 border-b shrink-0"
        style={{ borderColor: BORDER, background: PANEL }}
      >
        <div>
          <h1 className="font-mono font-bold tracking-[0.2em]" style={{ color: GOLD, fontSize: ROW_FONT_PX }}>
            MOVERS
          </h1>
          <p className="font-mono mt-0.5" style={{ color: TEXT_SECONDARY, fontSize: MIN_FONT_PX }}>
            {pollStatusLabel(feed)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={refreshBusy}
          className="p-2 rounded-lg border transition-opacity disabled:opacity-40"
          style={{ borderColor: BORDER, color: MUTED }}
          aria-label="Refresh movers"
        >
          {refreshBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      {isLoading && !feed && (
        <div className="flex flex-1 items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: GOLD }} />
        </div>
      )}

      {error && !feed && (
        <div className="px-3 py-6 font-mono text-center" style={{ color: RED, fontSize: ROW_FONT_PX }}>
          Failed to load movers feed
        </div>
      )}

      {feed && (
        <>
          <FunnelBar funnel={feed.funnel} />
          <div className="flex-1 min-h-0 flex flex-col">
            {feed.situations.length === 0 ? (
              <p className="px-3 py-8 font-mono text-center" style={{ color: MUTED, fontSize: ROW_FONT_PX }}>
                No tradeable movers in the latest poll.
              </p>
            ) : (
              <>
                <MoversListHeader sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                {sortedSituations.map((s: Situation) => (
                  <SituationCard
                    key={s.id}
                    situation={s}
                    onNavigate={onNavigateToSymbol}
                    sessionRead={sessionReadRef.current}
                    onReadLoaded={onReadLoaded}
                  />
                ))}
              </>
            )}
          </div>
          <FilteredSection filtered={feed.filtered} />
        </>
      )}
    </div>
  );
}
