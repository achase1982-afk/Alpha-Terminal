/** How long a per-symbol active chat thread selection remains restorable after last use. */
export const ACTIVE_CHAT_THREAD_PERSIST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type ActiveChatThreadRef = {
  threadId: string;
  updatedAt: number;
};

type ThreadListItem = { id: string; updatedAt: string };

/**
 * Pick the thread to activate after refresh: persisted (if valid and within TTL),
 * else the most recently updated server thread, else none.
 */
export function resolveActiveChatThreadId(
  threads: ThreadListItem[],
  persisted: ActiveChatThreadRef | undefined,
  now = Date.now(),
): string | null {
  if (threads.length === 0) return null;

  if (
    persisted &&
    now - persisted.updatedAt <= ACTIVE_CHAT_THREAD_PERSIST_TTL_MS &&
    threads.some((t) => t.id === persisted.threadId)
  ) {
    return persisted.threadId;
  }

  const sorted = [...threads].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  return sorted[0]!.id;
}
