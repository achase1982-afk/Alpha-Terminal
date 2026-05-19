import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { getChatThreadForUser, listChatMessages, listChatThreadsForUser } from "../lib/chatDb.js";
import { handleChatMessageSse } from "../lib/chatRouteHandler.js";

const router: IRouter = Router();

const DEV_USER_ID = "dev-bypass-user";

function getUserId(req: Request): string | null {
  if (process.env.DEV_BYPASS_AUTH === "true") return DEV_USER_ID;
  return getAuth(req).userId ?? null;
}

router.get("/threads", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const symbol = typeof req.query.symbol === "string" ? req.query.symbol : undefined;
  const threads = await listChatThreadsForUser(userId, symbol);
  return res.json({
    threads: threads.map((t) => ({
      id: t.id,
      symbol: t.symbol,
      title: t.title,
      summary: t.summary,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
  });
});

router.get("/threads/:threadId/messages", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const threadId = String(req.params.threadId ?? "").trim();
  const thread = await getChatThreadForUser(userId, threadId);
  if (!thread) {
    return res.status(404).json({ error: "Thread not found" });
  }
  const messages = await listChatMessages(threadId);
  return res.json({
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls,
      toolResults: m.toolResults,
      createdAt: m.createdAt,
    })),
  });
});

router.post("/message", (req, res) => handleChatMessageSse(req, res));

export default router;
