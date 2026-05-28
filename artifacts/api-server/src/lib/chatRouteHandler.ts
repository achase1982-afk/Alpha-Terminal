import type { Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { getBestAccessToken, getTokens } from "./tokenStore.js";
import {
  createChatThread,
  getChatThreadForUser,
} from "./chatDb.js";
import { attachmentSummaryForTitle, sanitizeChatAttachments } from "./chatAttachments.js";
import { runChatTurn, runMultiAgentChatTurn, type ChatStreamEvent } from "./chatOrchestrator.js";
import { isGrokModel, XAI_CHAT_TOOLS_NOTE } from "./chatModel.js";
import { parseAnthropicOpusCallOptionsBody } from "@workspace/ai-models";
import { readClientTimeZone } from "./marketClientTimeZone.js";
import { createChatTelemetryBatch, emitChatTelemetry } from "./chatTelemetry.js";

const DEV_USER_ID = "dev-bypass-user";

function getUserId(req: Request): string | null {
  if (process.env.DEV_BYPASS_AUTH === "true") return DEV_USER_ID;
  return getAuth(req).userId ?? null;
}

function writeSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * POST body: `{ thread_id?, message, model?, symbol?, multi_agent?: { models, synthesizer_model } }`
 * SSE events: thread, reasoning, text, tool_call_start, tool_call_end, done, error
 */
export async function handleChatMessageSse(req: Request, res: Response): Promise<void> {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const body = req.body as {
    thread_id?: string;
    message?: string;
    attachments?: unknown;
    truncate_from_message_id?: string;
    model?: string;
    anthropic_opus_effort?: string;
    anthropic_opus_speed?: string;
    extended_thinking?: boolean;
    symbol?: string;
    clientTimeZone?: string;
    multi_agent?: {
      models?: string[];
      synthesizer_model?: string;
    };
  };

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const attachments = sanitizeChatAttachments(body.attachments);
  const truncateFromMessageId =
    typeof body.truncate_from_message_id === "string"
      ? body.truncate_from_message_id.trim()
      : "";
  if (!message && attachments.length === 0) {
    res.status(400).json({ error: "message or attachments required." });
    return;
  }

  const ambientSymbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase() : null;
  const multiAgentRaw = body.multi_agent;
  const multiAgentModels = Array.isArray(multiAgentRaw?.models)
    ? multiAgentRaw!.models!.filter((m): m is string => typeof m === "string" && m.trim().length > 0)
    : [];
  const synthesizerModel =
    typeof multiAgentRaw?.synthesizer_model === "string"
      ? multiAgentRaw.synthesizer_model.trim()
      : "";
  const useMultiAgent = multiAgentModels.length >= 2 && synthesizerModel.length > 0;
  const model = (useMultiAgent ? synthesizerModel : (body.model ?? "claude-opus-4-8")).trim();
  const anthropicOpusOptions = parseAnthropicOpusCallOptionsBody(body);
  const extendedThinkingEnabled = body.extended_thinking !== false;

  let threadId = typeof body.thread_id === "string" ? body.thread_id.trim() : "";
  let thread = threadId ? await getChatThreadForUser(userId, threadId) : null;

  const threadSymbol = thread?.symbol?.trim().toUpperCase() ?? null;
  if (
    thread &&
    ambientSymbol &&
    threadSymbol &&
    threadSymbol !== ambientSymbol
  ) {
    thread = null;
    threadId = "";
  }

  if (!thread) {
    const titleBase = message || attachmentSummaryForTitle(attachments);
    thread = await createChatThread({
      userId,
      symbol: ambientSymbol,
      title: titleBase.slice(0, 48) || "Chat",
    });
    threadId = thread.id;
  }

  const telemetry = createChatTelemetryBatch({ threadId, symbol: ambientSymbol ?? undefined });
  emitChatTelemetry("INFO", "Chat turn accepted", {
    userId,
    model,
    useMultiAgent,
    multiAgentModels: useMultiAgent ? multiAgentModels : undefined,
    synthesizerModel: useMultiAgent ? synthesizerModel : undefined,
    extendedThinkingEnabled,
    anthropicOpusOptions,
    attachmentCount: attachments.length,
    messageChars: message.length,
  }, telemetry);

  const schwabAccessToken = getBestAccessToken();
  const traderAccessToken = getTokens("trader")?.accessToken ?? null;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  emitChatTelemetry("INFO", "Chat SSE stream opened", { threadId }, telemetry);

  writeSse(res, "thread", { thread_id: threadId });
  writeSse(res, "status", { note: "Starting analysis…" });

  if (isGrokModel(model)) {
    writeSse(res, "status", { note: XAI_CHAT_TOOLS_NOTE });
  }
  if (useMultiAgent) {
    writeSse(res, "status", {
      phase: "multi_agent_drafting",
      model_count: multiAgentModels.length,
      synthesizer_model: synthesizerModel,
    });
    emitChatTelemetry(
      "INFO",
      `Multi-agent drafting: ${multiAgentModels.length} parallel models → ${synthesizerModel}`,
      { researchModels: multiAgentModels, synthesizerModel },
      telemetry,
    );
  }

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": ping\n\n");
  }, 15_000);

  const clientTimeZone =
    typeof body.clientTimeZone === "string" && body.clientTimeZone.trim().length > 0
      ? body.clientTimeZone.trim()
      : readClientTimeZone(req);

  let sawText = false;
  let sawError = false;

  const turnArgs = {
    thread,
    userMessage: message,
    attachments,
    truncateFromMessageId: truncateFromMessageId || null,
    model,
    anthropicOpusOptions,
    extendedThinkingEnabled,
    ambientSymbol,
    clientTimeZone,
    toolContext: {
      userId,
      schwabAccessToken,
      traderAccessToken,
      clientTimeZone,
      activeModel: model,
      anthropicOpusOptions,
      extendedThinkingEnabled,
    },
    /** Keep generating after SSE disconnect so thread reload can pick up the assistant row. */
    onEvent: (ev: ChatStreamEvent) => {
        if (res.writableEnded) return;
        switch (ev.type) {
          case "status": {
            const note = ev.note ?? "thinking";
            writeSse(res, "status", { note });
            const lower = note.toLowerCase();
            if (
              !lower.includes("still thinking") &&
              !lower.includes("working through context") &&
              !lower.includes("preparing your answer") &&
              lower !== "thinking"
            ) {
              emitChatTelemetry("INFO", `Chat status: ${note}`, undefined, telemetry);
            }
            break;
          }
          case "reasoning":
            writeSse(res, "reasoning", { delta: ev.delta });
            break;
          case "text":
            if (!sawText) {
              sawText = true;
              emitChatTelemetry("INFO", "Chat first text token", { model }, telemetry);
            }
            writeSse(res, "text", { delta: ev.delta });
            break;
          case "tool_call_start":
            writeSse(res, "tool_call_start", {
              toolCallId: ev.toolCallId,
              toolName: ev.toolName,
              input: ev.input,
            });
            emitChatTelemetry("INFO", `Chat tool start: ${ev.toolName}`, { toolCallId: ev.toolCallId }, telemetry);
            break;
          case "tool_call_end":
            writeSse(res, "tool_call_end", {
              toolCallId: ev.toolCallId,
              toolName: ev.toolName,
              output: ev.output,
            });
            emitChatTelemetry("INFO", `Chat tool end: ${ev.toolName}`, { toolCallId: ev.toolCallId }, telemetry);
            break;
          case "done":
            emitChatTelemetry("INFO", "Chat turn done", {
              assistantMessageId: ev.assistantMessageId,
              threadId: ev.threadId,
            }, telemetry);
            writeSse(res, "done", {
              thread_id: ev.threadId,
              assistant_message_id: ev.assistantMessageId,
            });
            break;
          case "error":
            sawError = true;
            emitChatTelemetry("ERROR", `Chat turn error: ${ev.message}`, { model }, telemetry);
            writeSse(res, "error", { message: ev.message });
            break;
        }
      },
  };

  try {
    if (useMultiAgent) {
      await runMultiAgentChatTurn({
        ...turnArgs,
        multiAgent: { models: multiAgentModels, synthesizer_model: synthesizerModel },
      });
    } else {
      await runChatTurn(turnArgs);
    }
    if (!sawText && !sawError) {
      emitChatTelemetry("WARN", "Chat turn finished without text or error event", { model }, telemetry);
    }
  } catch (err) {
    req.log?.error?.({ err, threadId }, "chat message stream failed");
    const errMsg = err instanceof Error ? err.message : "Chat failed";
    emitChatTelemetry("ERROR", `Chat stream failed: ${errMsg}`, { model }, telemetry);
    if (!res.writableEnded) {
      writeSse(res, "error", { message: errMsg });
    }
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) {
      emitChatTelemetry("INFO", "Chat SSE stream closed", { threadId, sawText, sawError }, telemetry);
    }
    res.end();
  }
}
