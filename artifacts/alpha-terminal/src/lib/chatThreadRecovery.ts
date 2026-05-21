export type ChatThreadMessageRow = {
  id: string;
  role: string;
  content: string;
};

/** WebKit / mobile backgrounding often surfaces these instead of AbortError. */
export function isTransientChatNetworkError(err: unknown): boolean {
  const name = (err as Error)?.name ?? "";
  const msg = (err as Error)?.message ?? "";
  if (name === "AbortError") return false;
  return /load failed|failed to fetch|networkerror|network error|the network connection was lost/i.test(
    msg,
  );
}

/**
 * After a soft disconnect, find the persisted assistant reply for the user turn we just sent.
 */
export function findAssistantReplyForUserTurn(
  messages: ChatThreadMessageRow[],
  userText: string,
): { id: string; content: string } | null {
  const trimmedUser = userText.trim();
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const row = messages[i]!;
    if (row.role === "user" && row.content.trim() === trimmedUser) {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx < 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === "user") {
        lastUserIdx = i;
        break;
      }
    }
  }
  if (lastUserIdx < 0) return null;

  for (let i = lastUserIdx + 1; i < messages.length; i++) {
    const row = messages[i]!;
    if (row.role !== "assistant") continue;
    const content = row.content.trim();
    if (!content) continue;
    if (content === "(No response generated)") continue;
    if (content.startsWith("**Error:**")) continue;
    return { id: row.id, content: row.content };
  }
  return null;
}
