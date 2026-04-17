import { useState } from "react";
import { X, Trash2, ChevronDown, ChevronUp, History } from "lucide-react";
import { useTerminalStore } from "@/lib/store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  StrategistV2RecommendationCard,
  StrategistV2BlockCard,
  normalizeBlockReason,
  type StrategistV2Result,
  type StrategistSendToOrderPayload,
} from "@/components/StrategistV2Card";
import { HistoryDebateTranscript } from "@/components/HistoryDebateTranscript";

const HISTORY_CATEGORY_LABELS: Record<string, string> = {
  TOXIC_BLOCK: "Toxic Block",
  LOW_CONFIDENCE: "Low Confidence",
  NO_EDGE: "No Edge",
  CATALYST_CONFLICT: "Catalyst Conflict",
  VALIDATION_FAIL: "Validation Failed",
  MISSING_DATA: "Missing Data",
  STOCK_HALTED: "Stock Halted",
  PRICING_MARKET_CLOSED: "Market Closed",
  UNKNOWN: "Blocked",
};

interface Props {
  onSendToOrder?: (payload: StrategistSendToOrderPayload) => void;
  excludeJobIds?: Set<string>;
}

export function StrategistHistoryList({ onSendToOrder, excludeJobIds }: Props) {
  const history = useTerminalStore((s) => s.strategistHistory);
  const removeHistoryCard = useTerminalStore((s) => s.removeHistoryCard);
  const clearAllHistory = useTerminalStore((s) => s.clearAllHistory);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [confirmClear, setConfirmClear] = useState(false);

  const visible = excludeJobIds
    ? history.filter((h) => !excludeJobIds.has(h.jobId))
    : history;

  if (!visible.length) return null;

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleRemove = async (id: number) => {
    removeHistoryCard(id); // optimistic
    try {
      await fetchWithAuth(`/api/strategist/history/${id}/clear`, { method: "PATCH" });
    } catch {
      // best-effort; don't restore UI to avoid jank
    }
  };

  const handleClearAll = async () => {
    clearAllHistory(); // optimistic
    setConfirmClear(false);
    try {
      await fetchWithAuth(`/api/strategist/history/all`, { method: "DELETE" });
    } catch {
      // best-effort
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5">
          <History className="w-3 h-3 text-zinc-500" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            Strategist History · {visible.length}
          </span>
        </div>
        {confirmClear ? (
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-zinc-400">Clear all?</span>
            <button
              onClick={handleClearAll}
              className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded text-white"
              style={{ background: "#ff4b5c" }}
            >
              Yes
            </button>
            <button
              onClick={() => setConfirmClear(false)}
              className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded text-zinc-300"
              style={{ background: "rgba(255,255,255,0.06)" }}
            >
              No
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmClear(true)}
            className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded text-zinc-400 hover:text-white transition-colors"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            <Trash2 className="w-3 h-3" />
            Clear All
          </button>
        )}
      </div>

      {visible.map((row) => {
        const result = row.cardJson as StrategistV2Result;
        const isOpen = expanded.has(row.id);
        const ts = new Date(row.createdAt);
        const tsLabel = isNaN(ts.getTime()) ? "" : ts.toLocaleString();
        return (
          <div
            key={row.id}
            className="rounded-lg overflow-hidden"
            style={{ background: "#0a0a0c", border: "1px solid #1f1f22" }}
          >
            <div className="flex items-center justify-between px-3 py-2 gap-2">
              <button
                onClick={() => toggle(row.id)}
                className="flex items-center gap-2 flex-1 min-w-0 text-left"
              >
                {isOpen ? (
                  <ChevronUp className="w-3 h-3 text-zinc-500 shrink-0" />
                ) : (
                  <ChevronDown className="w-3 h-3 text-zinc-500 shrink-0" />
                )}
                <span className="font-mono text-[12px] font-bold text-white">{row.ticker}</span>
                <span className="font-mono text-[10px] text-zinc-500">·</span>
                <span className="font-mono text-[10px] text-zinc-400 truncate">
                  {result?.status === "recommendation" && result?.recommendation
                    ? `${result.recommendation.direction} ${result.recommendation.strategyType.replace(/_/g, " ")}`
                    : (() => {
                        const r = normalizeBlockReason(result?.blockReason);
                        return r ? (HISTORY_CATEGORY_LABELS[r.category] ?? "Blocked") : (result?.status === "toxic_block" ? "Toxic Block" : "No Setup");
                      })()}
                </span>
                <span className="font-mono text-[9px] text-zinc-600 ml-auto pr-2 shrink-0">{tsLabel}</span>
              </button>
              <button
                onClick={() => handleRemove(row.id)}
                aria-label="Remove from history"
                className="text-zinc-500 hover:text-white transition-colors p-1 rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {isOpen && (
              <div className="px-2 pb-2">
                {(() => {
                  const transcript = (result as unknown as { debateTranscript?: unknown[] })?.debateTranscript;
                  if (Array.isArray(transcript) && transcript.length > 0) {
                    return <HistoryDebateTranscript transcript={transcript as Parameters<typeof HistoryDebateTranscript>[0]["transcript"]} />;
                  }
                  return null;
                })()}
                {result?.status === "recommendation" && result.recommendation ? (
                  <StrategistV2RecommendationCard
                    result={result}
                    onSendToOrder={onSendToOrder}
                    generatedAt={row.createdAt}
                  />
                ) : (
                  <StrategistV2BlockCard result={result} generatedAt={row.createdAt} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
