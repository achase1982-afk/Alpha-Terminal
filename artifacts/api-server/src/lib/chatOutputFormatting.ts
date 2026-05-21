/** Em dash (U+2014) and en dash (U+2013). */
const EM_DASH = "\u2014";
const EN_DASH = "\u2013";

/** Strip pictographic symbols used as bullets, headers, or status markers. */
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

/** Line is only horizontal-rule dashes (optional surrounding whitespace). */
const DASH_ONLY_LINE_RE = /^\s*-+\s*$/;

const FENCE_LINE_RE = /^(`{3,}|~{3,})/;

const MIN_LOOKAHEAD = 2;

function isDashOnlyLine(line: string): boolean {
  return DASH_ONLY_LINE_RE.test(line);
}

function toggleCodeFence(line: string, inFence: boolean): boolean {
  const trimmed = line.trimStart();
  if (FENCE_LINE_RE.test(trimmed)) return !inFence;
  return inFence;
}

/** Inline transforms for a single line outside fenced code blocks. */
export function transformChatOutputLine(line: string): string {
  let out = line.replace(EMOJI_RE, "");
  out = out.replace(/\s*\u2014\s*/g, ", ");
  out = out.replace(/\u2013/g, "-");
  return out;
}

function processLine(line: string, inCodeFence: boolean): { text: string; inCodeFence: boolean } {
  const nextFence = toggleCodeFence(line, inCodeFence);
  if (inCodeFence) {
    return { text: line, inCodeFence: nextFence };
  }
  if (nextFence !== inCodeFence) {
    return { text: line, inCodeFence: nextFence };
  }
  if (isDashOnlyLine(line)) {
    return { text: "", inCodeFence: nextFence };
  }
  return { text: transformChatOutputLine(line), inCodeFence: nextFence };
}

/**
 * When a chunk has no newline, hold a trailing run of 1–2 dashes so "---" dividers
 * split across chunks are not emitted early.
 */
function peelTrailingDashHoldback(text: string): { emit: string; hold: string } {
  const m = text.match(/(-+)$/);
  if (!m) return { emit: text, hold: "" };
  const dashes = m[1]!;
  const prefix = text.slice(0, -dashes.length);
  if (dashes.length >= 3 && prefix.trim() === "") {
    return { emit: "", hold: text };
  }
  if (dashes.length >= 1 && dashes.length < MIN_LOOKAHEAD + 1) {
    return { emit: prefix, hold: dashes };
  }
  return { emit: text, hold: "" };
}

function flushDashHoldback(hold: string, inCodeFence: boolean): string {
  if (!hold) return "";
  if (inCodeFence) return hold;
  if (isDashOnlyLine(hold)) return "";
  return transformChatOutputLine(hold);
}

/**
 * Deterministic, streaming-safe scrub of AI-tell formatting in chat assistant text.
 * Applied between model text deltas and SSE emit.
 */
export function createChatOutputFormattingStream() {
  let incompleteLine = "";
  let inCodeFence = false;
  let carry = "";

  function emitCompleteLine(line: string): string {
    const processed = processLine(line, inCodeFence);
    inCodeFence = processed.inCodeFence;
    return processed.text;
  }

  function push(chunk: string): string {
    if (!chunk) return "";
    let input = carry + chunk;
    carry = "";
    let out = "";

    if (!input.includes("\n") && !input.includes("\r")) {
      const pending = incompleteLine + input;
      if (isDashOnlyLine(pending)) {
        incompleteLine = pending;
        return "";
      }
      const { emit, hold } = peelTrailingDashHoldback(pending);
      incompleteLine = "";
      carry = hold;
      if (emit) out += emitCompleteLine(emit);
      return out;
    }

    const normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    let work = incompleteLine + normalized;
    incompleteLine = "";
    const parts = work.split("\n");
    incompleteLine = parts.pop() ?? "";

    for (const line of parts) {
      out += emitCompleteLine(line);
      out += "\n";
    }
    return out;
  }

  function flush(): string {
    let out = "";
    const pending = carry + incompleteLine;
    carry = "";
    incompleteLine = "";
    if (pending.length > 0) {
      out += flushDashHoldback(pending, inCodeFence);
    }
    return out;
  }

  return { push, flush };
}

/** Format a complete string (e.g. persisted assistant message or synthesis blob). */
export function formatChatOutputText(text: string): string {
  const stream = createChatOutputFormattingStream();
  const syntheticTrailingNewline = !text.endsWith("\n");
  const pushed = stream.push(syntheticTrailingNewline ? `${text}\n` : text);
  let out = pushed + stream.flush();
  if (syntheticTrailingNewline && out.endsWith("\n")) {
    out = out.slice(0, -1);
  }
  return out;
}
