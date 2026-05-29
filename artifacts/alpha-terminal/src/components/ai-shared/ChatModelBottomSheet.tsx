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
import {
  CHAT_COMPOSER_CHIP_CLASS,
  CHAT_COMPOSER_CHIP_SURFACE,
  CHAT_MODEL_SHEET_CLASS,
  chatModelShortLabel,
} from "./chatModelUi";

const MULTI_AGENT_VALUE = "__multi_agent__";

const sheetSelectClass =
  "w-full rounded-md border border-card-border bg-white/5 px-3 py-2 font-mono text-[13px] text-white focus:outline-none focus:border-primary/50 appearance-none cursor-pointer";

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

function rowClass(selected: boolean): string {
  return [
    "w-full text-left rounded-lg px-3 py-3 flex items-start gap-3 transition-colors border",
    selected
      ? "bg-white/10 border-white/20 text-white"
      : "border-transparent hover:bg-white/5",
  ].join(" ");
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
        className="absolute inset-0 bg-black/65"
        aria-label="Close model picker"
        onClick={onClose}
      />
      <div
        className={`relative max-h-[min(88vh,720px)] w-full flex flex-col ${CHAT_MODEL_SHEET_CLASS}`}
        role="dialog"
        aria-label="Select model"
      >
        <div className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0 border-b border-card-border/60">
          <button
            type="button"
            onClick={onClose}
            className={`flex h-9 w-9 items-center justify-center shrink-0 ${CHAT_COMPOSER_CHIP_CLASS}`}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
          <h2 className="font-mono text-[15px] font-semibold text-white tracking-wide">Select model</h2>
          <div className="w-9" aria-hidden />
        </div>

        <div className="mx-auto mt-2 mb-1 h-1 w-10 rounded-full bg-white/25 shrink-0" aria-hidden />

        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-[max(16px,env(safe-area-inset-bottom))]">
          <p className="px-2 pb-1.5 font-mono text-[10px] font-semibold text-white/50 uppercase tracking-widest">
            Mode
          </p>
          <button
            type="button"
            onClick={() => onMultiAgentToggle(true)}
            className={[rowClass(useMultiAgent), "mb-2"].join(" ")}
          >
            <div className="flex-1 min-w-0">
              <div className="font-mono text-[14px] font-medium text-white">Multi-agent research</div>
              <p className="font-mono text-[12px] text-white/55 leading-snug mt-1">
                Several models search in parallel; one synthesizer merges their drafts into a single answer.
              </p>
            </div>
            {useMultiAgent ? <Check className="h-5 w-5 text-primary shrink-0 mt-0.5" /> : null}
          </button>

          {useMultiAgent && (
            <div className="mb-3 rounded-lg border border-card-border/80 bg-white/5 p-3 space-y-3">
              <p className="font-mono text-[11px] text-white/55 leading-snug">
                Pick at least two research models. After they finish, the synthesizer runs once on all drafts.
              </p>
              <div className="space-y-0.5 max-h-40 overflow-y-auto">
                {AI_MODEL_CATALOG.map((entry) => {
                  const checked = multiAgentModels.includes(entry.id);
                  return (
                    <label
                      key={entry.id}
                      className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-white/5 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        className="h-4 w-4 accent-primary shrink-0"
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...multiAgentModels, entry.id]
                            : multiAgentModels.filter((m) => m !== entry.id);
                          onMultiAgentModelsChange(next);
                        }}
                      />
                      <span className="font-mono text-[13px] text-white/90">{entry.label}</span>
                    </label>
                  );
                })}
              </div>
              {multiAgentModels.length > 0 && (
                <label className="flex flex-col gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-white/50">Synthesizer</span>
                  <select
                    value={synthesizerModel}
                    onChange={(e) => onSynthesizerChange(e.target.value)}
                    className={sheetSelectClass}
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

          <p className="px-2 pt-2 pb-1.5 font-mono text-[10px] font-semibold text-white/50 uppercase tracking-widest">
            {useMultiAgent ? "Or single model" : "Models"}
          </p>
          <ul className="space-y-1">
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
                    className={rowClass(selected)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-[14px] font-medium text-white">
                        {chatModelShortLabel(entry.id)}
                      </div>
                      <p className="font-mono text-[12px] text-white/55 leading-snug mt-0.5">
                        {modelSubtitle(entry.id)}
                      </p>
                      {selected && !opus && (
                        <label
                          className={`mt-3 flex items-center justify-between gap-3 rounded-lg px-3 py-2 border border-card-border/80 ${CHAT_COMPOSER_CHIP_SURFACE}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="font-mono text-[12px] text-white/90">With thinking</span>
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-primary"
                            checked={extendedThinking}
                            onChange={(e) => onExtendedThinkingChange(e.target.checked)}
                          />
                        </label>
                      )}
                    </div>
                    {selected ? <Check className="h-5 w-5 text-primary shrink-0" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>

          {!useMultiAgent && opus && (
            <div className="mt-3 rounded-lg border border-card-border/80 bg-white/5 overflow-hidden divide-y divide-card-border/60">
              <label className="flex items-center justify-between px-4 py-3 gap-3">
                <span className="font-mono text-[13px] text-white/90">With thinking</span>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={extendedThinking}
                  onChange={(e) => onExtendedThinkingChange(e.target.checked)}
                />
              </label>
              <label className="flex items-center justify-between px-4 py-3 gap-3">
                <span className="font-mono text-[13px] text-white/90">Effort</span>
                <span className="flex items-center gap-1 font-mono text-[13px] text-white/70">
                  <select
                    value={effortNorm}
                    onChange={(e) => onEffortChange(normalizeAnthropicOpusEffort(e.target.value))}
                    className="bg-transparent text-right text-white appearance-none pr-1 max-w-[160px]"
                    aria-label="Opus effort"
                  >
                    {ANTHROPIC_OPUS_EFFORT_LEVELS.map((level) => (
                      <option key={level} value={level} className="bg-[#2b2b2b]">
                        {ANTHROPIC_OPUS_EFFORT_LABELS[level]}
                      </option>
                    ))}
                  </select>
                  <ChevronRight className="h-4 w-4 text-white/35" aria-hidden />
                </span>
              </label>
              <label className="flex items-center justify-between px-4 py-3 gap-3">
                <span className="font-mono text-[13px] text-white/90">Speed</span>
                <span className="flex items-center gap-1 font-mono text-[13px] text-white/70 min-w-0">
                  <select
                    value={speedNorm}
                    onChange={(e) => onSpeedChange(normalizeAnthropicOpusSpeed(e.target.value))}
                    className="bg-transparent text-right text-white appearance-none pr-1 max-w-[min(200px,42vw)] truncate"
                    aria-label="Opus speed"
                  >
                    {ANTHROPIC_OPUS_SPEED_LEVELS.map((level) => (
                      <option key={level} value={level} className="bg-[#2b2b2b]">
                        {ANTHROPIC_OPUS_SPEED_LABELS[level]}
                      </option>
                    ))}
                  </select>
                  <ChevronRight className="h-4 w-4 text-white/35 shrink-0" aria-hidden />
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
