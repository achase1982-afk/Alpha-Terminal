import { describe, expect, it } from "vitest";

import {
  buildSectionedCopyPayload,
  COPY_SECTIONS,
  type CopySectionId,
  type StrategistTelemetryCopyRow,
} from "./strategistTelemetryCopyPayload";

/** Stable fixture covering every branch of `buildSectionedCopyPayload`. */
const baseRow: StrategistTelemetryCopyRow = {
  ticker: "IONQ",
  timestamp: "2025-05-05T20:01:00.000Z",
  result: "recommendation",
  regime: { r: 1 },
  tickerData: { t: 2 },
  idioScore: { final: 0.5 },
  toxicGate: { ok: true },
  edgeAttribution: { e: 3 },
  fullDiagnostic: { d: 4 },
  dataPackage: JSON.stringify({
    strategistPayload: { sp: true },
    optionsChainSummary: { o: 1 },
    curatedExpirations: ["a"],
    polygonFlowHighlights: { f: 1 },
    catalyst: { c: 1 },
    dataQualitySummary: { q: 1 },
    catalystEvaluation: { ce: 1 },
    extraSummaryField: "keep",
  }),
  rawAiResponse: "hello",
  confidenceBase: 0.1,
  confidenceCatalystDelta: 0.2,
  confidenceFinal: 0.3,
  scannerSource: "X",
  scannerScore: 1,
  scannerEdgeType: "Y",
  scannerDirectionalLean: "Z",
  scannerMode: "M",
  scannerSurfacedBy: "S",
  scannerFlowScore: 2,
  scannerUniverse: "U",
};

describe("buildSectionedCopyPayload", () => {
  it("matches snapshot when all sections selected", () => {
    const all = new Set(COPY_SECTIONS.map((s) => s.id));
    expect(JSON.stringify(buildSectionedCopyPayload(baseRow, all), null, 2)).toMatchSnapshot();
  });

  it("matches snapshot for subset", () => {
    const sel = new Set<CopySectionId>(["summary", "strategistOutput"]);
    expect(JSON.stringify(buildSectionedCopyPayload(baseRow, sel), null, 2)).toMatchSnapshot();
  });
});
