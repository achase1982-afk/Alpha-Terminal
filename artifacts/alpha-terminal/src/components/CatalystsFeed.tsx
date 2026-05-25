import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Flame, Loader2 } from "lucide-react";
import type { CatalystCard, CatalystsFeed, CatalystsSortKey } from "@workspace/catalysts-types";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useQuote } from "@/hooks/useQuote";
import { usePortfolioStreamStore } from "@/lib/portfolio-stream-store";
import {
  CATALYSTS_COLORS,
  CATALYSTS_MIN_FONT_PX,
  afterHoursPct,
  catalystCardPhase,
  daysUntilEarnings,
  earningsBadgeLabel,
  fmtPct,
  liveTapeMode,
  pctColor,
  sessionSettledPct,
  shouldFallOffCatalyst,
  type LiveTapeMode,
} from "@/lib/catalystsSession";

const { BG, CARD, ELEVATED, BORDER, BORDER_STRONG, GOLD, BLUE, GREEN, RED, TEXT } = CATALYSTS_COLORS;
const MONO: CSSProperties = { fontFamily: "JetBrains Mono, ui-monospace, monospace" };
const LABEL: CSSProperties = { ...MONO, fontSize: CATALYSTS_MIN_FONT_PX, color: TEXT, fontWeight: 600 };
const BODY: CSSProperties = { ...MONO, fontSize: CATALYSTS_MIN_FONT_PX, color: TEXT, fontWeight: 400 };

type SortKey = CatalystsSortKey;

const SORT_CHIPS: { key: SortKey; label: string }[] = [
  { key: "soonest", label: "SOONEST" },
  { key: "fiveDayMove", label: "5-DAY MOVE" },
  { key: "streak", label: "STREAK" },
];

function SparkBar({ moves, livePct }: { moves: number[]; livePct: number | null }) {
  const bars = [...moves, livePct ?? 0];
  return (
    <div className="flex items-end gap-0.5 h-8">
      {bars.map((m, i) => {
        const isLive = i === bars.length - 1;
        const h = Math.min(100, Math.max(12, Math.abs(m) * 8));
        return (
          <div
            key={i}
            style={{
              width: 6,
              height: h,
              background: m >= 0 ? GREEN : RED,
              opacity: isLive ? 1 : 0.35,
              borderRadius: 1,
            }}
          />
        );
      })}
    </div>
  );
}

function LiveTapeColumn({ symbol }: { symbol: string }) {
  const { data: quote } = useQuote(symbol);
  const mode: LiveTapeMode = liveTapeMode();
  const sessionPct = sessionSettledPct(quote);
  const ahPct = afterHoursPct(quote);
  const showStack = mode === "AHRS" && sessionPct != null && ahPct != null;

  if (showStack) {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <span style={{ ...BODY, color: pctColor(sessionPct) }}>
          SESSION {fmtPct(sessionPct)}
        </span>
        <span style={{ ...BODY, color: pctColor(ahPct) }}>
          AHRS {fmtPct(ahPct)}
        </span>
      </div>
    );
  }

  const pct =
    mode === "SESSION"
      ? sessionPct ?? quote?.changePct ?? null
      : ahPct ?? quote?.changePct ?? sessionPct;

  return (
    <span style={{ ...BODY, color: pctColor(pct) }}>
      {mode} {fmtPct(pct)}
    </span>
  );
}

function CatalystCardRow({
  card,
  held,
  expanded,
  onToggle,
  onNavigate,
}: {
  card: CatalystCard;
  held: boolean;
  expanded: boolean;
  onToggle: () => void;
  onNavigate?: (sym: string) => void;
}) {
  const phase = catalystCardPhase(card);
  const goldEdge = phase === "reports_today" || phase === "reporting_after_close";
  const muted = phase === "reported";
  const streakHot = card.snapshot.streak >= 5;
  const cum5 = card.snapshot.cumulative5d;

  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${goldEdge ? GOLD : BORDER}`,
        borderLeftWidth: goldEdge ? 3 : 1,
        opacity: muted ? 0.85 : 1,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-3 py-3 flex flex-col gap-2"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {expanded ? (
                <ChevronDown className="w-4 h-4 shrink-0" style={{ color: TEXT }} />
              ) : (
                <ChevronRight className="w-4 h-4 shrink-0" style={{ color: TEXT }} />
              )}
              <button
                type="button"
                className="font-bold tracking-wider"
                style={{ ...MONO, fontSize: 14, color: BLUE }}
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigate?.(card.symbol);
                }}
              >
                {card.symbol}
              </button>
              {held && (
                <span style={{ ...LABEL, color: GOLD, fontWeight: 700 }}>HELD</span>
              )}
              {streakHot && <Flame className="w-4 h-4" style={{ color: GOLD }} />}
            </div>
            <p className="mt-1 truncate" style={BODY}>
              {card.name}
              {card.sector ? ` · ${card.sector}` : ""}
            </p>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1">
            <span style={{ ...LABEL, color: goldEdge ? GOLD : TEXT }}>{earningsBadgeLabel(card)}</span>
            {!card.earningsConfirmed && (
              <span style={{ ...LABEL, color: GOLD, fontWeight: 500 }}>EST.</span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <SparkBar moves={card.snapshot.sessionMovesPct} livePct={null} />
          <div className="flex flex-col items-end gap-0.5">
            <span style={{ ...LABEL, fontWeight: 500 }}>5-DAY</span>
            <span style={{ ...BODY, color: pctColor(cum5) }}>{fmtPct(cum5)}</span>
            <LiveTapeColumn symbol={card.symbol} />
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-0 border-t flex flex-col gap-3" style={{ borderColor: BORDER }}>
          <p style={{ ...BODY, lineHeight: 1.5 }}>{card.snapshot.patternRead}</p>

          <div style={{ background: ELEVATED, border: `1px solid ${BORDER_STRONG}`, padding: 10 }}>
            <p style={{ ...LABEL, marginBottom: 8 }}>CUMULATIVE MOVE</p>
            <div className="grid grid-cols-5 gap-2 text-center">
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
                  <p style={{ ...LABEL, fontWeight: 500 }}>{label}</p>
                  <p style={{ ...BODY, color: pctColor(val) }}>{fmtPct(val)}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p style={{ ...LABEL, marginBottom: 8 }}>SESSION-BY-SESSION</p>
            <div className="flex flex-col gap-1">
              {card.snapshot.sessionMovesPct.map((m: number, i: number) => (
                <div
                  key={card.snapshot.sessionDates[i] ?? i}
                  className="flex items-center justify-center gap-2 py-1"
                  style={{
                    background: i === card.snapshot.sessionMovesPct.length - 1 ? ELEVATED : "transparent",
                  }}
                >
                  <span style={{ ...BODY, width: 48 }}>{card.snapshot.sessionDates[i]}</span>
                  <div
                    className="flex-1 h-2 rounded-sm"
                    style={{
                      background:
                        m >= 0
                          ? `linear-gradient(90deg, ${ELEVATED} 50%, ${GREEN} 50%)`
                          : `linear-gradient(90deg, ${RED} 50%, ${ELEVATED} 50%)`,
                      maxWidth: 120,
                    }}
                  />
                  <span style={{ ...BODY, color: pctColor(m), width: 56, textAlign: "right" }}>
                    {fmtPct(m)}
                  </span>
                </div>
              ))}
              <div
                className="flex items-center justify-center gap-2 py-1"
                style={{ background: ELEVATED }}
              >
                <span style={{ ...BODY, width: 48, fontWeight: 700 }}>TODAY</span>
                <span style={{ ...BODY, fontWeight: 600 }}>LIVE</span>
                <LiveTapeColumn symbol={card.symbol} />
              </div>
            </div>
          </div>

          <div
            className="flex flex-col gap-2 pt-1 border-t"
            style={{ borderColor: BORDER }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span style={BODY}>
                LAST {card.lastPrice != null ? `$${card.lastPrice.toFixed(2)}` : "—"}
              </span>
              <span style={BODY}>
                IMPLIED MOVE{" "}
                {card.impliedMovePct != null && Number.isFinite(card.impliedMovePct) ? (
                  <span style={{ color: GOLD, fontWeight: 600 }}>
                    ±{card.impliedMovePct.toFixed(1)}%
                  </span>
                ) : (
                  "—"
                )}
              </span>
            </div>
            <span style={BODY}>
              EARNINGS {card.earningsDate}
              {card.earningsTiming ? ` · ${card.earningsTiming}` : ""}
              {!card.earningsConfirmed ? " · EST." : ""}
            </span>
          </div>
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
  const [sortKey, setSortKey] = useState<SortKey>("soonest");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const account = usePortfolioStreamStore((s) => s.account);

  const heldSymbols = useMemo(() => {
    const set = new Set<string>();
    for (const p of account?.positions ?? []) {
      const sym = (p as { symbol?: string; instrument?: { symbol?: string } }).symbol
        ?? (p as { instrument?: { symbol?: string } }).instrument?.symbol;
      if (sym) set.add(String(sym).toUpperCase());
    }
    return set;
  }, [account?.positions]);

  const { data, isLoading, error } = useQuery({
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

  const building = data?.status === "building" || (data?.status === "empty" && !data.builtAt);

  return (
    <div className="flex flex-col min-h-full" style={{ background: BG, color: TEXT }}>
      <div className="px-3 py-3 border-b shrink-0" style={{ borderColor: BORDER, background: CARD }}>
        <h1 style={{ ...LABEL, color: GOLD, letterSpacing: "0.15em" }}>CATALYSTS</h1>
        <p style={{ ...BODY, marginTop: 6 }}>
          EARNINGS · NEXT 10 DAYS · {sorted.length} NAMES
        </p>
        <p style={{ ...BODY, marginTop: 4, fontWeight: 300 }}>
          Pre-earnings drift into scheduled prints. Settled sessions are frozen at the prior close.
        </p>
        <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
          {SORT_CHIPS.map((chip) => {
            const active = sortKey === chip.key;
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => setSortKey(chip.key)}
                className="shrink-0 px-3 py-1.5 rounded-full font-mono tracking-wider"
                style={{
                  ...LABEL,
                  border: `1px solid ${active ? GOLD : BORDER_STRONG}`,
                  color: active ? GOLD : TEXT,
                  background: CARD,
                }}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>

      {isLoading && !data && (
        <div className="flex flex-1 items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: GOLD }} />
        </div>
      )}

      {error && !data && (
        <p className="px-3 py-6 text-center" style={{ ...BODY, color: RED }}>
          Failed to load catalysts feed
        </p>
      )}

      {building && (
        <p className="px-3 py-8 text-center" style={BODY}>
          Building catalysts snapshot — first load may take a minute.
        </p>
      )}

      {data && !building && sorted.length === 0 && (
        <p className="px-3 py-8 text-center" style={BODY}>
          No upcoming earnings names passed the tradeability gate in the next 10 days.
        </p>
      )}

      <div className="flex flex-col gap-2 p-2">
        {sorted.map((card) => (
          <CatalystCardRow
            key={card.symbol}
            card={card}
            held={heldSymbols.has(card.symbol)}
            expanded={!!expanded[card.symbol]}
            onToggle={() => toggle(card.symbol)}
            onNavigate={onNavigateToSymbol}
          />
        ))}
      </div>
    </div>
  );
}
