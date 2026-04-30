import type { StrategistTranscriptTurn } from "@/lib/store";

/** Transcript rows from Desk mode use round `"desk"` and analyst/PM roles. */
export function isDeskStrategistTranscript(transcript: StrategistTranscriptTurn[]): boolean {
  return transcript.some((t) => t.round === "desk");
}
