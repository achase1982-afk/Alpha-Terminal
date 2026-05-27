import type { ValidationTicket, ValidationVerdictPayload } from "../strategistValidate.js";
import type { StrategistV2Result } from "../strategistV2.js";

export type TranscriptTurn = {
  id: string;
  round: 1 | 2 | 3 | "synthesis" | "solo" | "desk";
  role: "A" | "B" | "synthesis" | "system" | "solo" | "vol" | "flow" | "catalyst" | "pm";
  phase: "propose" | "critique" | "final" | "synthesis" | "info" | "solo" | "analyst" | "pm";
  model: string;
  label: string;
  text: string;
  ts: number;
  done: boolean;
};

export type ValidationMeta = {
  ticker: string;
  mode: "opening" | "closing";
  ticket: ValidationTicket;
  thesis?: string;
  rollingShort?: boolean;
};

export type JobProgressState = {
  liveStatus?: string;
  tokens?: string[];
  transcript?: TranscriptTurn[];
  validationMeta?: ValidationMeta | null;
};

export type StrategistPollPayload = {
  jobId: string;
  kind: "analyze" | "validation";
  ticker: string;
  status: string;
  tokens: string[];
  nextSince: number;
  transcript: TranscriptTurn[];
  done: boolean;
  result: StrategistV2Result | ValidationVerdictPayload | null;
  validationMeta: ValidationMeta | null;
  error: string | null;
  cancelled?: boolean;
  startedAt: number;
  finishedAt: number | null;
  serverProgressAt: number;
  source?: "persisted";
};
