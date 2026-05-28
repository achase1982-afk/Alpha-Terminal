import { AnthropicOpusEffortSelect } from "./AnthropicOpusEffortSelect";
import type { AnthropicOpusEffort, AnthropicOpusSpeed } from "@workspace/ai-models";

type Props = {
  modelId: string;
  effort: AnthropicOpusEffort | string | undefined;
  speed: AnthropicOpusSpeed | string | undefined;
  onEffortChange: (effort: AnthropicOpusEffort) => void;
  onSpeedChange: (speed: AnthropicOpusSpeed) => void;
  /** Tighter layout for chat header and similar toolbars. */
  compact?: boolean;
  className?: string;
};

/** Opus effort + speed directly under an LLM model selector (hidden for non-Opus models). */
export function LlmOpusOptionsFields({
  modelId,
  effort,
  speed,
  onEffortChange,
  onSpeedChange,
  compact,
  className,
}: Props) {
  return (
    <AnthropicOpusEffortSelect
      modelId={modelId}
      effort={effort}
      speed={speed}
      onEffortChange={onEffortChange}
      onSpeedChange={onSpeedChange}
      compact={compact}
      className={className}
    />
  );
}
