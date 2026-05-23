import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import type { FilteredName, MoversFeed, Situation, TickerStat } from "@workspace/movers-types";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { MOVERS_MANUAL_REFRESH_DEBOUNCE_MS, MOVERS_POLL_INTERVAL_MS } from "@workspace/movers-types";

const BG = "#0c0c0c";
const PANEL = "#111";
const BORDER = "rgba(39, 39, 42, 0.8)";
const MUTED = "#71717a";
const GOLD = "#FFB800";
const GREEN = "#00d166";
const RED = "#f23645";
const ROW_FONT_PX = 12;

type SortKey = "symbol" | "name" | "price" | "changePct";
type SortDir = "asc" | "desc";

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

function companyLabel(s: Situation): string {
  const t = primaryTicker(s);
  if (s.kind === "cluster" && s.label) return s.label;
  return t?.name ?? s.label;
}

function compareSituations(a: Situation, b: Situation, key: SortKey, dir: SortDir): number {
  const ta = primaryTicker(a);
  const tb = primaryTicker(b);
  let cmp = 0;
  switch (key) {
    case "symbol":
      cmp = (ta?.symbol ?? "").localeCompare(tb?.symbol ?? "");
      break;
    case "name":
      cmp = companyLabel(a).localeCompare(companyLabel(b));
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
  align = "left",
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  columnKey: SortKey;
  align?: "left" | "right";
  sortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey === columnKey;
  return (
    <button
      type="button"
      onClick={() => onSort(columnKey)}
      className="font-mono tracking-wider flex items-center gap-0.5 transition-colors min-w-0"
      style={{
        color: active ? "#a1a1aa" : MUTED,
        fontSize: ROW_FONT_PX,
        padding: "6px 4px",
        justifyContent: align === "right" ? "flex-end" : "flex-start",
        width: "100%",
      }}
    >
      <span className="truncate">{label}</span>
      {active && (
        <span style={{ fontSize: 9, flexShrink: 0 }}>{sortDir === "asc" ? "▲" : "▼"}</span>
      )}
    </button>
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
        gridTemplateColumns: "20px 56px minmax(0, 1fr) 72px 76px 108px",
        columnGap: 4,
        paddingLeft: 8,
        paddingRight: 8,
      }}
    >
      <span />
      <SortColumnHeader label="Ticker" columnKey="symbol" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
      <SortColumnHeader label="Company name" columnKey="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
      <SortColumnHeader
        label="Price"
        columnKey="price"
        align="right"
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={onSort}
      />
      <SortColumnHeader
        label="% Change"
        columnKey="changePct"
        align="right"
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={onSort}
      />
      <span
        className="font-mono tracking-wider text-right pr-1"
        style={{ color: MUTED, fontSize: ROW_FONT_PX }}
      >
        Status
      </span>
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
          <div style={{ color: MUTED, fontSize: 10 }}>{item.label}</div>
          <div className="font-bold mt-0.5" style={{ color: item.color, fontSize: ROW_FONT_PX }}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function SituationCard({
  situation,
  onNavigate,
}: {
  situation: Situation;
  onNavigate?: (sym: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const t = primaryTicker(situation);
  if (!t) return null;
  const up = t.changePct >= 0;

  return (
    <div className="border-b" style={{ borderColor: BORDER, background: BG }}>
      <button
        type="button"
        className="w-full text-left grid items-center py-2"
        style={{
          gridTemplateColumns: "20px 56px minmax(0, 1fr) 72px 76px 108px",
          columnGap: 4,
          paddingLeft: 8,
          paddingRight: 8,
          minHeight: 40,
        }}
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 shrink-0 justify-self-center" style={{ color: MUTED }} />
        ) : (
          <ChevronRight className="w-4 h-4 shrink-0 justify-self-center" style={{ color: MUTED }} />
        )}
        <span className="font-mono font-bold truncate" style={{ color: "#fafafa", fontSize: ROW_FONT_PX }}>
          {t.symbol}
        </span>
        <span className="font-mono truncate" style={{ color: MUTED, fontSize: ROW_FONT_PX }}>
          {companyLabel(situation)}
        </span>
        <span
          className="font-mono tabular-nums text-right truncate"
          style={{ color: "#e4e4e7", fontSize: ROW_FONT_PX }}
        >
          ${fmtPrice(t.price)}
        </span>
        <span
          className="font-mono font-bold tabular-nums text-right"
          style={{ color: up ? GREEN : RED, fontSize: ROW_FONT_PX }}
        >
          {fmtPct(t.changePct)}
        </span>
        <span
          className="font-mono font-bold tracking-wide px-1.5 py-0.5 rounded justify-self-end truncate max-w-[108px]"
          style={{
            fontSize: 10,
            background: "rgba(255,184,0,0.12)",
            color: GOLD,
            border: `1px solid ${GOLD}33`,
          }}
        >
          CATALYST PENDING
        </span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 pt-0 space-y-1" style={{ paddingLeft: 36 }}>
          <p className="font-mono leading-snug" style={{ color: "#a1a1aa", fontSize: ROW_FONT_PX }}>
            {t.name}
          </p>
          <p className="font-mono" style={{ color: MUTED, fontSize: ROW_FONT_PX }}>
            {t.exchange}
            {situation.kind === "cluster" ? ` · ${situation.tickers.length} names` : ""}
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
          <p className="px-3 py-2 font-mono border-b" style={{ color: MUTED, fontSize: 11, borderColor: BORDER }}>
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
                style={{ color: "#52525b", fontSize: 10 }}
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
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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
      return (await res.json()) as MoversFeed;
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
      queryClient.setQueryData(["movers-feed"], body.feed);
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
          <p className="font-mono mt-0.5" style={{ color: MUTED, fontSize: ROW_FONT_PX }}>
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
                  <SituationCard key={s.id} situation={s} onNavigate={onNavigateToSymbol} />
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
