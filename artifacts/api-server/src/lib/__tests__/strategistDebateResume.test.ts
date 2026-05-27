import { describe, expect, it, vi, beforeEach } from "vitest";
import { EXPECTED_TURNS, runDebate } from "../strategistDebate.js";
import type { StrategistModelOption } from "../strategistSettings.js";

const mockEnvelope = {
  provider: "openai" as const,
  modelId: "gpt-test",
  stopReason: null,
  usage: { inputTokens: null, outputTokens: null, reasoningTokens: null, totalTokens: null },
  reasoningText: null,
};

const mockLlmResult = {
  text: '{"confidence": 55, "thesis": "test"}',
  trace: { webSearchUsed: false, queries: [], sources: [] },
  envelope: mockEnvelope,
};

const model: StrategistModelOption = {
  provider: "openai",
  model: "gpt-test",
  label: "Test Model",
};

vi.mock("../aiLabAnalystClient.js", () => ({
  streamCallOpenAIWithSystemAndWebSearch: vi.fn(async (_model, _temp, _sys, _prompt, onDelta) => {
    onDelta(mockLlmResult.text);
    return mockLlmResult;
  }),
  streamCallAnthropicWithSystemAndWebSearch: vi.fn(),
  streamCallGeminiWithSystemAndWebSearch: vi.fn(),
  streamCallXaiWithSystemAndWebSearch: vi.fn(),
}));

describe("runDebate resume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("EXPECTED_TURNS is 7 LLM turns", () => {
    expect(EXPECTED_TURNS).toBe(7);
  });

  it("resumes from checkpoint without re-running completed turns", async () => {
    const resumeTurns: Record<string, string> = {
      r1a: '{"confidence": 60, "side": "BULL"}',
      r1b: '{"confidence": 40, "side": "BEAR"}',
      r2a: '{"revisedConfidence": 62}',
      r2b: '{"revisedConfidence": 38}',
      s3a: '{"strategy": "bull_put_spread"}',
      s3b: '{"strategy": "bear_call_spread"}',
    };
    const checkpoints: string[] = [];
    let llmCalls = 0;
    const { streamCallOpenAIWithSystemAndWebSearch } = await import("../aiLabAnalystClient.js");
    vi.mocked(streamCallOpenAIWithSystemAndWebSearch).mockImplementation(async () => {
      llmCalls += 1;
      return {
        text: '{"strategy":"iron_condor","confidence":70,"legs":[]}',
        trace: { webSearchUsed: false, queries: [], sources: [] },
        envelope: mockEnvelope,
      };
    });

    await runDebate({
      systemPrompt: "sys",
      dataPackage: "{}",
      config: { modelA: model, modelB: model, arbitratorModel: model, convergence: 3, tieBand: 10 },
      resumeTurns,
      onTurnCheckpoint: async (key) => {
        checkpoints.push(key);
      },
    });

    expect(llmCalls).toBe(1);
    expect(checkpoints).toEqual(["build"]);
  });
});
