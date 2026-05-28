import {
  ANTHROPIC_OPUS_EFFORT_LABELS,
  ANTHROPIC_OPUS_EFFORT_LEVELS,
  DEFAULT_ANTHROPIC_OPUS_EFFORT,
  isAnthropicOpusEffortModel,
  normalizeAnthropicOpusEffort,
  type AnthropicOpusEffort,
} from '@workspace/ai-models';

type Props = {
  modelId: string;
  value: AnthropicOpusEffort | string | undefined;
  onChange: (effort: AnthropicOpusEffort) => void;
  className?: string;
};

/** Shown beside the model dropdown when Claude Opus 4.7+ is selected. */
export function AnthropicOpusEffortSelect({ modelId, value, onChange, className }: Props) {
  if (!isAnthropicOpusEffortModel(modelId)) return null;

  const effort = normalizeAnthropicOpusEffort(value ?? DEFAULT_ANTHROPIC_OPUS_EFFORT);

  return (
    <div className={className ?? 'space-y-1.5'}>
      <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">Opus effort</span>
      <select
        value={effort}
        onChange={(e) => onChange(normalizeAnthropicOpusEffort(e.target.value))}
        className="w-full bg-card border border-card-border rounded-md px-2 py-2 font-mono text-[10px] text-white focus:outline-none focus:border-primary/50 appearance-none cursor-pointer"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 8px center',
        }}
      >
        {ANTHROPIC_OPUS_EFFORT_LEVELS.map((level) => (
          <option key={level} value={level}>
            {ANTHROPIC_OPUS_EFFORT_LABELS[level]}
          </option>
        ))}
      </select>
      <p className="font-mono text-[8px] text-zinc-600 leading-tight">
        Controls Anthropic reasoning depth (API effort). Higher levels use more tokens and latency.
      </p>
    </div>
  );
}
