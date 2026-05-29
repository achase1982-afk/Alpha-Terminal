/** Full strategist report schema (drawer only). Numbers are [E]/[F]/[T]; prose fields are [M]. */

export type ReportTone = "green" | "red" | "amber" | "yellow" | "white";

export type StatChip = {
  label: string;
  value: string;
  tone?: ReportTone;
};

export type RevisionTrend = "rising" | "falling" | "flat";
export type TapeVerdict = "accumulation" | "distribution" | "mixed";
export type StreetTapeAlignment = "aligned" | "divergent";
export type FlowBias = "call-buy/put-sell" | "put-buy/call-sell" | "mixed";

export type ReportProse = {
  confidenceRead: string;
  whyInPlay: string;
  thesisWithNumbers: string;
  streetVsTapeProse: string;
  idioMacroNote: string;
  sectorExposureNote: string;
  whyStructure: string;
  bearCase: string;
  riskManagementProse: string;
};

export type StrategistFullReport = {
  provenance: {
    generatedAt: string;
    signalPrice: number | null;
    freshness: Array<{ source: string; asOf: string | null }>;
    confidence: number;
    confidenceTier: ReportTone;
    confidenceRead: string;
  };
  tradeRecap?: { chips: StatChip[] };
  whyInPlay?: { chips: StatChip[]; body: string };
  thesisWithNumbers?: { chips: StatChip[]; body: string };
  streetVsTape?: {
    sellSide: {
      available: boolean;
      chips: StatChip[];
      recent: Array<{ firm: string; action: string; from: string; to: string; date: string }>;
    };
    buySide: { chips: StatChip[] };
    tapeVerdict: TapeVerdict;
    streetTapeAlignment: StreetTapeAlignment;
    body: string;
  };
  idioMacro?: { chips: StatChip[]; body: string };
  sectorExposure?: { peers: string[]; drivers: string[]; body: string };
  whyStructure?: { body: string };
  bearCase?: { body: string };
  riskManagement?: { chips: StatChip[]; body: string };
  dataAssumptions?: { sources: string[]; modeledFields: string[] };
};
