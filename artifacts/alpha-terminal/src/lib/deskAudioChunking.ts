/**
 * Client copy of the API server desk-audio chunking logic (indices must match buffered sessions).
 */

export const DESK_AUDIO_CHUNK_TARGET_CHARS = 220;
export const DESK_AUDIO_CHUNK_MAX_CHARS = 380;

function isWordChar(c: string): boolean {
  return /[\p{L}\p{N}_']/u.test(c);
}

function retreatToWordBoundary(s: string, maxIdx: number): number {
  let i = Math.min(maxIdx, s.length - 1);
  while (i > 0 && isWordChar(s[i]) && isWordChar(s[i - 1])) {
    i--;
  }
  return i;
}

function isBoundaryAfter(rest: string, idx: number): boolean {
  const ch = rest[idx];
  if (ch === "\n") return true;
  if (ch === "." || ch === "!" || ch === "?") {
    const next = rest[idx + 1];
    return next === undefined || /\s/.test(next);
  }
  if (ch === ";" || ch === ",") {
    const next = rest[idx + 1];
    return next === undefined || /\s/.test(next);
  }
  return false;
}

export function splitDeskAudioTextIntoChunks(fullText: string): string[] {
  const t = fullText.trim();
  if (!t) return [];

  const out: string[] = [];
  let rest = t;

  while (rest.length > 0) {
    if (rest.length <= DESK_AUDIO_CHUNK_MAX_CHARS) {
      out.push(rest);
      break;
    }

    const hardCap = Math.min(DESK_AUDIO_CHUNK_MAX_CHARS, rest.length);
    const searchFrom = Math.max(1, Math.floor(hardCap * 0.45));
    const searchTo = hardCap - 1;

    let cut = -1;
    for (let i = searchTo; i >= searchFrom; i--) {
      if (rest[i] === "." || rest[i] === "!" || rest[i] === "?" || rest[i] === "\n") {
        if (isBoundaryAfter(rest, i)) {
          cut = i + 1;
          break;
        }
      }
    }

    if (cut < 0) {
      for (let i = searchTo; i >= searchFrom; i--) {
        if (rest[i] === ";" || rest[i] === ",") {
          if (isBoundaryAfter(rest, i)) {
            cut = i + 1;
            break;
          }
        }
      }
    }

    if (cut < 0) {
      const rb = retreatToWordBoundary(rest, hardCap - 1);
      cut = rb > 0 ? rb : hardCap;
    }

    const piece = rest.slice(0, cut).trimEnd();
    if (!piece) {
      rest = rest.slice(Math.max(1, cut)).trimStart();
      if (!rest.length) break;
      continue;
    }
    out.push(piece);
    rest = rest.slice(cut).trimStart();
  }

  return out.filter(Boolean);
}
