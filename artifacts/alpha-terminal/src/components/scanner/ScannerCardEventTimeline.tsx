import { useEffect, useMemo, useState } from "react";
import { Box, ChevronDown, ChevronRight, Zap } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { ScannerUaiEventWire, ScannerV3SymbolEventsResponse } from "@/lib/scannerScanApiTypes";
import { cn } from "@/lib/utils";
import {
  dashCell,
  formatCompactInt,
  scannerNumericFontStyle,
} from "./scannerCard.utils";

function formatTimeHm(iso: string): string {
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return dashCell();
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
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
  if (bucket === "deep_itm") return "deep ITM";
  if (bucket === "itm") return "ITM";
  if (bucket === "atm") return "ATM";
  if (bucket === "otm") return "OTM";
  return "deep OTM";
}

function sideBadge(side: ScannerUaiEventWire["side"]): { label: string; cls: string } {
  if (side === "ask") return { label: "BUY", cls: "border-emerald-500/45 bg-emerald-500/10 text-emerald-200/95" };
  if (side === "bid") return { label: "SELL", cls: "border-red-500/45 bg-red-500/10 text-red-200/95" };
  if (side === "mid") return { label: "MID", cls: "border-zinc-600/50 bg-zinc-800/80 text-zinc-300" };
  return { label: "—", cls: "border-zinc-700/60 bg-zinc-900/60 text-zinc-500" };
}

function dirArrow(e: ScannerUaiEventWire) {
  if (e.direction === "bullish") return <span className="text-terminal-success">↗</span>;
  if (e.direction === "bearish") return <span className="text-terminal-danger">↘</span>;
  return <span className="text-muted-foreground">→</span>;
}

type TimelineUnit =
  | { kind: "cluster"; groupId: string; items: ScannerUaiEventWire[] }
  | { kind: "single"; event: ScannerUaiEventWire };

function buildTimelineUnits(events: ScannerUaiEventWire[]): TimelineUnit[] {
  const byGroup = new Map<string, ScannerUaiEventWire[]>();
  for (const e of events) {
    const g = e.syntheticLegGroupId;
    if (!g) continue;
    const arr = byGroup.get(g) ?? [];
    arr.push(e);
    byGroup.set(g, arr);
  }
  const emitted = new Set<string>();
  const out: TimelineUnit[] = [];
  for (const e of events) {
    const g = e.syntheticLegGroupId;
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
    out.push({ kind: "single", event: e });
  }
  return out;
}

function EventRow({ e }: { e: ScannerUaiEventWire }) {
  const sb = sideBadge(e.side);
  const prints = formatCompactInt(e.contracts);
  const volOiExtra =
    e.volOiRatio != null && Number.isFinite(e.volOiRatio) && e.volOiRatio > 1
      ? `Vol/OI ${e.volOiRatio.toFixed(2)}`
      : null;
  return (
    <div className="rounded border border-zinc-800/80 bg-zinc-950/40 px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
        <span className="font-mono text-zinc-400">{formatTimeHm(e.ts)}</span>
        {e.isSweep ? (
          <span title="Sweep" className="inline-flex">
            <Zap className="h-3 w-3 shrink-0 text-amber-400" aria-hidden />
          </span>
        ) : e.isBlock ? (
          <span title="Block" className="inline-flex">
            <Box className="h-3 w-3 shrink-0 text-zinc-400" aria-hidden />
          </span>
        ) : (
          <span className="h-3 w-3 shrink-0 rounded-sm bg-zinc-700/80" aria-hidden />
        )}
        <span className="font-mono font-semibold text-zinc-100">{contractLabel(e.expiration, e.strike, e.callPut)}</span>
        <span className="text-zinc-500">
          {e.dte}d · {moneynessShort(e.moneynessBucket)}
          {e.is0dte ? " · 0DTE" : ""}
        </span>
        <span className="ml-auto shrink-0">{dirArrow(e)}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-zinc-400">
        <span className={cn("rounded border px-1 py-0.5 font-mono font-bold uppercase", sb.cls)}>{sb.label}</span>
        <span className="font-mono text-zinc-200">${e.notional.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
        <span className="font-mono">{prints} prints</span>
        <span className="rounded border border-zinc-700/50 px-1 py-0.5 font-mono text-zinc-400">{e.nbboPositionLabel}</span>
        {volOiExtra ? <span className="font-mono text-amber-200/80">{volOiExtra}</span> : null}
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
    <div className="rounded border border-amber-500/35 bg-amber-500/5">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide text-amber-200/95"
      >
        <span>
          Multi-leg · {unit.items.length} legs ·{" "}
          <span className="font-mono font-semibold normal-case tracking-tight text-zinc-100">
            ${totalN.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        </span>
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
      </button>
      {open ? (
        <div className="space-y-1 border-t border-amber-500/20 px-2 pb-2 pt-1">
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
      <div className="space-y-1.5" style={scannerNumericFontStyle}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded border border-zinc-800/60 bg-zinc-900/40" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-[11px] text-red-400/90">{error}</p>;
  }

  if (!payload || units.length === 0) {
    return <p className="text-[11px] text-muted-foreground">No events in window.</p>;
  }

  return (
    <div className="space-y-1.5" style={scannerNumericFontStyle}>
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
