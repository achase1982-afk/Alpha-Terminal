import { useEffect, useRef, useState } from "react";
import {
  ANTHROPIC_OPUS_EFFORT_LABELS,
  ANTHROPIC_OPUS_SPEED_LABELS,
  aiModelSelectLabel,
  isAnthropicOpusEffortModel,
  migrateLegacyModelIdToCatalog,
  normalizeAnthropicOpusEffort,
  normalizeAnthropicOpusSpeed,
  type AnthropicOpusEffort,
  type AnthropicOpusSpeed,
} from "@workspace/ai-models";
import { ChevronDown } from "lucide-react";
import { AnthropicOpusEffortSelect } from "./AnthropicOpusEffortSelect";

const toolbarSelectClass =
  "bg-black/60 border border-card-border rounded px-2 py-1.5 font-mono text-[12px] text-white focus:outline-none focus:border-primary/50 appearance-none cursor-pointer min-h-[34px]";

const toolbarSelectStyle = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat" as const,
  backgroundPosition: "right 6px center",
  paddingRight: "1.5rem",
};

type Props = {
  modelValue: string;
  modelOptions: ReadonlyArray<{ value: string; label: string }>;
  onModelChange: (modelId: string) => void;
  effort: AnthropicOpusEffort | string | undefined;
  speed: AnthropicOpusSpeed | string | undefined;
  onEffortChange: (effort: AnthropicOpusEffort) => void;
  onSpeedChange: (speed: AnthropicOpusSpeed) => void;
  modelAriaLabel?: string;
  extraAfterModel?: React.ReactNode;
};

/** Single-row chat model control; Opus effort/speed open in a popover from the same bar. */
export function ChatModelToolbar({
  modelValue,
  modelOptions,
  onModelChange,
  effort,
  speed,
  onEffortChange,
  onSpeedChange,
  modelAriaLabel = "Chat model",
  extraAfterModel,
}: Props) {
  const [opusOpen, setOpusOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const effectiveModel = migrateLegacyModelIdToCatalog(modelValue);
  const showOpusMenu = isAnthropicOpusEffortModel(effectiveModel);
  const opusEffort = normalizeAnthropicOpusEffort(effort);
  const opusSpeed = normalizeAnthropicOpusSpeed(speed);
  const opusSummary = showOpusMenu
    ? `${ANTHROPIC_OPUS_EFFORT_LABELS[opusEffort]} · ${opusSpeed === "fast" ? "Fast" : "Standard"}`
    : "";

  useEffect(() => {
    if (!showOpusMenu) setOpusOpen(false);
  }, [showOpusMenu]);

  useEffect(() => {
    if (!opusOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpusOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [opusOpen]);

  return (
    <div ref={wrapRef} className="relative flex items-center gap-1.5 shrink-0 max-w-full">
      <select
        value={modelValue}
        onChange={(e) => {
          onModelChange(e.target.value);
          if (!isAnthropicOpusEffortModel(migrateLegacyModelIdToCatalog(e.target.value))) {
            setOpusOpen(false);
          }
        }}
        className={`${toolbarSelectClass} min-w-0 max-w-[min(180px,42vw)] sm:max-w-[220px]`}
        style={toolbarSelectStyle}
        aria-label={modelAriaLabel}
      >
        {modelOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {showOpusMenu && (
        <button
          type="button"
          onClick={() => setOpusOpen((v) => !v)}
          className={[
            toolbarSelectClass,
            "flex items-center gap-0.5 px-2 shrink-0",
            opusOpen ? "border-white/35 bg-white/10" : "",
          ].join(" ")}
          aria-label="Opus effort and speed"
          aria-expanded={opusOpen}
        >
          <span className="text-[10px] text-white/80 max-w-[100px] truncate hidden sm:inline">
            {opusSummary}
          </span>
          <span className="text-[10px] text-white/70 sm:hidden">Opus</span>
          <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${opusOpen ? "rotate-180" : ""}`} />
        </button>
      )}

      {extraAfterModel}

      {showOpusMenu && opusOpen && (
        <div
          className="absolute right-0 top-[calc(100%+4px)] z-[10120] w-[min(280px,calc(100vw-1.5rem))] rounded-md border border-card-border bg-[#0b0b0b] p-2.5 shadow-xl"
          role="dialog"
          aria-label="Opus model options"
        >
          <AnthropicOpusEffortSelect
            variant="compact"
            modelId={effectiveModel}
            effort={effort}
            speed={speed}
            onEffortChange={onEffortChange}
            onSpeedChange={onSpeedChange}
          />
        </div>
      )}
    </div>
  );
}

export function chatModelOptionsFromIds(ids: readonly string[]): Array<{ value: string; label: string }> {
  return ids.map((id) => ({ value: id, label: aiModelSelectLabel(id) }));
}
