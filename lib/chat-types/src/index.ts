/** Persisted on chat_messages.attachments (jsonb). */
export type ChatAttachmentStored = {
  id: string;
  name: string;
  mimeType: string;
  kind: "image" | "text";
  /** Base64 payload for images; UTF-8 text for documents. */
  data: string;
};

/** Client → API in chat POST body. */
export type ChatAttachmentInput = ChatAttachmentStored;

export const CHAT_ATTACHMENT_MAX_COUNT = 4;
export const CHAT_ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024;
export const CHAT_ATTACHMENT_MAX_TEXT_CHARS = 50_000;

export const CHAT_ACCEPTED_FILE_TYPES =
  "image/*,.txt,.md,.csv,.json,.html,.xml,text/plain,text/csv,text/markdown,application/json";
