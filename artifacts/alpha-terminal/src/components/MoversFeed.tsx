import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import type {
  FilteredName,
  MoversCatalystType,
  MoversConfidence,
  MoversFeed,
  MoversPosture,
  Situation,
} from "@workspace/movers-types";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { MOVERS_MANUAL_REFRESH_DEBOUNCE_MS, MOVERS_POLL_INTERVAL_MS } from "@workspace/movers-types";

const BG = "#0D0D0D";
const CARD = "#1A1A1A";
const ELEVATED = "#222222";
const BORDER = "#2A2A2A";
const BORDER_STRONG = "#3A3A3A";
const PRIMARY = "#0064FF";
const GOLD = "#FFB800";
const GREEN = "#00C853";
const RED = "#FF3B30";
const WHITE = "#FFFFFF";

const CATALYST_COLORS: Record<MoversCatalystType, string> = {
  GOV: PRIMARY,
  ANALYST: "#7C4DFF",
  CONTRACT: "#00B8D4",
  EARNINGS: GOLD,
  MA: "#FF6D00",
  SECTOR: "#69F0AE",
  NONE: BORDER_STRONG,
};

const POSTURE_STYLES: Record<MoversPosture, { bg: string; color: string; border: string }> = {
  WATCH: { bg: `${PRIMARY}22`, color: PRIMARY, border: PRIMARY },
  WAIT: { bg: `${GOLD}22`, color: GOLD, border: GOLD },
  PASS: { bg: `${RED}22`, color: RED, border: RED },
};

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

function tickerHeadline(s: Situation): string {
  if (s.kind === "cluster") {
    return s.tickers.map((t) => t.symbol).join(" · ");
  }
  return s.tickers[0]?.symbol ?? s.label;
}

function FunnelBar({ funnel }: { funnel: MoversFeed["funnel"] }) {
  const items = [
    { label: "Detected", value: funnel.detected },
    { label: "Filtered", value: funnel.filtered },
    { label: "Tradeable", value: funnel.tradeable },
    { label: "Situations", value: funnel.situations },
  ];
  return (
    <div
      className="grid grid-cols-4 gap-2 px-3 py-3 border-b shrink-0"
      style={{ background: CARD, borderColor: BORDER, fontFamily: "Inter, system-ui, sans-serif" }}
    >
      {items.map((item) => (
        <div key={item.label} className="text-center rounded-md py-1.5" style={{ background: ELEVATED }}>
          <div className="text-[10px] uppercase tracking-widest" style={{ color: WHITE }}>
            {item.label}
          </div>
          <div
            className="font-bold mt-1 tabular-nums text-sm"
            style={{
              color: item.label === "Tradeable" ? GOLD : WHITE,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function CatalystTag({ type }: { type: MoversCatalystType }) {
  return (
    <span
      className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded"
      style={{
        color: CATALYST_COLORS[type],
        border: `1px solid ${CATALYST_COLORS[type]}55`,
        background: `${CATALYST_COLORS[type]}18`,
      }}
    >
      {type}
    </span>
  );
}

function PosturePill({ posture }: { posture: MoversPosture }) {
  const style = POSTURE_STYLES[posture];
  return (
    <span
      className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-bold"
      style={{ color: style.color, background: style.bg, border: `1px solid ${style.border}` }}
    >
      {posture}
    </span>
  );
}

function ConfidenceBadge({ level }: { level: MoversConfidence }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: WHITE }}>
      {level} confidence
    </span>
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
  const lead = situation.tickers[0];
  if (!lead) return null;
  const up = lead.changePct >= 0;
  const isCluster = situation.kind === "cluster";

  return (
    <div
      className="mx-3 my-2 rounded-lg border overflow-hidden"
      style={{ background: CARD, borderColor: BORDER_STRONG }}
    >
      <button
        type="button"
        className="w-full text-left px-3 py-3"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {expanded ? (
              <ChevronDown className="w-4 h-4 shrink-0" style={{ color: WHITE }} />
            ) : (
              <ChevronRight className="w-4 h-4 shrink-0" style={{ color: WHITE }} />
            )}
            <div className="min-w-0">
              <div
                className="font-bold text-sm truncate"
                style={{ color: WHITE, fontFamily: "'JetBrains Mono', monospace" }}
              >
                {tickerHeadline(situation)}
              </div>
              {isCluster && (
                <div className="text-[11px] mt-0.5 truncate" style={{ color: WHITE, fontFamily: "Inter, sans-serif" }}>
                  {situation.label}
                </div>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div
              className="font-bold tabular-nums text-sm"
              style={{ color: WHITE, fontFamily: "'JetBrains Mono', monospace" }}
            >
              ${fmtPrice(lead.price)}
            </div>
            <div
              className="font-bold tabular-nums text-sm"
              style={{ color: up ? GREEN : RED, fontFamily: "'JetBrains Mono', monospace" }}
            >
              {fmtPct(lead.changePct)}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-2">
          <CatalystTag type={situation.catalystType} />
          <PosturePill posture={situation.posture} />
          <ConfidenceBadge level={situation.confidence} />
        </div>

        <p className="mt-2 text-[12px] leading-snug" style={{ color: WHITE, fontFamily: "Inter, sans-serif" }}>
          {situation.catalyst}
        </p>
        <p
          className="mt-1 text-[11px] leading-snug italic"
          style={{ color: WHITE, fontFamily: "'JetBrains Mono', monospace" }}
        >
          {situation.read}
        </p>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-0 border-t space-y-2" style={{ borderColor: BORDER }}>
          {situation.tickers.map((t) => (
            <div
              key={t.symbol}
              className="flex items-start gap-2 py-2 border-b last:border-b-0"
              style={{ borderColor: BORDER }}
            >
              <div className="w-14 shrink-0 font-bold text-xs" style={{ color: WHITE, fontFamily: "'JetBrains Mono', monospace" }}>
                {t.symbol}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] truncate" style={{ color: WHITE, fontFamily: "Inter, sans-serif" }}>
                  {t.name}
                </p>
                {t.sector && (
                  <p className="text-[10px] mt-0.5" style={{ color: WHITE, fontFamily: "Inter, sans-serif" }}>
                    {t.sector}
                    {t.industry ? ` · ${t.industry}` : ""}
                  </p>
                )}
                {t.description && (
                  <p className="text-[10px] mt-1 line-clamp-3" style={{ color: WHITE, fontFamily: "Inter, sans-serif" }}>
                    {t.description}
                  </p>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="tabular-nums text-xs font-bold" style={{ color: WHITE, fontFamily: "'JetBrains Mono', monospace" }}>
                  ${fmtPrice(t.price)}
                </div>
                <div
                  className="tabular-nums text-xs font-bold"
                  style={{ color: t.changePct >= 0 ? GREEN : RED, fontFamily: "'JetBrains Mono', monospace" }}
                >
                  {fmtPct(t.changePct)}
                </div>
                {onNavigate && (
                  <button
                    type="button"
                    className="mt-1 text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: PRIMARY }}
                    onClick={() => onNavigate(t.symbol)}
                  >
                    Open →
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilteredSection({ filtered }: { filtered: FilteredName[] }) {
  const [open, setOpen] = useState(false);
  if (filtered.length === 0) return null;

  const reasonLabel: Record<FilteredName["reason"], string> = {
    LEVERAGED_ETF: "Leveraged exchange-traded fund",
    SUB_5: "Price below five dollars",
    MICRO_CAP: "Market capitalization below five hundred million",
  };

  return (
    <div className="border-t shrink-0 mx-0" style={{ borderColor: BORDER }}>
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2.5 font-mono font-bold tracking-wider"
        style={{ background: CARD, color: WHITE, fontSize: 12 }}
        onClick={() => setOpen((o) => !o)}
      >
        <span>Filtered ({filtered.length})</span>
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>
      {open && (
        <div style={{ background: BG }}>
          <p className="px-3 py-2 border-b text-[11px]" style={{ color: WHITE, borderColor: BORDER, fontFamily: "Inter, sans-serif" }}>
            Names removed by leverage filter, minimum price, or market capitalization.
          </p>
          {filtered.map((row) => (
            <div
              key={`${row.symbol}-${row.reason}`}
              className="flex items-center gap-2 px-3 py-2 border-b"
              style={{ borderColor: BORDER, fontSize: 12 }}
            >
              <span className="font-bold w-14 shrink-0" style={{ color: WHITE, fontFamily: "'JetBrains Mono', monospace" }}>
                {row.symbol}
              </span>
              <span className="flex-1 truncate" style={{ color: WHITE, fontFamily: "Inter, sans-serif" }}>
                {row.name}
              </span>
              <span className="tabular-nums shrink-0" style={{ color: WHITE, fontFamily: "'JetBrains Mono', monospace" }}>
                ${fmtPrice(row.price)}
              </span>
              <span
                className="tabular-nums font-bold w-16 text-right shrink-0"
                style={{ color: row.changePct >= 0 ? GREEN : RED, fontFamily: "'JetBrains Mono', monospace" }}
              >
                {fmtPct(row.changePct)}
              </span>
              <span className="text-[10px] uppercase tracking-wide w-28 text-right shrink-0" style={{ color: WHITE }}>
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

  const { data, isLoading, isFetching, error } = useQuery({
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

  const situations = useMemo(() => feed?.situations ?? [], [feed?.situations]);

  return (
    <div className="flex flex-col min-h-full" style={{ background: BG, color: WHITE }}>
      <div
        className="flex items-center justify-between px-3 py-2 border-b shrink-0"
        style={{ borderColor: BORDER, background: CARD }}
      >
        <div>
          <h1
            className="font-bold tracking-[0.2em] uppercase text-sm"
            style={{ color: GOLD, fontFamily: "Inter, sans-serif" }}
          >
            Movers
          </h1>
          <p className="mt-0.5 text-[11px]" style={{ color: WHITE, fontFamily: "'JetBrains Mono', monospace" }}>
            {pollStatusLabel(feed)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={refreshBusy}
          className="p-2 rounded-lg border transition-opacity disabled:opacity-40"
          style={{ borderColor: BORDER_STRONG, color: WHITE }}
          aria-label="Refresh movers"
        >
          {refreshBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      {isLoading && !feed && (
        <div className="flex flex-1 items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: PRIMARY }} />
        </div>
      )}

      {error && !feed && (
        <div className="px-3 py-6 text-center text-sm" style={{ color: RED, fontFamily: "Inter, sans-serif" }}>
          Failed to load movers feed
        </div>
      )}

      {feed && (
        <>
          <FunnelBar funnel={feed.funnel} />
          <div className="flex-1 min-h-0 overflow-y-auto pb-2">
            {situations.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm" style={{ color: WHITE, fontFamily: "Inter, sans-serif" }}>
                No attributed situations in the latest poll.
              </p>
            ) : (
              situations.map((s) => (
                <SituationCard key={s.id} situation={s} onNavigate={onNavigateToSymbol} />
              ))
            )}
          </div>
          <FilteredSection filtered={feed.filtered} />
        </>
      )}
    </div>
  );
}
