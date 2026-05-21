import { generateText, stepCountIs, streamText, type ModelMessage } from "ai";
import type { ChatMessageRow, ChatThreadRow } from "@workspace/db";
import { createChatTools } from "./chatTools/index.js";
import type { ChatToolContext } from "./chatTools/types.js";
import {
  CHAT_SUMMARY_TOKEN_THRESHOLD,
  estimateTokenCount,
  insertChatMessage,
  listChatMessages,
  sumThreadTokenCount,
  updateChatThreadSummary,
} from "./chatDb.js";
import { resolveChatLanguageModel } from "./chatModel.js";
import { getMarketContext } from "./getMarketContext.js";
import { formatMarketContextUserBlock } from "./marketContextPrompt.js";

export { CHAT_SUMMARY_TOKEN_THRESHOLD, estimateTokenCount };

const SUMMARY_MODEL = "claude-haiku-4-5";
const MAX_RECENT_MESSAGES = 40;

export type ChatStreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call_start"; toolCallId: string; toolName: string; input: unknown }
  | { type: "tool_call_end"; toolCallId: string; toolName: string; output: unknown }
  | { type: "done"; threadId: string; assistantMessageId: string }
  | { type: "error"; message: string };

/** Exported for tests — persona + ambient symbol + tool guidance (no regex routing, no eager pack). */
export function buildChatSystemPrompt(
  ambientSymbol?: string | null,
  clientTimeZone?: string | null,
  now: Date = new Date(),
): string {
  const marketContext = getMarketContext(now, clientTimeZone?.trim() || "America/New_York");
  const marketBlock = formatMarketContextUserBlock(marketContext);
  const sym = ambientSymbol?.trim().toUpperCase() || null;
  const ambientBlock = sym
    ? `The user is viewing **${sym}** in the terminal. Treat **${sym}** as the default referent for phrases like "this", "this stock", "it", or "here" — but only when the question is clearly about that company. Do not force every answer to be about ${sym}; general finance questions need no ticker tools unless useful.

If a phrase could refer to multiple tickers (e.g. "ON", "IT", "NOW") and context does not disambiguate, **ask the user briefly** which symbol they mean before calling data tools. Never invent a ticker from common English words.`
    : `No page symbol was sent. If the user asks about a specific company, use an explicit ticker from their message or ask which symbol they mean.`;

  return `You are Alpha Terminal, an expert trading and markets assistant inside the Alpha Financial Terminal.

${marketBlock}

When the user asks for the current time, market close, or time until close, use **only** the MARKET CONTEXT block above (US Eastern Time). Do not infer time from training data or any other clock.

${ambientBlock}

## How to work
- Answer general questions (definitions, strategy concepts, education) from your knowledge without tools.
- Call tools when the user needs **current** prices, flow, technicals, news, earnings, IV rank, options chain, or market pulse data.
- Use concise markdown; bullet lists for data. No "As an AI…" disclaimers. No greeting or sign-off fluff.
- Options flow: \`side\` ask/bid/mid is NBBO aggressor tagging, not institutional vs retail unless you label it as inference.
- After tool results, synthesize a clear answer. If tools return errors or empty data, say so plainly.

## Tools available
get_quote, get_technicals, get_options_chain, get_flow, get_ivr, get_earnings, get_news, get_market_pulse, web_search, web_fetch

**web_search** uses Tavily when TAVILY_API_KEY is set (Serper fallback via SERPER_API_KEY); otherwise your chat model's provider-native search (Claude, Gemini, or OpenAI).`;
}

export function shouldSummarizeThread(totalTokens: number): boolean {
  return totalTokens > CHAT_SUMMARY_TOKEN_THRESHOLD;
}

/** Build model messages from persisted rows (text-focused replay). */
export function buildModelMessagesFromHistory(
  rows: ChatMessageRow[],
  threadSummary: string | null,
): ModelMessage[] {
  const recent = rows.slice(-MAX_RECENT_MESSAGES);
  const out: ModelMessage[] = [];
  if (threadSummary?.trim()) {
    out.push({
      role: "user",
      content: `[Prior conversation summary for context]\n${threadSummary.trim()}`,
    });
    out.push({
      role: "assistant",
      content: "Understood — I have the prior context.",
    });
  }
  for (const row of recent) {
    const text = row.content?.trim() ?? "";
    if (!text && row.role === "assistant") continue;
    if (row.role === "user") {
      out.push({ role: "user", content: text });
    } else if (row.role === "assistant") {
      out.push({ role: "assistant", content: text });
    }
  }
  return out;
}

async function generateThreadSummary(rows: ChatMessageRow[]): Promise<string> {
  const body = rows
    .map((r) => `${r.role.toUpperCase()}: ${r.content}`)
    .join("\n\n")
    .slice(0, 120_000);
  const resolved = resolveChatLanguageModel(SUMMARY_MODEL);
  const result = await generateText({
    model: resolved.model,
    system:
      "Summarize this trading-terminal chat for continuity. Preserve tickers, numbers, tool findings, and open questions. Under 800 words.",
    prompt: body,
    ...("temperature" in resolved ? { temperature: resolved.temperature } : {}),
    ...("providerOptions" in resolved ? resolved.providerOptions : {}),
  });
  return result.text.trim();
}

export async function maybeSummarizeThread(thread: ChatThreadRow): Promise<string | null> {
  const total = await sumThreadTokenCount(thread.id);
  if (!shouldSummarizeThread(total)) return thread.summary;

  const rows = await listChatMessages(thread.id);
  if (rows.length < 4) return thread.summary;

  const toSummarize = rows.slice(0, Math.max(0, rows.length - 12));
  if (toSummarize.length < 2) return thread.summary;

  const summary = await generateThreadSummary(toSummarize);
  await updateChatThreadSummary(thread.id, summary);
  return summary;
}

export type RunChatTurnArgs = {
  thread: ChatThreadRow;
  userMessage: string;
  model: string;
  ambientSymbol?: string | null;
  clientTimeZone?: string | null;
  toolContext: ChatToolContext;
  onEvent: (ev: ChatStreamEvent) => void;
  abortSignal?: AbortSignal;
};

export type MultiAgentConfig = {
  models: string[];
  synthesizer_model: string;
};

const SYNTH_DRAFT_CHAR_CAP = 8000;

const MULTI_AGENT_SYNTH_SYSTEM = `You are the final synthesizer for Alpha Terminal.

Several models produced research drafts on the trader's question. Treat drafts as unvetted — they may disagree or hallucinate.

Output one markdown answer as the single source of truth. Ground material claims in the user's messages and tool-backed facts from the conversation. When drafts conflict, prefer evidence from the thread; if unresolved, say so briefly. Discard invented tickers or unsupported numbers. Do not mention "Model A/B" or the synthesis process.`;

function buildMultiAgentSynthesisUserContent(
  successes: Array<{ model: string; text: string }>,
  failures: Array<{ model: string; message: string }>,
): string {
  const blocks = successes
    .map((x) => {
      const raw = x.text.trim();
      const clipped =
        raw.length > SYNTH_DRAFT_CHAR_CAP
          ? `${raw.slice(0, SYNTH_DRAFT_CHAR_CAP)}\n\n_[Draft truncated for length]_`
          : raw;
      return `### Draft from \`${x.model}\`\n\n${clipped}`;
    })
    .join("\n\n---\n\n");

  const failNote =
    failures.length > 0
      ? `\n\n### Research runs that failed (no draft)\n\n${failures.map((f) => `- \`${f.model}\`: ${f.message}`).join("\n")}`
      : "";

  return `${blocks}${failNote}\n\nWrite the final markdown answer now.`;
}

async function prepareTurnMessages(
  thread: ChatThreadRow,
  userMessage: string,
): Promise<{ summary: string | null; modelMessages: ModelMessage[] }> {
  await insertChatMessage({
    threadId: thread.id,
    role: "user",
    content: userMessage.trim(),
  });
  const summary = await maybeSummarizeThread(thread);
  const history = await listChatMessages(thread.id);
  const modelMessages: ModelMessage[] = [
    ...buildModelMessagesFromHistory(history.slice(0, -1), summary),
    { role: "user", content: userMessage.trim() },
  ];
  return { summary, modelMessages };
}

async function runDraftChatTurn(args: {
  model: string;
  modelMessages: ModelMessage[];
  ambientSymbol?: string | null;
  clientTimeZone?: string | null;
  toolContext: ChatToolContext;
  abortSignal?: AbortSignal;
}): Promise<{ model: string; text?: string; error?: string }> {
  const tools = createChatTools({ ...args.toolContext, activeModel: args.model });
  const resolved = resolveChatLanguageModel(args.model);
  const system = buildChatSystemPrompt(args.ambientSymbol, args.clientTimeZone);
  try {
    const result = await generateText({
      model: resolved.model,
      system,
      messages: args.modelMessages,
      tools,
      stopWhen: stepCountIs(12),
      ...(args.abortSignal ? { abortSignal: args.abortSignal } : {}),
      ...("temperature" in resolved ? { temperature: resolved.temperature } : {}),
      ...("providerOptions" in resolved ? resolved.providerOptions : {}),
    });
    const text = result.text.trim();
    if (!text) return { model: args.model, error: "Empty draft" };
    return { model: args.model, text };
  } catch (err) {
    if (args.abortSignal?.aborted) {
      return { model: args.model, error: "Aborted" };
    }
    return {
      model: args.model,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Parallel draft models (not persisted), then stream synthesizer-only output to the client. */
export async function runMultiAgentChatTurn(
  args: RunChatTurnArgs & { multiAgent: MultiAgentConfig },
): Promise<void> {
  const { thread, userMessage, ambientSymbol, clientTimeZone, toolContext, onEvent, multiAgent, abortSignal } = args;
  const models = multiAgent.models.filter((m) => m.trim().length > 0);
  const synthesizerModel = multiAgent.synthesizer_model.trim();
  if (models.length === 0) {
    onEvent({ type: "error", message: "multi_agent.models must include at least one model." });
    return;
  }
  if (!synthesizerModel) {
    onEvent({ type: "error", message: "multi_agent.synthesizer_model is required." });
    return;
  }

  const { modelMessages } = await prepareTurnMessages(thread, userMessage);

  if (abortSignal?.aborted) return;

  const settled = await Promise.all(
    models.map((model) =>
      runDraftChatTurn({
        model,
        modelMessages,
        ambientSymbol,
        clientTimeZone,
        toolContext: { ...toolContext, activeModel: model },
        abortSignal,
      }),
    ),
  );

  if (abortSignal?.aborted) return;

  const successes = settled.filter((r): r is { model: string; text: string } => Boolean(r.text));
  const failures = settled
    .filter((r) => !r.text)
    .map((r) => ({ model: r.model, message: r.error ?? "Draft failed" }));

  if (successes.length === 0) {
    onEvent({ type: "error", message: failures[0]?.message ?? "All research models failed." });
    return;
  }

  const synthResolved = resolveChatLanguageModel(synthesizerModel);
  const synthMessages: ModelMessage[] = [
    ...modelMessages,
    { role: "user", content: buildMultiAgentSynthesisUserContent(successes, failures) },
  ];

  let assistantText = "";
  try {
    const synthSystem = `${buildChatSystemPrompt(ambientSymbol, clientTimeZone)}\n\n${MULTI_AGENT_SYNTH_SYSTEM}`;
    const result = streamText({
      model: synthResolved.model,
      system: synthSystem,
      messages: synthMessages,
      stopWhen: stepCountIs(8),
      ...(abortSignal ? { abortSignal } : {}),
      ...("temperature" in synthResolved ? { temperature: synthResolved.temperature } : {}),
      ...("providerOptions" in synthResolved ? synthResolved.providerOptions : {}),
    });

    for await (const part of result.fullStream) {
      if (abortSignal?.aborted) break;
      if (part.type === "text-delta" && part.text) {
        assistantText += part.text;
        onEvent({ type: "text", delta: part.text });
      }
    }

    if (abortSignal?.aborted) return;

    const finalText = (await result.text).trim() || assistantText.trim();
    const saved = await insertChatMessage({
      threadId: thread.id,
      role: "assistant",
      content: finalText || "(No response generated)",
    });
    onEvent({ type: "done", threadId: thread.id, assistantMessageId: saved.id });
  } catch (err) {
    if (abortSignal?.aborted) return;
    const msg = err instanceof Error ? err.message : String(err);
    onEvent({ type: "error", message: msg });
    throw err;
  }
}

export async function runChatTurn(args: RunChatTurnArgs): Promise<void> {
  const { thread, userMessage, model, ambientSymbol, clientTimeZone, toolContext, onEvent, abortSignal } = args;

  const { modelMessages } = await prepareTurnMessages(thread, userMessage);

  const tools = createChatTools({ ...toolContext, activeModel: model });
  const resolved = resolveChatLanguageModel(model);
  const system = buildChatSystemPrompt(ambientSymbol, clientTimeZone);

  const toolCallsLog: Array<{ toolCallId: string; toolName: string; input: unknown }> = [];
  const toolResultsLog: Array<{ toolCallId: string; toolName: string; output: unknown }> = [];
  let assistantText = "";

  try {
    const result = streamText({
      model: resolved.model,
      system,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(12),
      ...(abortSignal ? { abortSignal } : {}),
      ...("temperature" in resolved ? { temperature: resolved.temperature } : {}),
      ...("providerOptions" in resolved ? resolved.providerOptions : {}),
    });

    for await (const part of result.fullStream) {
      if (abortSignal?.aborted) break;
      if (part.type === "text-delta" && part.text) {
        assistantText += part.text;
        onEvent({ type: "text", delta: part.text });
      } else if (part.type === "tool-call") {
        const toolCallId = part.toolCallId;
        const toolName = part.toolName;
        const input = "input" in part ? part.input : {};
        toolCallsLog.push({ toolCallId, toolName, input });
        onEvent({ type: "tool_call_start", toolCallId, toolName, input });
      } else if (part.type === "tool-result") {
        const toolCallId = part.toolCallId;
        const toolName = part.toolName;
        const output = "output" in part ? part.output : null;
        toolResultsLog.push({ toolCallId, toolName, output });
        onEvent({ type: "tool_call_end", toolCallId, toolName, output });
      }
    }

    if (abortSignal?.aborted) return;

    const finalText = (await result.text).trim() || assistantText.trim();
    const saved = await insertChatMessage({
      threadId: thread.id,
      role: "assistant",
      content: finalText || "(No response generated)",
      toolCalls: toolCallsLog.length ? toolCallsLog : undefined,
      toolResults: toolResultsLog.length ? toolResultsLog : undefined,
    });

    onEvent({ type: "done", threadId: thread.id, assistantMessageId: saved.id });
  } catch (err) {
    if (abortSignal?.aborted) return;
    const msg = err instanceof Error ? err.message : String(err);
    onEvent({ type: "error", message: msg });
    throw err;
  }
}
