import {
  ANTHROPIC_OPUS_EFFORT_LABELS,
  ANTHROPIC_OPUS_EFFORT_LEVELS,
  ANTHROPIC_OPUS_SPEED_LABELS,
  ANTHROPIC_OPUS_SPEED_LEVELS,
  DEFAULT_ANTHROPIC_OPUS_EFFORT,
  DEFAULT_ANTHROPIC_OPUS_SPEED,
  isAnthropicOpusEffortModel,
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
  compact?: boolean;
  className?: string;
};

export function AnthropicOpusEffortSelect({
  modelId,
  effort: effortProp,
  speed: speedProp,
  onEffortChange,
  onSpeedChange,
  compact,
  className,
}: Props) {
  const effectiveModelId = migrateLegacyModelIdToCatalog(modelId);
  if (!isAnthropicOpusEffortModel(effectiveModelId)) return null;

  const effort = normalizeAnthropicOpusEffort(effortProp ?? DEFAULT_ANTHROPIC_OPUS_EFFORT);
  const speed = normalizeAnthropicOpusSpeed(speedProp ?? DEFAULT_ANTHROPIC_OPUS_SPEED);

  const labelClass = compact
    ? 'font-mono text-[8px] text-zinc-500 uppercase tracking-widest'
    : 'font-mono text-[8px] text-zinc-500 uppercase tracking-widest';

  const helpClass = compact
    ? 'hidden'
    : 'font-mono text-[8px] text-zinc-600 leading-tight';

  const gridClass = compact
    ? 'grid grid-cols-2 gap-2'
    : 'space-y-3';

  const fieldClass = compact ? 'space-y-1' : 'space-y-1.5';

  return (
    <div className={className ?? gridClass}>
      <div className={fieldClass}>
        <span className={labelClass}>{compact ? 'Effort' : 'Opus effort'}</span>
        <select
          value={effort}
          onChange={(e) => onEffortChange(normalizeAnthropicOpusEffort(e.target.value))}
          className={selectClassName}
          style={selectStyle}
          aria-label="Opus effort"
        >
          {ANTHROPIC_OPUS_EFFORT_LEVELS.map((level) => (
            <option key={level} value={level}>
              {ANTHROPIC_OPUS_EFFORT_LABELS[level]}
            </option>
          ))}
        </select>
        {!compact && (
          <p className={helpClass}>
            Anthropic reasoning depth (API effort). Higher levels use more tokens and latency.
          </p>
        )}
      </div>

      <div className={fieldClass}>
        <span className={labelClass}>{compact ? 'Speed' : 'Opus speed'}</span>
        <select
          value={speed}
          onChange={(e) => onSpeedChange(normalizeAnthropicOpusSpeed(e.target.value))}
          className={selectClassName}
          style={selectStyle}
          aria-label="Opus speed"
        >
          {ANTHROPIC_OPUS_SPEED_LEVELS.map((level) => (
            <option key={level} value={level}>
              {ANTHROPIC_OPUS_SPEED_LABELS[level]}
            </option>
          ))}
        </select>
        {!compact && (
          <p className={helpClass}>
            Fast mode increases output token speed (~2.5×) with premium Opus pricing.
          </p>
        )}
      </div>
    </div>
  );
}
