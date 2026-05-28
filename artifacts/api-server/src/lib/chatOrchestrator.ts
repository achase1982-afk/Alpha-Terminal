import { generateText, stepCountIs, streamText, type ModelMessage } from "ai";
import type { ChatAttachmentStored } from "@workspace/chat-types";
import type { ChatMessageRow, ChatThreadRow } from "@workspace/db";
import { buildUserModelContent } from "./chatAttachments.js";
import { createChatTools } from "./chatTools/index.js";
import type { ChatToolContext } from "./chatTools/types.js";
import {
  CHAT_SUMMARY_TOKEN_THRESHOLD,
  estimateTokenCount,
  insertChatMessage,
  listChatMessages,
  sumThreadTokenCount,
  truncateChatThreadFromMessage,
  updateChatThreadSummary,
} from "./chatDb.js";
import type { AnthropicOpusCallOptions } from "@workspace/ai-models";
import { resolveChatLanguageModel } from "./chatModel.js";
import { buildAmbientSymbolContextBlock } from "./ambientSymbolContext.js";
import { INVESTIGATIVE_REASONING_PROTOCOL } from "./investigativeReasoningProtocol.js";
import { getMarketContext } from "./getMarketContext.js";
import { formatMarketContextUserBlock } from "./marketContextPrompt.js";
import {
  createChatOutputFormattingStream,
  formatChatOutputText,
} from "./chatOutputFormatting.js";

export { CHAT_SUMMARY_TOKEN_THRESHOLD, estimateTokenCount };

/** Max tool+text steps per chat turn (multi-ticker prompts can use many tool rounds). */
export const CHAT_MAX_TOOL_STEPS = 20;

const SUMMARY_MODEL = "claude-haiku-4-5";
const MAX_RECENT_MESSAGES = 40;

const CHAT_SYNTHESIS_FALLBACK_USER =
  "You have already called tools and received results above. Write the complete final markdown answer for the trader now. Do not call any more tools. If data is missing, say what you cannot confirm.";

/** Shown when tools ran but the model never produced visible text (step limit or provider quirk). */
export const EMPTY_CHAT_RESPONSE_AFTER_TOOLS =
  "**Could not generate a reply** after loading data from tools. This often happens on long multi-ticker questions when the step limit is reached. Try a shorter question, fewer tickers at once, or tap Retry.";

/** User-visible placeholder when the model returns no text and no tools ran. */
export const EMPTY_CHAT_RESPONSE_PLAIN = "(No response generated)";

/** Pick the persisted assistant message when streamText ends with empty text. */
export function formatEmptyChatResponseMessage(hadToolResults: boolean): string {
  return hadToolResults ? EMPTY_CHAT_RESPONSE_AFTER_TOOLS : EMPTY_CHAT_RESPONSE_PLAIN;
}


function reasoningDeltaFromStreamPart(part: { type: string; delta?: string; text?: string }): string | null {
  if (part.type !== "reasoning-delta") return null;
  if (typeof part.delta === "string" && part.delta) return part.delta;
  if (typeof part.text === "string" && part.text) return part.text;
  return null;
}

const CHAT_STATUS_HEARTBEAT_MS = 10_000;
const CHAT_STATUS_HEARTBEAT_NOTES = [
  "Still thinking…",
  "Working through context…",
  "Preparing your answer…",
] as const;

function createChatStatusHeartbeat(onEvent: (ev: ChatStreamEvent) => void) {
  let idx = 0;
  let lastEmit = Date.now();
  return {
    touch() {
      lastEmit = Date.now();
    },
    maybePulse() {
      if (Date.now() - lastEmit < CHAT_STATUS_HEARTBEAT_MS) return;
      lastEmit = Date.now();
      onEvent({
        type: "status",
        note: CHAT_STATUS_HEARTBEAT_NOTES[idx++ % CHAT_STATUS_HEARTBEAT_NOTES.length],
      });
    },
  };
}

function chatToolStatusLabel(toolName: string): string {
  const labels: Record<string, string> = {
    web_search: "Searching the web",
    web_fetch: "Fetching page",
    get_news: "Fetching news",
    get_quote: "Fetching live quote",
    get_portfolio: "Loading portfolio",
    get_technicals: "Loading technicals",
    get_options_chain: "Loading options chain",
    get_flow: "Loading options flow",
    get_ivr: "Loading implied volatility",
    get_earnings: "Loading earnings",
    get_analyst_ratings: "Loading analyst ratings",
    get_market_pulse: "Loading market pulse",
  };
  return labels[toolName] ?? `Running ${toolName.replace(/_/g, " ")}`;
}

export type ChatStreamEvent =
  | { type: "status"; note?: string }
  | { type: "reasoning"; delta: string }
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
- For sell-side ratings, consensus price targets, or valuation sentiment on the ambient ticker, use the internal **Context data** block when present; otherwise call **get_analyst_ratings**. Do not invent analyst counts or price targets.
- **Live tape:** You have the same Schwab live quote pipeline as the terminal (streamer + REST). Use **displayLast** / **latestPrint** for "price now", especially in PREMARKET and AFTERHOURS. Regular session is 9:30 AM–4:00 PM ET, but equity prints can update until ~8 PM ET; do not freeze the story at the 4 PM regular-session mark when extended data is present. If quote age is high or only prior close exists, say the tape may be stale.
- For **why is it moving**, catalyst, or headline questions: read internal context and tools first, then answer in synthesized analyst prose. Do **not** quote headline titles, list wire sources, or say "the terminal/news feed shows." State the catalyst as fact (who, what, size, timing). Call **get_quote**, **get_news**, **get_earnings**, and **web_search** as needed so freshness and catalyst checks use current data, not memory. Do **not** claim no same-day catalyst if context or **get_news** already has material [TODAY] items.
- **Explanatory questions (why / what's going on):** Extended thinking must be enabled or this discipline underperforms. Follow the investigative protocol below. Use tools for live tape, headlines, earnings dates, and web corroboration before you answer.
- **Portfolio:** Internal context may include holdings. For exposure, sizing, overlap, or P/L questions, use **get_portfolio** when needed. Do not invent positions.
- **Voice (absolute):** Never mention Alpha Terminal, terminal snapshot, news feed, Benzinga, Polygon, Finnhub, FMP, Tavily, Serper, web search, or tool names in the user-facing answer. Do not paste headline bullets with timestamps and publishers. Do not say "web search confirms." Integrate facts; if data is missing, say what you cannot confirm without naming backends.
- Use concise markdown; bullet lists for data. No "As an AI…" disclaimers. No greeting or sign-off fluff.
- Options flow honesty. When you discuss options flow, these rules are absolute:
- There is no open/close field in the data. Never state that activity is "opening," "closing," or "fresh positioning" as fact. You may infer opening activity, but only by showing the volume-vs-open-interest reasoning out loud (e.g. "X contracts traded against open interest of Y"), and only as an explicit inference. Volume far above open interest is a strong opening inference; volume near or below open interest is not.
- Opening does not imply direction. A position can be opened by a buyer or a seller. Never let an opening inference turn into a buy or sell claim.
- State trade direction only when the session tape is live (tapeKind "live") and aggressor side data is present, and then cite it (share of prints at the ask vs the bid). When tapeKind is "eod_fallback" or aggressorSessionTotals.knownPct is low, do not assert direction; say the tape does not support a directional read. Aggressor side at the quote also does not tell you whether a participant is institutional or retail.
- Never state market-maker or dealer positioning as fact. "Market makers are short," "dealers had to hedge," "gamma squeeze," "gamma loop" are not in the data. Raise such a mechanism only if you explicitly mark it a hypothesis.
- "Block" means only a single print of 100 contracts or more. It is not an exchange-designated negotiated block and does not by itself signal institutional intent. Never call aggregated daily volume "a single block."
- A put/call ratio is a volume measure only. It does not indicate whether contracts were bought or sold. Do not cite it as evidence of direction.
When the data cannot resolve direction, say so plainly. Show your reasoning and stay honest about what is inference rather than picking a side.
- After tool results, synthesize a clear answer. If tools return errors or empty data, say so plainly.

Formatting. Write in plain prose, the way a sharp analyst writes in a direct message. These rules are absolute:
- No section dividers. Never output a line of dashes or any horizontal rule.
- No emoji anywhere, including as bullets, headers, or status markers, and no green, red, or warning indicators.
- No label-colon section headers such as "Bottom line:", "The Takeaway:", "Key Takeaways:", or "Catalyst Verification:". Just write the content.
- No meta-framing or preamble such as "Here's what I can tell you" or "Here's why this matters." Start with the answer.
- Avoid em dashes. Use commas, periods, or separate sentences instead.
- Answer in the order the user asked. Do not impose a fixed report template.

## Tools available
get_quote, get_portfolio, get_technicals, get_options_chain, get_flow, get_ivr, get_earnings, get_analyst_ratings, get_news, get_market_pulse, web_search, web_fetch

**get_news** returns recent headlines for internal synthesis (do not cite wire names in the reply).

**web_search** supplements missing catalyst context; synthesize results, never attribute them to search or publishers in the reply.

## Investigative reasoning (explanatory questions only)

${INVESTIGATIVE_REASONING_PROTOCOL}`;
}

/** System prompt plus live terminal snapshot (quote + analyst) for the page symbol. */
export type ChatAmbientDataAccess = {
  marketAccessToken?: string | null;
  traderAccessToken?: string | null;
};

export async function buildChatSystemPromptWithAmbient(
  ambientSymbol?: string | null,
  clientTimeZone?: string | null,
  now: Date = new Date(),
  dataAccess: ChatAmbientDataAccess = {},
): Promise<string> {
  const base = buildChatSystemPrompt(ambientSymbol, clientTimeZone, now);
  const ambient = await buildAmbientSymbolContextBlock(ambientSymbol, {
    marketAccessToken: dataAccess.marketAccessToken,
    traderAccessToken: dataAccess.traderAccessToken,
    clientTimeZone,
  });
  return ambient ? `${base}${ambient}` : base;
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
    const attachments = (row.attachments ?? []) as ChatAttachmentStored[];
    if (!text && !attachments.length && row.role === "assistant") continue;
    if (row.role === "user") {
      out.push({ role: "user", content: buildUserModelContent(text, attachments) });
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
  attachments?: ChatAttachmentStored[];
  truncateFromMessageId?: string | null;
  model: string;
  /** Anthropic Opus 4.7+ effort and fast mode (ignored for non-Opus models). */
  anthropicOpusOptions?: AnthropicOpusCallOptions | null;
  /** Provider extended thinking / reasoning (default on). */
  extendedThinkingEnabled?: boolean;
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
  attachments: ChatAttachmentStored[],
  truncateFromMessageId?: string | null,
): Promise<{ summary: string | null; modelMessages: ModelMessage[] }> {
  if (truncateFromMessageId) {
    await truncateChatThreadFromMessage(thread.id, truncateFromMessageId);
  }
  await insertChatMessage({
    threadId: thread.id,
    role: "user",
    content: userMessage.trim(),
    attachments: attachments.length > 0 ? attachments : null,
  });
  const summary = await maybeSummarizeThread(thread);
  const history = await listChatMessages(thread.id);
  const modelMessages: ModelMessage[] = [
    ...buildModelMessagesFromHistory(history.slice(0, -1), summary),
    { role: "user", content: buildUserModelContent(userMessage.trim(), attachments) },
  ];
  return { summary, modelMessages };
}

/**
 * When streamText stops after tool rounds with no user-visible text (step cap or
 * finishReason tool-calls), run one text-only synthesis pass over the full step transcript.
 */
async function synthesizeAfterEmptyToolTurn(args: {
  model: string;
  anthropicOpusOptions?: AnthropicOpusCallOptions | null;
  extendedThinkingEnabled?: boolean;
  system: string;
  modelMessages: ModelMessage[];
  responseMessages: ModelMessage[];
  onEvent: (ev: ChatStreamEvent) => void;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const resolved = resolveChatLanguageModel(args.model, {
    opus: args.anthropicOpusOptions,
    extendedThinkingEnabled: args.extendedThinkingEnabled,
  });
  const synthMessages: ModelMessage[] = [
    ...args.modelMessages,
    ...args.responseMessages,
    { role: "user", content: CHAT_SYNTHESIS_FALLBACK_USER },
  ];
  const result = await generateText({
    model: resolved.model,
    system: args.system,
    messages: synthMessages,
    ...(args.abortSignal ? { abortSignal: args.abortSignal } : {}),
    ...("temperature" in resolved ? { temperature: resolved.temperature } : {}),
    ...("providerOptions" in resolved ? resolved.providerOptions : {}),
  });
  const text = formatChatOutputText(result.text.trim());
  if (text) {
    args.onEvent({ type: "text", delta: text });
  }
  return text;
}

function createFormattedTextEmitter(onEvent: (ev: ChatStreamEvent) => void) {
  const stream = createChatOutputFormattingStream();
  return {
    push(delta: string) {
      if (!delta) return;
      const out = stream.push(delta);
      if (out) onEvent({ type: "text", delta: out });
    },
    flush() {
      const tail = stream.flush();
      if (tail) onEvent({ type: "text", delta: tail });
    },
  };
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
  const resolved = resolveChatLanguageModel(args.model, {
    opus: args.toolContext.anthropicOpusOptions,
    extendedThinkingEnabled: args.toolContext.extendedThinkingEnabled,
  });
  const system = await buildChatSystemPromptWithAmbient(args.ambientSymbol, args.clientTimeZone, new Date(), {
    marketAccessToken: args.toolContext.schwabAccessToken,
    traderAccessToken: args.toolContext.traderAccessToken,
  });
  try {
    const result = await generateText({
      model: resolved.model,
      system,
      messages: args.modelMessages,
      tools,
      stopWhen: stepCountIs(CHAT_MAX_TOOL_STEPS),
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
  const { thread, userMessage, anthropicOpusOptions, ambientSymbol, clientTimeZone, toolContext, onEvent, multiAgent, abortSignal } = args;
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

  const { modelMessages } = await prepareTurnMessages(thread, userMessage, args.attachments ?? [], args.truncateFromMessageId);

  if (abortSignal?.aborted) return;

  const settled = await Promise.all(
    models.map((model) =>
      runDraftChatTurn({
        model,
        modelMessages,
        ambientSymbol,
        clientTimeZone,
        toolContext: {
          ...toolContext,
          activeModel: model,
          anthropicOpusOptions,
          extendedThinkingEnabled: args.extendedThinkingEnabled,
        },
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

  const synthResolved = resolveChatLanguageModel(synthesizerModel, {
    opus: anthropicOpusOptions,
    extendedThinkingEnabled: args.extendedThinkingEnabled,
  });
  const synthMessages: ModelMessage[] = [
    ...modelMessages,
    { role: "user", content: buildMultiAgentSynthesisUserContent(successes, failures) },
  ];

  let assistantText = "";
  const textEmitter = createFormattedTextEmitter(onEvent);
  try {
    const synthSystem = `${await buildChatSystemPromptWithAmbient(ambientSymbol, clientTimeZone, new Date(), {
      marketAccessToken: toolContext.schwabAccessToken,
      traderAccessToken: toolContext.traderAccessToken,
    })}\n\n${MULTI_AGENT_SYNTH_SYSTEM}`;
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
      const reasoningDelta = reasoningDeltaFromStreamPart(part);
      if (reasoningDelta) {
        onEvent({ type: "reasoning", delta: reasoningDelta });
      } else if (part.type === "text-delta" && part.text) {
        assistantText += part.text;
        textEmitter.push(part.text);
      }
    }

    if (abortSignal?.aborted) return;

    textEmitter.flush();
    let finalText = formatChatOutputText((await result.text).trim() || assistantText.trim());
    if (!finalText) {
      const response = await result.response;
      finalText = await synthesizeAfterEmptyToolTurn({
        model: synthesizerModel,
        anthropicOpusOptions,
        extendedThinkingEnabled: args.extendedThinkingEnabled,
        system: synthSystem,
        modelMessages: synthMessages,
        responseMessages: response.messages as ModelMessage[],
        onEvent,
        abortSignal,
      });
    }
    const saved = await insertChatMessage({
      threadId: thread.id,
      role: "assistant",
      content: finalText || formatEmptyChatResponseMessage(false),
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
  const { thread, userMessage, model, anthropicOpusOptions, ambientSymbol, clientTimeZone, toolContext, onEvent, abortSignal } = args;

  const { modelMessages } = await prepareTurnMessages(thread, userMessage, args.attachments ?? [], args.truncateFromMessageId);

  const tools = createChatTools({ ...toolContext, activeModel: model, anthropicOpusOptions });
  const resolved = resolveChatLanguageModel(model, {
    opus: anthropicOpusOptions,
    extendedThinkingEnabled: args.extendedThinkingEnabled,
  });
  const system = await buildChatSystemPromptWithAmbient(ambientSymbol, clientTimeZone, new Date(), {
    marketAccessToken: toolContext.schwabAccessToken,
    traderAccessToken: toolContext.traderAccessToken,
  });

  onEvent({ type: "status", note: "thinking" });
  const statusHeartbeat = createChatStatusHeartbeat(onEvent);

  const toolCallsLog: Array<{ toolCallId: string; toolName: string; input: unknown }> = [];
  const toolResultsLog: Array<{ toolCallId: string; toolName: string; output: unknown }> = [];
  let assistantText = "";
  const textEmitter = createFormattedTextEmitter(onEvent);

  try {
    const result = streamText({
      model: resolved.model,
      system,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(CHAT_MAX_TOOL_STEPS),
      ...(abortSignal ? { abortSignal } : {}),
      ...("temperature" in resolved ? { temperature: resolved.temperature } : {}),
      ...("providerOptions" in resolved ? resolved.providerOptions : {}),
    });

    for await (const part of result.fullStream) {
      if (abortSignal?.aborted) break;
      statusHeartbeat.maybePulse();
      const reasoningDelta = reasoningDeltaFromStreamPart(part);
      if (reasoningDelta) {
        statusHeartbeat.touch();
        onEvent({ type: "reasoning", delta: reasoningDelta });
        onEvent({ type: "status", note: "Thinking through your question…" });
      } else if (part.type === "text-delta" && part.text) {
        statusHeartbeat.touch();
        assistantText += part.text;
        textEmitter.push(part.text);
      } else if (part.type === "tool-call") {
        statusHeartbeat.touch();
        const toolCallId = part.toolCallId;
        const toolName = part.toolName;
        const input = "input" in part ? part.input : {};
        toolCallsLog.push({ toolCallId, toolName, input });
        onEvent({ type: "status", note: chatToolStatusLabel(toolName) });
        onEvent({ type: "tool_call_start", toolCallId, toolName, input });
      } else if (part.type === "tool-result") {
        statusHeartbeat.touch();
        const toolCallId = part.toolCallId;
        const toolName = part.toolName;
        const output = "output" in part ? part.output : null;
        toolResultsLog.push({ toolCallId, toolName, output });
        onEvent({ type: "tool_call_end", toolCallId, toolName, output });
      }
    }

    if (abortSignal?.aborted) return;

    textEmitter.flush();
    let finalText = formatChatOutputText((await result.text).trim() || assistantText.trim());
    const hadToolResults = toolResultsLog.length > 0;
    if (!finalText && hadToolResults) {
      const response = await result.response;
      finalText = await synthesizeAfterEmptyToolTurn({
        model,
        anthropicOpusOptions,
        extendedThinkingEnabled: args.extendedThinkingEnabled,
        system,
        modelMessages,
        responseMessages: response.messages as ModelMessage[],
        onEvent,
        abortSignal,
      });
    }

    const saved = await insertChatMessage({
      threadId: thread.id,
      role: "assistant",
      content: finalText || formatEmptyChatResponseMessage(hadToolResults),
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
