import { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  AI_MODEL_CATALOG,
  ANTHROPIC_OPUS_EFFORT_LABELS,
  ANTHROPIC_OPUS_EFFORT_LEVELS,
  ANTHROPIC_OPUS_SPEED_LABELS,
  ANTHROPIC_OPUS_SPEED_LEVELS,
  aiModelSelectLabel,
  isAnthropicOpusEffortModel,
  migrateLegacyModelIdToCatalog,
  normalizeAnthropicOpusEffort,
  normalizeAnthropicOpusSpeed,
  type AiModelId,
  type AnthropicOpusEffort,
  type AnthropicOpusSpeed,
} from "@workspace/ai-models";
import { Check, ChevronRight, X } from "lucide-react";
import { chatModelShortLabel } from "./chatModelUi";

const MULTI_AGENT_VALUE = "__multi_agent__";

type Props = {
  open: boolean;
  onClose: () => void;
  modelId: string;
  useMultiAgent: boolean;
  multiAgentModels: string[];
  synthesizerModel: string;
  effort: AnthropicOpusEffort | string | undefined;
  speed: AnthropicOpusSpeed | string | undefined;
  extendedThinking: boolean;
  onModelSelect: (modelId: string) => void;
  onMultiAgentToggle: (enabled: boolean) => void;
  onMultiAgentModelsChange: (models: string[]) => void;
  onSynthesizerChange: (modelId: string) => void;
  onEffortChange: (effort: AnthropicOpusEffort) => void;
  onSpeedChange: (speed: AnthropicOpusSpeed) => void;
  onExtendedThinkingChange: (enabled: boolean) => void;
};

function modelSubtitle(id: AiModelId): string {
  switch (id) {
    case "claude-opus-4-8":
      return "Most capable for ambitious work.";
    case "claude-sonnet-4-6":
      return "Efficient for everyday tasks.";
    case "gemini-3.5-flash":
      return "Fast Google model with optional thinking.";
    case "gemini-3.1-pro-preview":
      return "Deeper Google reasoning.";
    case "gpt-5.5":
      return "OpenAI flagship reasoning.";
    case "gpt-5.4-mini":
      return "Faster OpenAI with medium reasoning.";
    default:
      return "";
  }
}

export function ChatModelBottomSheet({
  open,
  onClose,
  modelId,
  useMultiAgent,
  multiAgentModels,
  synthesizerModel,
  effort,
  speed,
  extendedThinking,
  onModelSelect,
  onMultiAgentToggle,
  onMultiAgentModelsChange,
  onSynthesizerChange,
  onEffortChange,
  onSpeedChange,
  onExtendedThinkingChange,
}: Props) {
  const effectiveModel = migrateLegacyModelIdToCatalog(modelId);
  const opus = isAnthropicOpusEffortModel(effectiveModel);
  const effortNorm = normalizeAnthropicOpusEffort(effort);
  const speedNorm = normalizeAnthropicOpusSpeed(speed);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const selectedId = useMultiAgent ? MULTI_AGENT_VALUE : effectiveModel;

  return createPortal(
    <div className="fixed inset-0 z-[10200] flex flex-col justify-end" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/55"
        aria-label="Close model picker"
        onClick={onClose}
      />
      <div
        className="relative max-h-[min(88vh,720px)] w-full rounded-t-2xl border-t border-card-border bg-[#f4f4f5] text-[#111] shadow-2xl flex flex-col"
        role="dialog"
        aria-label="Select model"
      >
        <div className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/8 text-[#333]"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
          <h2 className="font-sans text-[17px] font-semibold text-[#111]">Select model</h2>
          <div className="w-9" aria-hidden />
        </div>

        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-black/15 shrink-0" aria-hidden />

        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-[max(16px,env(safe-area-inset-bottom))]">
          <p className="px-2 pb-1 font-sans text-[12px] font-semibold text-[#666] uppercase tracking-wide">
            Mode
          </p>
          <button
            type="button"
            onClick={() => {
              onMultiAgentToggle(true);
            }}
            className={[
              "w-full text-left rounded-xl px-3 py-3 mb-1 flex items-start gap-3",
              useMultiAgent ? "bg-white shadow-sm ring-1 ring-black/8" : "hover:bg-white/70",
            ].join(" ")}
          >
            <div className="flex-1 min-w-0">
              <div className="font-sans text-[16px] font-medium text-[#111]">Multi-agent research</div>
              <p className="font-sans text-[13px] text-[#555] leading-snug mt-0.5">
                Several models search in parallel; one synthesizer merges their drafts into a single answer.
              </p>
            </div>
            {useMultiAgent ? <Check className="h-5 w-5 text-[#0d9488] shrink-0 mt-0.5" /> : null}
          </button>

          {useMultiAgent && (
            <div className="mb-3 rounded-xl bg-white/90 border border-black/8 p-3 space-y-3">
              <p className="font-sans text-[12px] text-[#555] leading-snug">
                Pick at least two research models. After they finish, the synthesizer runs once on all drafts.
              </p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {AI_MODEL_CATALOG.map((entry) => {
                  const checked = multiAgentModels.includes(entry.id);
                  return (
                    <label
                      key={entry.id}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-black/5"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...multiAgentModels, entry.id]
                            : multiAgentModels.filter((m) => m !== entry.id);
                          onMultiAgentModelsChange(next);
                        }}
                      />
                      <span className="font-sans text-[14px] text-[#111]">{entry.label}</span>
                    </label>
                  );
                })}
              </div>
              {multiAgentModels.length > 0 && (
                <label className="flex flex-col gap-1">
                  <span className="font-sans text-[12px] font-medium text-[#444]">Synthesizer</span>
                  <select
                    value={synthesizerModel}
                    onChange={(e) => onSynthesizerChange(e.target.value)}
                    className="w-full rounded-lg border border-black/12 bg-white px-3 py-2 font-sans text-[14px]"
                  >
                    {multiAgentModels.map((m) => (
                      <option key={m} value={m}>
                        {aiModelSelectLabel(m)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}

          <p className="px-2 pt-2 pb-1 font-sans text-[12px] font-semibold text-[#666] uppercase tracking-wide">
            {useMultiAgent ? "Or single model" : "Models"}
          </p>
          <ul className="space-y-0.5">
            {AI_MODEL_CATALOG.map((entry) => {
              const selected = !useMultiAgent && selectedId === entry.id;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onMultiAgentToggle(false);
                      onModelSelect(entry.id);
                    }}
                    className={[
                      "w-full text-left rounded-xl px-3 py-3 flex items-center gap-3",
                      selected ? "bg-white shadow-sm ring-1 ring-black/8" : "hover:bg-white/70",
                    ].join(" ")}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-sans text-[16px] font-medium text-[#111]">
                        {chatModelShortLabel(entry.id)}
                      </div>
                      <p className="font-sans text-[13px] text-[#555] leading-snug">{modelSubtitle(entry.id)}</p>
                      {selected && !opus && (
                        <label
                          className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-[#f8f8f8] px-3 py-2 border border-black/6"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="font-sans text-[14px] text-[#333]">With thinking</span>
                          <input
                            type="checkbox"
                            className="h-5 w-5 accent-[#0d9488]"
                            checked={extendedThinking}
                            onChange={(e) => onExtendedThinkingChange(e.target.checked)}
                          />
                        </label>
                      )}
                    </div>
                    {selected ? <Check className="h-5 w-5 text-[#0d9488] shrink-0" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>

          {!useMultiAgent && opus && (
            <div className="mt-3 rounded-xl bg-white border border-black/8 overflow-hidden divide-y divide-black/8">
              <label className="flex items-center justify-between px-4 py-3 gap-3">
                <span className="font-sans text-[15px] text-[#111]">With thinking</span>
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[#0d9488]"
                  checked={extendedThinking}
                  onChange={(e) => onExtendedThinkingChange(e.target.checked)}
                />
              </label>
              <label className="flex items-center justify-between px-4 py-3 gap-3">
                <span className="font-sans text-[15px] text-[#111]">Effort</span>
                <span className="flex items-center gap-1 font-sans text-[15px] text-[#666]">
                  <select
                    value={effortNorm}
                    onChange={(e) => onEffortChange(normalizeAnthropicOpusEffort(e.target.value))}
                    className="bg-transparent text-right font-medium text-[#333] appearance-none pr-1"
                    aria-label="Opus effort"
                  >
                    {ANTHROPIC_OPUS_EFFORT_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {ANTHROPIC_OPUS_EFFORT_LABELS[level]}
                      </option>
                    ))}
                  </select>
                  <ChevronRight className="h-4 w-4 opacity-40" aria-hidden />
                </span>
              </label>
              <label className="flex items-center justify-between px-4 py-3 gap-3">
                <span className="font-sans text-[15px] text-[#111]">Speed</span>
                <span className="flex items-center gap-1 font-sans text-[15px] text-[#666]">
                  <select
                    value={speedNorm}
                    onChange={(e) => onSpeedChange(normalizeAnthropicOpusSpeed(e.target.value))}
                    className="bg-transparent text-right font-medium text-[#333] appearance-none pr-1 max-w-[200px]"
                    aria-label="Opus speed"
                  >
                    {ANTHROPIC_OPUS_SPEED_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {ANTHROPIC_OPUS_SPEED_LABELS[level]}
                      </option>
                    ))}
                  </select>
                  <ChevronRight className="h-4 w-4 opacity-40" aria-hidden />
                </span>
              </label>
            </div>
          )}

        </div>
      </div>
    </div>,
    document.body,
  );
}
