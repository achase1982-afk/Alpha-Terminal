import {
  CHAT_ACCEPTED_FILE_TYPES,
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MAX_COUNT,
  CHAT_ATTACHMENT_MAX_TEXT_CHARS,
  type ChatAttachmentInput,
} from "@workspace/chat-types";

export { CHAT_ACCEPTED_FILE_TYPES, type ChatAttachmentInput };

function randomId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not read file"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}

function isTextLike(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  const lower = file.name.toLowerCase();
  return /\.(txt|md|csv|json|html|xml)$/.test(lower);
}

export async function fileToChatAttachment(file: File): Promise<ChatAttachmentInput> {
  if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
    throw new Error(`${file.name} is too large (max ${CHAT_ATTACHMENT_MAX_BYTES / (1024 * 1024)}MB)`);
  }
  if (file.type.startsWith("image/") || /\.(jpe?g|png|gif|webp|heic)$/i.test(file.name)) {
    return {
      id: randomId(),
      name: file.name,
      mimeType: file.type || "image/jpeg",
      kind: "image",
      data: await readFileAsBase64(file),
    };
  }
  if (isTextLike(file)) {
    return {
      id: randomId(),
      name: file.name,
      mimeType: file.type || "text/plain",
      kind: "text",
      data: (await file.text()).slice(0, CHAT_ATTACHMENT_MAX_TEXT_CHARS),
    };
  }
  throw new Error(`${file.name}: use an image or text file (.txt, .md, .csv, .json)`);
}

export async function filesToChatAttachments(files: FileList | File[]): Promise<ChatAttachmentInput[]> {
  const out: ChatAttachmentInput[] = [];
  for (const file of Array.from(files).slice(0, CHAT_ATTACHMENT_MAX_COUNT)) {
    out.push(await fileToChatAttachment(file));
  }
  return out;
}

export function attachmentImageSrc(att: ChatAttachmentInput): string | null {
  if (att.kind !== "image") return null;
  return `data:${att.mimeType};base64,${att.data}`;
}
