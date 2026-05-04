import { useState } from "react";
import { X, Trash2, ChevronDown, ChevronUp, History } from "lucide-react";
import { useTerminalStore, type StrategistValidationMeta, type StrategistTranscriptTurn } from "@/lib/store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  StrategistV2RecommendationCard,
  StrategistV2BlockCard,
  normalizeBlockReason,
  type StrategistV2Result,
  type StrategistSendToOrderPayload,
} from "@/components/StrategistV2Card";
import { StrategistDeskCard, type DeskResult } from "@/components/StrategistDeskCard";
import { HistoryDebateTranscript } from "@/components/HistoryDebateTranscript";
import { StrategistValidationCard } from "@/components/StrategistValidationCard";

const HISTORY_CATEGORY_LABELS: Record<string, string> = {
  TOXIC_BLOCK: "Toxic Block",
  LOW_CONFIDENCE: "Low Confidence",
  NO_EDGE: "No Edge",
  CATALYST_CONFLICT: "Catalyst Conflict",
  VALIDATION_FAIL: "Validation issue",
  ECONOMICS_MISMATCH: "Pricing mismatch",
  UNKNOWN_STRUCTURE: "Unrecognized structure",
  NO_TRADE: "No trade",
  ANALYSIS_INCOMPLETE: "Incomplete",
  MISSING_DATA: "Missing Data",
  STOCK_HALTED: "Stock Halted",
  PRICING_MARKET_CLOSED: "Market Closed",
  UNKNOWN: "Blocked",
};

interface Props {
  onSendToOrder?: (payload: StrategistSendToOrderPayload) => void;
  onReopenValidatedOrder?: (meta: StrategistValidationMeta) => void;
  excludeJobIds?: Set<string>;
}

export function StrategistHistoryList({ onSendToOrder, onReopenValidatedOrder, excludeJobIds }: Props) {
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
        const cardJson = row.cardJson as Record<string, unknown>;
        const isValidation = cardJson?.kind === "validation";
        const result = isValidation ? undefined : (row.cardJson as StrategistV2Result);
        const isOpen = expanded.has(row.id);
        const ts = new Date(row.createdAt);
        const tsLabel = isNaN(ts.getTime()) ? "" : ts.toLocaleString();

        // Reconstruct StrategistValidationMeta from the stored cardJson for validation rows.
        const validationMeta: StrategistValidationMeta | null = isValidation && cardJson.ticket
          ? {
              ticker: row.ticker,
              mode: ((cardJson.ticket as Record<string, unknown>).mode as "opening" | "closing") ?? "opening",
              ticket: cardJson.ticket as StrategistValidationMeta["ticket"],
              thesis: typeof cardJson.thesis === "string" ? cardJson.thesis : undefined,
              rollingShort: cardJson.rollingShort === true,
            }
          : null;

        const validationTranscript = isValidation && Array.isArray(cardJson.debateTranscript)
          ? (cardJson.debateTranscript as StrategistTranscriptTurn[])
          : [];

        // Summary label shown in the collapsed row header.
        const summaryLabel = isValidation
          ? (() => {
              const vp = cardJson.validation as Record<string, unknown> | undefined;
              const verdict = typeof vp?.verdict === "string" ? vp.verdict : null;
              if (!verdict) return "Trade Validation";
              if (verdict === "PROCEED") return "Proceed";
              if (verdict === "PROCEED_WITH_CAUTION") return "Caution";
              if (verdict === "DO_NOT_PROCEED") return "Do Not Proceed";
              return "Trade Validation";
            })()
          : result?.status === "desk_recommendation" && (result as any)?.deskResult
            ? `Desk: ${(result as any).deskResult.pm.decision === "trade" ? (result as any).deskResult.pm.structure?.type?.replace(/_/g, " ") ?? "Trade" : "Pass"}`
          : result?.status === "recommendation" && result?.recommendation
            ? `${result.recommendation.direction} ${result.recommendation.strategyType.replace(/_/g, " ")}`
            : (() => {
                const r = normalizeBlockReason(result?.blockReason);
                return r ? (HISTORY_CATEGORY_LABELS[r.category] ?? "Blocked") : (result?.status === "toxic_block" ? "Toxic Block" : "No Setup");
              })();

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
                {isValidation && (
                  <span className="font-mono text-[9px] px-1.5 py-px rounded"
                    style={{ background: "rgba(90,209,192,0.12)", color: "#5ad1c0", border: "1px solid rgba(90,209,192,0.25)" }}>
                    VALIDATE
                  </span>
                )}
                <span className="font-mono text-[10px] text-zinc-500">·</span>
                <span className="font-mono text-[10px] text-zinc-400 truncate">{summaryLabel}</span>
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
                {isValidation ? (
                  <StrategistValidationCard
                    result={(cardJson.validation as unknown) ?? null}
                    meta={validationMeta}
                    onReopenOrder={onReopenValidatedOrder}
                    generatedAt={row.createdAt}
                    transcript={validationTranscript}
                    collapseStorageKey={row.jobId}
                  />
                ) : (
                  <>
                    {result?.debateTranscript && result.debateTranscript.length > 0 ? (
                      <HistoryDebateTranscript transcript={result.debateTranscript} />
                    ) : null}
                    {result?.status === "desk_recommendation" && (result as any).deskResult ? (
                      <StrategistDeskCard
                        deskResult={(result as any).deskResult as DeskResult}
                        generatedAt={row.createdAt}
                        strategistOutcome={(result as StrategistV2Result).strategistOutcome}
                        diagnosticView={(result as StrategistV2Result).diagnosticView ?? null}
                        strategistJobId={row.jobId}
                        blockReason={
                          typeof (result as StrategistV2Result).blockReason === "object" && (result as StrategistV2Result).blockReason != null
                            ? ((result as StrategistV2Result).blockReason as import("@/components/StrategistV2Card").BlockReason)
                            : undefined
                        }
                      />
                    ) : result?.status === "recommendation" && result.recommendation ? (
                      <StrategistV2RecommendationCard
                        result={result}
                        onSendToOrder={onSendToOrder}
                        generatedAt={row.createdAt}
                      />
                    ) : (
                      <StrategistV2BlockCard result={result!} generatedAt={row.createdAt} />
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
