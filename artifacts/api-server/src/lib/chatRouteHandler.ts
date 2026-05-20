import type { Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { getBestAccessToken } from "./tokenStore.js";
import {
  createChatThread,
  getChatThreadForUser,
} from "./chatDb.js";
import { runChatTurn, runMultiAgentChatTurn, type ChatStreamEvent } from "./chatOrchestrator.js";
import { isGrokModel, XAI_CHAT_TOOLS_NOTE } from "./chatModel.js";

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
 * SSE events: thread, text, tool_call_start, tool_call_end, done, error
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
    model?: string;
    symbol?: string;
    multi_agent?: {
      models?: string[];
      synthesizer_model?: string;
    };
  };

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    res.status(400).json({ error: "message is required." });
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
  const model = (useMultiAgent ? synthesizerModel : (body.model ?? "claude-opus-4-7")).trim();

  let threadId = typeof body.thread_id === "string" ? body.thread_id.trim() : "";
  let thread = threadId ? await getChatThreadForUser(userId, threadId) : null;

  if (!thread) {
    thread = await createChatThread({
      userId,
      symbol: ambientSymbol,
      title: message.slice(0, 48) || "Chat",
    });
    threadId = thread.id;
  }

  const schwabAccessToken = getBestAccessToken();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  writeSse(res, "thread", { thread_id: threadId });

  if (isGrokModel(model)) {
    writeSse(res, "status", { note: XAI_CHAT_TOOLS_NOTE });
  }
  if (useMultiAgent) {
    writeSse(res, "status", {
      phase: "multi_agent_drafting",
      model_count: multiAgentModels.length,
      synthesizer_model: synthesizerModel,
    });
  }

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": ping\n\n");
  }, 15_000);

  const turnArgs = {
    thread,
    userMessage: message,
    model,
    ambientSymbol,
    toolContext: { userId, schwabAccessToken, activeModel: model },
    onEvent: (ev: ChatStreamEvent) => {
        if (res.writableEnded) return;
        switch (ev.type) {
          case "text":
            writeSse(res, "text", { delta: ev.delta });
            break;
          case "tool_call_start":
            writeSse(res, "tool_call_start", {
              toolCallId: ev.toolCallId,
              toolName: ev.toolName,
              input: ev.input,
            });
            break;
          case "tool_call_end":
            writeSse(res, "tool_call_end", {
              toolCallId: ev.toolCallId,
              toolName: ev.toolName,
              output: ev.output,
            });
            break;
          case "done":
            writeSse(res, "done", {
              thread_id: ev.threadId,
              assistant_message_id: ev.assistantMessageId,
            });
            break;
          case "error":
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
  } catch (err) {
    req.log?.error?.({ err, threadId }, "chat message stream failed");
    if (!res.writableEnded) {
      writeSse(res, "error", {
        message: err instanceof Error ? err.message : "Chat failed",
      });
    }
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
}
