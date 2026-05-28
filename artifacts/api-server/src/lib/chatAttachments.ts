import type {
  ChatAttachmentInput,
  ChatAttachmentStored,
} from "@workspace/chat-types";
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MAX_COUNT,
  CHAT_ATTACHMENT_MAX_TEXT_CHARS,
} from "@workspace/chat-types";

export type { ChatAttachmentInput, ChatAttachmentStored };

export function sanitizeChatAttachments(raw: unknown): ChatAttachmentStored[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out: ChatAttachmentStored[] = [];
  for (const item of raw.slice(0, CHAT_ATTACHMENT_MAX_COUNT)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const name = typeof o.name === "string" ? o.name.trim().slice(0, 256) : "file";
    const mimeType = typeof o.mimeType === "string" ? o.mimeType.trim().slice(0, 128) : "";
    const kind = o.kind === "image" || o.kind === "text" ? o.kind : null;
    const data = typeof o.data === "string" ? o.data : "";
    if (!id || !kind || !data) continue;
    if (kind === "text") {
      out.push({
        id,
        name,
        mimeType: mimeType || "text/plain",
        kind: "text",
        data: data.slice(0, CHAT_ATTACHMENT_MAX_TEXT_CHARS),
      });
      continue;
    }
    if (!mimeType.startsWith("image/")) continue;
    const approxBytes = Math.ceil((data.length * 3) / 4);
    if (approxBytes > CHAT_ATTACHMENT_MAX_BYTES) continue;
    out.push({ id, name, mimeType, kind: "image", data });
  }
  return out;
}

type UserContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: string };

export function buildUserModelContent(
  text: string,
  attachments: ChatAttachmentStored[],
): string | UserContentPart[] {
  const trimmed = text.trim();
  const parts: UserContentPart[] = [];
  if (trimmed) parts.push({ type: "text", text: trimmed });
  for (const att of attachments) {
    if (att.kind === "image") {
      parts.push({ type: "image", image: `data:${att.mimeType};base64,${att.data}` });
    } else {
      parts.push({
        type: "text",
        text: `\n\n[Attached file: ${att.name}]\n${att.data}`,
      });
    }
  }
  if (parts.length === 0) return trimmed;
  if (parts.length === 1 && parts[0]!.type === "text") return parts[0]!.text;
  return parts;
}

export function attachmentSummaryForTitle(attachments: ChatAttachmentStored[]): string {
  if (attachments.length === 0) return "";
  return attachments.length === 1 ? `[${attachments[0]!.name}]` : `[${attachments.length} files]`;
}
