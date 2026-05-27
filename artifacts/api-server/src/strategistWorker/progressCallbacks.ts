import type { AnalyzeProgressCallbacks } from "../lib/strategistV2.js";
import type { TranscriptTurn } from "../lib/strategistV3/types.js";
import { mergeJobProgress } from "../lib/strategistV3/jobs.js";

const MAX_TOKENS = 6000;
const MAX_TRANSCRIPT = 32;

export function createAnalyzeProgressCallbacks(jobId: string): {
  callbacks: AnalyzeProgressCallbacks;
  getTranscript: () => TranscriptTurn[];
} {
  const tokens: string[] = [];
  const transcript: TranscriptTurn[] = [];

  const callbacks: AnalyzeProgressCallbacks = {
    jobId,
    onStatus: (status) => {
      void mergeJobProgress(jobId, { liveStatus: status, tokens, transcript });
    },
    onToken: (text) => {
      tokens.push(text);
      if (tokens.length > MAX_TOKENS) tokens.splice(0, tokens.length - MAX_TOKENS);
      void mergeJobProgress(jobId, { liveStatus: undefined, tokens, transcript });
    },
    onTurnStart: (turn) => {
      transcript.push({
        id: turn.id,
        round: turn.round,
        role: turn.role,
        phase: turn.phase,
        model: turn.model,
        label: turn.label,
        text: "",
        ts: turn.startedAt,
        done: false,
      });
      if (transcript.length > MAX_TRANSCRIPT) transcript.splice(0, transcript.length - MAX_TRANSCRIPT);
      void mergeJobProgress(jobId, { tokens, transcript });
    },
    onTurnDelta: (turnId, delta) => {
      const t = transcript.find((x) => x.id === turnId);
      if (t) t.text += delta;
      void mergeJobProgress(jobId, { tokens, transcript });
    },
    onTurnDone: (turnId, finalText) => {
      const t = transcript.find((x) => x.id === turnId);
      if (t) {
        t.text = finalText;
        t.done = true;
      }
      void mergeJobProgress(jobId, { tokens, transcript });
    },
    onTurnDiscarded: (turnId) => {
      const i = transcript.findIndex((x) => x.id === turnId);
      if (i >= 0) transcript.splice(i, 1);
      void mergeJobProgress(jobId, { tokens, transcript });
    },
  };

  return { callbacks, getTranscript: () => transcript };
}
