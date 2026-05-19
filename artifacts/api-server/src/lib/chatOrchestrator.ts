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
export function buildChatSystemPrompt(ambientSymbol?: string | null): string {
  const sym = ambientSymbol?.trim().toUpperCase() || null;
  const ambientBlock = sym
    ? `The user is viewing **${sym}** in the terminal. Treat **${sym}** as the default referent for phrases like "this", "this stock", "it", or "here" — but only when the question is clearly about that company. Do not force every answer to be about ${sym}; general finance questions need no ticker tools unless useful.

If a phrase could refer to multiple tickers (e.g. "ON", "IT", "NOW") and context does not disambiguate, **ask the user briefly** which symbol they mean before calling data tools. Never invent a ticker from common English words.`
    : `No page symbol was sent. If the user asks about a specific company, use an explicit ticker from their message or ask which symbol they mean.`;

  return `You are Alpha Terminal, an expert trading and markets assistant inside the Alpha Financial Terminal.

Today is ${new Date().toDateString()}. ${new Date().toLocaleString()}.

${ambientBlock}

## How to work
- Answer general questions (definitions, strategy concepts, education) from your knowledge without tools.
- Call tools when the user needs **current** prices, flow, technicals, news, earnings, IV rank, options chain, or market pulse data.
- Use concise markdown; bullet lists for data. No "As an AI…" disclaimers. No greeting or sign-off fluff.
- Options flow: \`side\` ask/bid/mid is NBBO aggressor tagging, not institutional vs retail unless you label it as inference.
- After tool results, synthesize a clear answer. If tools return errors or empty data, say so plainly.

## Tools available
get_quote, get_technicals, get_options_chain, get_flow, get_ivr, get_earnings, get_news, get_market_pulse, web_search, web_fetch`;
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
  toolContext: ChatToolContext;
  onEvent: (ev: ChatStreamEvent) => void;
};

export async function runChatTurn(args: RunChatTurnArgs): Promise<void> {
  const { thread, userMessage, model, ambientSymbol, toolContext, onEvent } = args;

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

  const tools = createChatTools(toolContext);
  const resolved = resolveChatLanguageModel(model);
  const system = buildChatSystemPrompt(ambientSymbol);

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
      ...("temperature" in resolved ? { temperature: resolved.temperature } : {}),
      ...("providerOptions" in resolved ? resolved.providerOptions : {}),
    });

    for await (const part of result.fullStream) {
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
    const msg = err instanceof Error ? err.message : String(err);
    onEvent({ type: "error", message: msg });
    throw err;
  }
}
