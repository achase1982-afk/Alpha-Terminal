import type { DeskResult } from "@/lib/strategistDeskResult";

/** Stable id for TTS cache partitioning (hash of serialized desk payload). */
export function deskResultAudioId(deskResult: DeskResult, bannerTitle?: string, bannerBody?: string): string {
  const payload = JSON.stringify({
    ticker: deskResult.ticker,
    mode: deskResult.mode,
    ...(deskResult.mode === "conviction_desk"
      ? {
          conviction: deskResult.conviction,
          errors: deskResult.errors,
        }
      : {
          pm: deskResult.pm,
          vol: deskResult.vol,
          flow: deskResult.flow,
          catalyst: deskResult.catalyst,
          errors: deskResult.errors,
        }),
    bannerTitle: bannerTitle ?? null,
    bannerBody: bannerBody ?? null,
  });
  let h = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `desk-${(h >>> 0).toString(16)}`;
}
