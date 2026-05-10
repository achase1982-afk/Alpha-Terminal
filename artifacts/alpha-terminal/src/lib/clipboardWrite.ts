/**
 * Clipboard writes for environments where programmatic copy is flaky (mobile Safari,
 * embedded WebViews, HTTP dev servers). Tries execCommand (sync) → Clipboard API → ClipboardItem,
 * then callers may show a manual textarea fallback.
 */

export type ClipboardWriteMethod = "clipboard-api" | "exec-command" | "clipboard-item";

export type ClipboardWriteOk = { ok: true; method: ClipboardWriteMethod };
export type ClipboardWriteFail = { ok: false };

export type ClipboardWriteResult = ClipboardWriteOk | ClipboardWriteFail;

/** Sync legacy copy — same stack as click handler; keep textarea on-screen but tiny/transparent. */
function copyViaExecCommand(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "0";
    ta.style.top = "0";
    ta.style.width = "2px";
    ta.style.height = "2px";
    ta.style.padding = "0";
    ta.style.margin = "0";
    ta.style.border = "none";
    ta.style.outline = "none";
    ta.style.opacity = "0";
    ta.style.zIndex = "-1";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Best-effort programmatic copy. Does not throw.
 * Prefer awaiting this from a click handler for highest success rate on iOS.
 */
export async function writeTextToClipboard(text: string): Promise<ClipboardWriteResult> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { ok: false };
  }

  /** Prefer synchronous execCommand first — survives mobile Safari click/tap gestures better than async APIs. */
  if (copyViaExecCommand(text)) {
    return { ok: true, method: "exec-command" };
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true, method: "clipboard-api" };
    } catch {
      /* fall through */
    }
  }

  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": blob,
        }),
      ]);
      return { ok: true, method: "clipboard-item" };
    } catch {
      /* fall through */
    }
  }

  return { ok: false };
}
