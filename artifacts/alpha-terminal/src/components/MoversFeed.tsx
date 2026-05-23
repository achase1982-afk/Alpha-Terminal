import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import type { FilteredName, MoversFeed, Situation } from "@workspace/movers-types";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BG = "#0c0c0c";
const PANEL = "#111";
const BORDER = "rgba(39, 39, 42, 0.8)";
const MUTED = "#71717a";
const GOLD = "#FFB800";
const GREEN = "#00d166";
const RED = "#f23645";

function fmtPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toFixed(0);
  if (n >= 100) return n.toFixed(2);
  return n.toFixed(n < 1 ? 3 : 2);
}

function fmtCaptured(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    });
  } catch {
    return "—";
  }
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
      className="grid grid-cols-4 gap-1 px-3 py-2 border-b font-mono text-[9px] tracking-wider"
      style={{ background: PANEL, borderColor: BORDER }}
    >
      {items.map((item) => (
        <div key={item.label} className="text-center">
          <div style={{ color: MUTED }}>{item.label}</div>
          <div className="text-sm font-bold mt-0.5" style={{ color: item.color }}>
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
  const t = situation.tickers[0];
  if (!t) return null;
  const up = t.changePct >= 0;

  return (
    <div className="border-b" style={{ borderColor: BORDER, background: BG }}>
      <button
        type="button"
        className="w-full text-left px-3 py-1.5 flex items-center gap-2 min-h-[36px]"
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: MUTED }} />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: MUTED }} />
        )}
        <span className="font-mono text-xs font-bold w-12 shrink-0" style={{ color: "#fafafa" }}>
          {t.symbol}
        </span>
        <span className="flex-1 truncate font-mono text-[10px]" style={{ color: MUTED }}>
          {situation.label}
        </span>
        <span className="font-mono text-[11px] tabular-nums shrink-0" style={{ color: "#e4e4e7" }}>
          ${fmtPrice(t.price)}
        </span>
        <span
          className="font-mono text-[11px] font-bold tabular-nums w-14 text-right shrink-0"
          style={{ color: up ? GREEN : RED }}
        >
          {fmtPct(t.changePct)}
        </span>
        <span
          className="font-mono text-[8px] font-bold tracking-wide px-1.5 py-0.5 rounded shrink-0"
          style={{ background: "rgba(255,184,0,0.12)", color: GOLD, border: `1px solid ${GOLD}33` }}
        >
          CATALYST PENDING
        </span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 pt-0 pl-9 space-y-1">
          <p className="font-mono text-[10px] leading-snug" style={{ color: "#a1a1aa" }}>
            {t.name}
          </p>
          <p className="font-mono text-[9px]" style={{ color: MUTED }}>
            {t.exchange}
            {situation.kind === "cluster" ? ` · ${situation.tickers.length} names` : ""}
          </p>
          {onNavigate && (
            <button
              type="button"
              className="font-mono text-[9px] font-bold tracking-wider mt-1"
              style={{ color: GOLD }}
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
    <div className="border-t" style={{ borderColor: BORDER }}>
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 font-mono text-[10px] font-bold tracking-wider"
        style={{ background: PANEL, color: MUTED }}
        onClick={() => setOpen((o) => !o)}
      >
        <span>FILTERED ({filtered.length})</span>
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>
      {open && (
        <div style={{ background: BG }}>
          {filtered.map((row) => (
            <div
              key={`${row.symbol}-${row.reason}`}
              className="flex items-center gap-2 px-3 py-1 font-mono text-[10px] border-b"
              style={{ borderColor: BORDER, minHeight: 28 }}
            >
              <span className="w-11 font-bold" style={{ color: "#a1a1aa" }}>
                {row.symbol}
              </span>
              <span className="flex-1 truncate" style={{ color: MUTED }}>
                {row.name}
              </span>
              <span className="text-[9px] uppercase tracking-wide shrink-0" style={{ color: "#52525b" }}>
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
  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["movers-feed"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/movers");
      if (!res.ok) throw new Error(`Movers feed HTTP ${res.status}`);
      return (await res.json()) as MoversFeed;
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });

  const feed = data;
  const onRefresh = useCallback(() => void refetch(), [refetch]);

  return (
    <div className="flex flex-col min-h-full" style={{ background: BG, color: "#fafafa" }}>
      <div
        className="flex items-center justify-between px-3 py-2 border-b shrink-0"
        style={{ borderColor: BORDER, background: PANEL }}
      >
        <div>
          <h1 className="font-mono text-xs font-bold tracking-[0.2em]" style={{ color: GOLD }}>
            MOVERS
          </h1>
          <p className="font-mono text-[9px] mt-0.5" style={{ color: MUTED }}>
            {feed?.capturedAt
              ? `Last poll ${fmtCaptured(feed.capturedAt)} ET`
              : "Waiting for first market-hours poll"}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isFetching}
          className="p-2 rounded-lg border transition-opacity disabled:opacity-40"
          style={{ borderColor: BORDER, color: MUTED }}
          aria-label="Refresh movers"
        >
          {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      {isLoading && !feed && (
        <div className="flex flex-1 items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: GOLD }} />
        </div>
      )}

      {error && !feed && (
        <div className="px-3 py-6 font-mono text-xs text-center" style={{ color: RED }}>
          Failed to load movers feed
        </div>
      )}

      {feed && (
        <>
          <FunnelBar funnel={feed.funnel} />
          <div className="flex-1">
            {feed.situations.length === 0 ? (
              <p className="px-3 py-8 font-mono text-[11px] text-center" style={{ color: MUTED }}>
                No tradeable movers in the latest poll.
              </p>
            ) : (
              feed.situations.map((s: Situation) => (
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
