import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, FileText, X } from "lucide-react";
import type { ChatAttachmentInput } from "@workspace/chat-types";
import { attachmentImageSrc } from "@/lib/chatAttachments";
import { useLongPressActionMenu } from "@/hooks/useLongPressActionMenu";

export function ChatUserMessage({
  content,
  attachments = [],
  onEditConfirm,
}: {
  content: string;
  attachments?: ChatAttachmentInput[];
  onEditConfirm: (nextText: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(content);
  }, [content, editing]);

  useEffect(() => {
    if (!editing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const startEdit = useCallback(() => {
    setDraft(content);
    setEditing(true);
  }, [content]);

  const copyText = useCallback(() => {
    const parts = [content.trim()];
    for (const att of attachments) {
      if (att.kind === "text") {
        parts.push(`\n[${att.name}]\n${att.data}`);
      } else {
        parts.push(`\n[${att.name}]`);
      }
    }
    void navigator.clipboard?.writeText(parts.filter(Boolean).join("\n"));
  }, [attachments, content]);

  const { bind, menu } = useLongPressActionMenu(
    useMemo(
      () => [
        { id: "copy", label: "Copy", onSelect: copyText },
        { id: "edit", label: "Edit", onSelect: startEdit },
      ],
      [copyText, startEdit],
    ),
  );

  const confirmEdit = () => {
    const next = draft.trim();
    if (!next && attachments.length === 0) return;
    setEditing(false);
    onEditConfirm(next);
  };

  if (editing) {
    return (
      <div className="inline-block max-w-[95%] text-left">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          className="w-full min-w-[200px] resize-none bg-[#111] border border-white/30 rounded-md px-3 py-2 font-mono text-[14px] text-white outline-none"
        />
        {attachments.length > 0 && (
          <p className="mt-1 font-mono text-[11px] text-white/55">
            Attachments stay as originally sent. Send a new message to change files.
          </p>
        )}
        <div className="flex justify-end gap-2 mt-2">
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="p-2 rounded border border-card-border text-white/70"
            aria-label="Cancel edit"
          >
            <X className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={confirmEdit}
            className="p-2 rounded border border-emerald-500/50 text-emerald-300"
            aria-label="Save and restart"
          >
            <Check className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {menu}
      <span
        {...bind()}
        className="inline-block font-mono text-[14px] text-[#f5f5f5] bg-[#1a1a1a] border border-card-border rounded px-3 py-2 max-w-[95%] text-left touch-manipulation select-text"
      >
        {content ? <span className="whitespace-pre-wrap">{content}</span> : null}
        {attachments.length > 0 && (
          <div className={content ? "mt-2 space-y-2" : "space-y-2"}>
            {attachments.map((att) => (
              <AttachmentPreview key={att.id} att={att} />
            ))}
          </div>
        )}
      </span>
    </>
  );
}

function AttachmentPreview({ att }: { att: ChatAttachmentInput }) {
  const src = attachmentImageSrc(att);
  if (src) {
    return (
      <img
        src={src}
        alt={att.name}
        className="max-h-40 max-w-full rounded border border-white/15 object-contain"
      />
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-white/75 bg-black/40 border border-white/10 rounded px-2 py-1">
      <FileText className="w-3.5 h-3.5 shrink-0" />
      {att.name}
    </span>
  );
}
