import { useEffect, useMemo, useState } from "react";
import { Box, ChevronDown, ChevronRight, Zap } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { ScannerUaiEventWire, ScannerV3SymbolEventsResponse } from "@/lib/scannerScanApiTypes";
import { cn } from "@/lib/utils";
import {
  dashCell,
  formatNotionalTickerUi,
  scannerNumericFontStyle,
  scannerSansFontStyle,
} from "./scannerCard.utils";

function formatTimeHm(iso: string): string {
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return dashCell();
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    });
  } catch {
    return dashCell();
  }
}

function mmDdYmd(ymd: string): string {
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return ymd;
  return `${m[2]}/${m[3]}`;
}

function contractLabel(expiration: string, strike: number, callPut: "C" | "P"): string {
  const mmdd = expiration.length >= 10 ? mmDdYmd(expiration.slice(0, 10)) : mmDdYmd(expiration);
  const strikeStr = Number.isInteger(strike) ? String(strike) : strike.toFixed(2).replace(/\.?0+$/, "");
  return `${mmdd} $${strikeStr}${callPut}`;
}

function moneynessShort(bucket: ScannerUaiEventWire["moneynessBucket"]): string {
  if (bucket === "deep_itm") return "DEEP ITM";
  if (bucket === "itm") return "ITM";
  if (bucket === "atm") return "ATM";
  if (bucket === "otm") return "OTM";
  return "DEEP OTM";
}

function eventRowGauge(e: ScannerUaiEventWire): number {
  if (e.volOiRatio != null && Number.isFinite(e.volOiRatio) && e.volOiRatio > 0) {
    return Math.min(99, Math.max(35, Math.round(38 + e.volOiRatio * 16)));
  }
  if (e.aggressorConfidence != null && Number.isFinite(e.aggressorConfidence)) {
    return Math.min(99, Math.max(30, Math.round(e.aggressorConfidence * 100)));
  }
  return 55;
}

function sideNotionalNode(e: ScannerUaiEventWire) {
  const amt = formatNotionalTickerUi(e.notional);
  if (e.side === "ask") {
    return <span className="font-semibold text-[#4ade80]">BUY {amt}</span>;
  }
  if (e.side === "bid") {
    return <span className="font-semibold text-[#fb7185]">SELL {amt}</span>;
  }
  if (e.side === "mid") {
    return <span className="font-semibold text-[#FFB800]">mixed {amt}</span>;
  }
  return <span className="font-semibold text-zinc-500">— {amt}</span>;
}

function nbboPhrase(e: ScannerUaiEventWire): { text: string; cls: string } {
  const s = e.nbboPositionLabel.toLowerCase();
  if (s.includes("sweep")) return { text: `· ${e.nbboPositionLabel}`, cls: "text-[#FFB800]" };
  if (s.includes("above ask")) return { text: `· ${e.nbboPositionLabel}`, cls: "text-[#4ade80]" };
  if (s.includes("below bid")) return { text: `· ${e.nbboPositionLabel}`, cls: "text-[#fb7185]" };
  if (s.includes("at ask") || s.includes("at bid")) return { text: `· ${e.nbboPositionLabel}`, cls: "text-zinc-500" };
  if (s === "mid") return { text: `· ${e.nbboPositionLabel}`, cls: "text-[#FFB800]" };
  return { text: `· ${e.nbboPositionLabel}`, cls: "text-zinc-500" };
}

function volOiPhrase(e: ScannerUaiEventWire): { text: string; show: boolean } {
  if (e.volOiRatio != null && Number.isFinite(e.volOiRatio) && e.volOiRatio > 1) {
    return { text: ` · mid ${e.volOiRatio.toFixed(1)}x vol/OI`, show: true };
  }
  return { text: "", show: false };
}

function dirArrow(e: ScannerUaiEventWire) {
  if (e.direction === "bullish") return <span className="text-lg leading-none text-[#4ade80]">↗</span>;
  if (e.direction === "bearish") return <span className="text-lg leading-none text-[#fb7185]">↘</span>;
  return <span className="text-lg leading-none text-zinc-500">→</span>;
}

type TimelineUnit =
  | { kind: "cluster"; groupId: string; items: ScannerUaiEventWire[] }
  | { kind: "single"; event: ScannerUaiEventWire };

function buildTimelineUnits(events: ScannerUaiEventWire[]): TimelineUnit[] {
  const byGroup = new Map<string, ScannerUaiEventWire[]>();
  for (const ev of events) {
    const g = ev.syntheticLegGroupId;
    if (!g) continue;
    const arr = byGroup.get(g) ?? [];
    arr.push(ev);
    byGroup.set(g, arr);
  }
  const emitted = new Set<string>();
  const out: TimelineUnit[] = [];
  for (const ev of events) {
    const g = ev.syntheticLegGroupId;
    if (g) {
      const legs = byGroup.get(g) ?? [];
      if (legs.length >= 2) {
        if (!emitted.has(g)) {
          emitted.add(g);
          const sorted = [...legs].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
          out.push({ kind: "cluster", groupId: g, items: sorted });
        }
        continue;
      }
    }
    out.push({ kind: "single", event: ev });
  }
  return out;
}

function EventRow({ e }: { e: ScannerUaiEventWire }) {
  const prints = Math.max(1, Math.round(e.contracts / 300));
  const printsLabel = `${e.contracts.toLocaleString()}c · ${prints} prints`;
  const nbbo = nbboPhrase(e);
  const voi = volOiPhrase(e);
  const gauge = eventRowGauge(e);

  return (
    <div className="border-b border-zinc-900 py-2.5 last:border-b-0">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[11px] tabular-nums text-zinc-500" style={scannerNumericFontStyle}>
            {formatTimeHm(e.ts)}
          </span>
          {e.isSweep ? (
            <span className="inline-flex shrink-0" title="Sweep">
              <Zap className="h-3.5 w-3.5 text-[#FFB800]" aria-hidden />
            </span>
          ) : e.isBlock ? (
            <span className="inline-flex shrink-0" title="Block">
              <Box className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
            </span>
          ) : (
            <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-sm bg-zinc-800" aria-hidden />
          )}
          <span
            className="text-[13px] font-bold tabular-nums tracking-tight text-white"
            style={scannerNumericFontStyle}
          >
            {contractLabel(e.expiration, e.strike, e.callPut)}
          </span>
          <span className="text-[11px] font-medium uppercase text-zinc-500" style={scannerSansFontStyle}>
            {e.dte}D · {moneynessShort(e.moneynessBucket)}
            {e.is0dte ? " · 0DTE" : ""}
          </span>
        </div>
        <div className="shrink-0 pt-0.5">{dirArrow(e)}</div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px]"
          style={scannerNumericFontStyle}
        >
          <span className="inline-flex items-center gap-1">{sideNotionalNode(e)}</span>
          <span className="text-zinc-500">{printsLabel}</span>
          <span className={cn("font-medium", nbbo.cls)}>{nbbo.text}</span>
          {voi.show ? <span className="font-medium text-[#FFB800]">{voi.text}</span> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="relative h-1 w-14 overflow-hidden rounded-sm bg-zinc-800">
            <div className="absolute inset-y-0 left-0 rounded-sm bg-amber-500" style={{ width: `${gauge}%` }} />
          </div>
          <span
            className="w-6 text-right text-[10px] font-semibold tabular-nums text-zinc-300"
            style={scannerNumericFontStyle}
          >
            {gauge}
          </span>
        </div>
      </div>
    </div>
  );
}

function ClusterBlock({
  unit,
  open,
  onToggle,
}: {
  unit: Extract<TimelineUnit, { kind: "cluster" }>;
  open: boolean;
  onToggle: () => void;
}) {
  const totalN = unit.items.reduce((s, x) => s + (Number.isFinite(x.notional) ? x.notional : 0), 0);
  return (
    <div className="border-b border-zinc-900 py-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#FFB800]"
        style={scannerSansFontStyle}
      >
        <span>
          MULTI-LEG · {unit.items.length} legs ·{" "}
          <span className="font-mono font-semibold normal-case text-white" style={scannerNumericFontStyle}>
            {formatNotionalTickerUi(totalN)}
          </span>
        </span>
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
      </button>
      {open ? (
        <div className="border-l border-[#FFB800]/35 pl-2">
          {unit.items.map((ev) => (
            <EventRow key={ev.id} e={ev} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export type ScannerSymbolEventsState = {
  loading: boolean;
  error: string | null;
  payload: ScannerV3SymbolEventsResponse | null;
};

export function useScannerSymbolEvents(symbol: string): ScannerSymbolEventsState {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [payload, setPayload] = useState<ScannerV3SymbolEventsResponse | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;
    const sym = symbol.trim().toUpperCase();
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetchWithAuth(`/api/scanner/v3/symbol/${encodeURIComponent(sym)}/events?window=4h`, {
          signal: ac.signal,
        });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          throw new Error(t.trim() || `HTTP ${res.status}`);
        }
        const json = (await res.json()) as ScannerV3SymbolEventsResponse;
        if (!cancelled) setPayload(json);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        if (!cancelled) setErr((e as Error).message || "Failed to load events");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [symbol]);

  return { loading, error: err, payload };
}

export function ScannerCardEventTimeline({ eventsState }: { eventsState: ScannerSymbolEventsState }) {
  const { loading, error, payload } = eventsState;
  const [openClusters, setOpenClusters] = useState<Set<string>>(() => new Set());

  const units = useMemo(() => {
    const evs = payload?.events;
    if (!Array.isArray(evs)) return [];
    return buildTimelineUnits(evs);
  }, [payload?.events]);

  if (loading) {
    return (
      <div className="space-y-0">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="border-b border-zinc-900 py-3">
            <div className="h-3 w-1/3 animate-pulse rounded bg-zinc-900" />
            <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-zinc-900" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-[11px] text-[#fb7185]">{error}</p>;
  }

  if (!payload || units.length === 0) {
    return <p className="text-[11px] text-zinc-500">No events in window.</p>;
  }

  return (
    <div>
      {units.map((u) =>
        u.kind === "cluster" ? (
          <ClusterBlock
            key={u.groupId}
            unit={u}
            open={openClusters.has(u.groupId)}
            onToggle={() => {
              setOpenClusters((prev) => {
                const next = new Set(prev);
                if (next.has(u.groupId)) next.delete(u.groupId);
                else next.add(u.groupId);
                return next;
              });
            }}
          />
        ) : (
          <EventRow key={u.event.id} e={u.event} />
        ),
      )}
    </div>
  );
}
