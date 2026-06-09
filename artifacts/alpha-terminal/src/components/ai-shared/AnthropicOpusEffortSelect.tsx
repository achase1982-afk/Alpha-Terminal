import {
  ANTHROPIC_OPUS_EFFORT_LABELS,
  ANTHROPIC_OPUS_EFFORT_LEVELS,
  ANTHROPIC_OPUS_SPEED_LABELS,
  ANTHROPIC_OPUS_SPEED_LEVELS,
  DEFAULT_ANTHROPIC_OPUS_EFFORT,
  DEFAULT_ANTHROPIC_OPUS_SPEED,
  isAnthropicOpusEffortModel,
  isAnthropicOpusSpeedModel,
  migrateLegacyModelIdToCatalog,
  normalizeAnthropicOpusEffort,
  normalizeAnthropicOpusSpeed,
  type AnthropicOpusEffort,
  type AnthropicOpusSpeed,
} from '@workspace/ai-models';

const selectClassName =
  'w-full bg-card border border-card-border rounded-md px-2 py-2 font-mono text-[10px] text-white focus:outline-none focus:border-primary/50 appearance-none cursor-pointer';

const selectStyle = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat' as const,
  backgroundPosition: 'right 8px center',
};

type Props = {
  modelId: string;
  effort: AnthropicOpusEffort | string | undefined;
  speed: AnthropicOpusSpeed | string | undefined;
  onEffortChange: (effort: AnthropicOpusEffort) => void;
  onSpeedChange: (speed: AnthropicOpusSpeed) => void;
  className?: string;
  /** Tighter layout for chat toolbar popover (no help copy). */
  variant?: "default" | "compact";
};

const compactSelectClassName =
  'w-full bg-black/50 border border-card-border rounded px-2 py-1.5 font-mono text-[11px] text-white focus:outline-none focus:border-primary/50 appearance-none cursor-pointer min-h-[32px]';

export function AnthropicOpusEffortSelect({
  modelId,
  effort: effortProp,
  speed: speedProp,
  onEffortChange,
  onSpeedChange,
  className,
  variant = "default",
}: Props) {
  const effectiveModelId = migrateLegacyModelIdToCatalog(modelId);
  if (!isAnthropicOpusEffortModel(effectiveModelId)) return null;

  const showSpeed = isAnthropicOpusSpeedModel(effectiveModelId);
  const effort = normalizeAnthropicOpusEffort(effortProp ?? DEFAULT_ANTHROPIC_OPUS_EFFORT);
  const speed = normalizeAnthropicOpusSpeed(speedProp ?? DEFAULT_ANTHROPIC_OPUS_SPEED);
  const compact = variant === "compact";
  const fieldSelectClass = compact ? compactSelectClassName : selectClassName;

  if (compact) {
    return (
      <div className={className ?? (showSpeed ? "grid grid-cols-2 gap-2" : "space-y-2")}>
        <label className="flex flex-col gap-0.5 min-w-0">
          <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">Effort</span>
          <select
            value={effort}
            onChange={(e) => onEffortChange(normalizeAnthropicOpusEffort(e.target.value))}
            className={fieldSelectClass}
            style={selectStyle}
            aria-label="Anthropic effort"
          >
            {ANTHROPIC_OPUS_EFFORT_LEVELS.map((level) => (
              <option key={level} value={level}>
                {ANTHROPIC_OPUS_EFFORT_LABELS[level]}
              </option>
            ))}
          </select>
        </label>
        {showSpeed ? (
          <label className="flex flex-col gap-0.5 min-w-0">
            <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">Speed</span>
            <select
              value={speed}
              onChange={(e) => onSpeedChange(normalizeAnthropicOpusSpeed(e.target.value))}
              className={fieldSelectClass}
              style={selectStyle}
              aria-label="Opus speed"
            >
              {ANTHROPIC_OPUS_SPEED_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {ANTHROPIC_OPUS_SPEED_LABELS[level]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
    );
  }

  return (
    <div className={className ?? 'space-y-3'}>
      <div className="space-y-1.5">
        <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">Effort</span>
        <select
          value={effort}
          onChange={(e) => onEffortChange(normalizeAnthropicOpusEffort(e.target.value))}
          className={fieldSelectClass}
          style={selectStyle}
          aria-label="Anthropic effort"
        >
          {ANTHROPIC_OPUS_EFFORT_LEVELS.map((level) => (
            <option key={level} value={level}>
              {ANTHROPIC_OPUS_EFFORT_LABELS[level]}
            </option>
          ))}
        </select>
        <p className="font-mono text-[8px] text-zinc-600 leading-tight">
          Anthropic reasoning depth (API effort). Higher levels use more tokens and latency.
        </p>
      </div>

      {showSpeed ? (
        <div className="space-y-1.5">
          <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">Opus speed</span>
          <select
            value={speed}
            onChange={(e) => onSpeedChange(normalizeAnthropicOpusSpeed(e.target.value))}
            className={fieldSelectClass}
            style={selectStyle}
            aria-label="Opus speed"
          >
            {ANTHROPIC_OPUS_SPEED_LEVELS.map((level) => (
              <option key={level} value={level}>
                {ANTHROPIC_OPUS_SPEED_LABELS[level]}
              </option>
            ))}
          </select>
          <p className="font-mono text-[8px] text-zinc-600 leading-tight">
            Fast mode increases output token speed (~2.5×) with premium Opus pricing.
          </p>
        </div>
      ) : null}
    </div>
  );
}
