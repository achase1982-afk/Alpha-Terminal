import {
  and,
  asc,
  db,
  desc,
  eq,
  chatMessagesTable,
  chatThreadsTable,
  type ChatMessageRow,
  type ChatThreadRow,
} from "@workspace/db";

export const CHAT_SUMMARY_TOKEN_THRESHOLD = 80_000;

export function estimateTokenCount(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return Math.max(1, Math.ceil(t.length / 4));
}

export async function createChatThread(args: {
  userId: string;
  symbol?: string | null;
  title?: string;
}): Promise<ChatThreadRow> {
  const now = new Date();
  const [row] = await db
    .insert(chatThreadsTable)
    .values({
      userId: args.userId,
      symbol: args.symbol?.trim().toUpperCase() || null,
      title: args.title?.trim() || "Chat",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row!;
}

export async function getChatThreadForUser(
  userId: string,
  threadId: string,
): Promise<ChatThreadRow | null> {
  const [row] = await db
    .select()
    .from(chatThreadsTable)
    .where(and(eq(chatThreadsTable.id, threadId), eq(chatThreadsTable.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function listChatThreadsForUser(
  userId: string,
  symbol?: string | null,
): Promise<ChatThreadRow[]> {
  const sym = symbol?.trim().toUpperCase();
  const where = sym
    ? and(eq(chatThreadsTable.userId, userId), eq(chatThreadsTable.symbol, sym))
    : eq(chatThreadsTable.userId, userId);
  return db
    .select()
    .from(chatThreadsTable)
    .where(where)
    .orderBy(desc(chatThreadsTable.updatedAt))
    .limit(50);
}

export async function touchChatThread(threadId: string): Promise<void> {
  await db
    .update(chatThreadsTable)
    .set({ updatedAt: new Date() })
    .where(eq(chatThreadsTable.id, threadId));
}

export async function updateChatThreadSummary(threadId: string, summary: string): Promise<void> {
  await db
    .update(chatThreadsTable)
    .set({ summary, updatedAt: new Date() })
    .where(eq(chatThreadsTable.id, threadId));
}

export async function listChatMessages(threadId: string): Promise<ChatMessageRow[]> {
  return db
    .select()
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.threadId, threadId))
    .orderBy(asc(chatMessagesTable.createdAt));
}

export async function sumThreadTokenCount(threadId: string): Promise<number> {
  const rows = await db
    .select({ tokenCount: chatMessagesTable.tokenCount })
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.threadId, threadId));
  return rows.reduce((a, r) => a + (r.tokenCount ?? 0), 0);
}

export async function insertChatMessage(args: {
  threadId: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: unknown;
  toolResults?: unknown;
  tokenCount?: number;
}): Promise<ChatMessageRow> {
  const tokenCount =
    args.tokenCount ??
    estimateTokenCount(args.content) +
      estimateTokenCount(JSON.stringify(args.toolCalls ?? "")) +
      estimateTokenCount(JSON.stringify(args.toolResults ?? ""));
  const [row] = await db
    .insert(chatMessagesTable)
    .values({
      threadId: args.threadId,
      role: args.role,
      content: args.content,
      toolCalls: args.toolCalls ?? null,
      toolResults: args.toolResults ?? null,
      tokenCount,
    })
    .returning();
  await touchChatThread(args.threadId);
  return row!;
}
