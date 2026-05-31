import { enforceCardBullets } from "@workspace/strategist-card-bullets";

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function sanitizeBullet(s: string): string {
  return s
    .replace(/<cite\s[^>]*\/>/gi, "")
    .replace(/<cite\s[^>]*>([\s\S]*?)<\/cite>/gi, "$1")
    .replace(/<\/?cite[^>]*>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseBulletArrayFromAi(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map(sanitizeBullet)
    .filter((s) => s.length > 0);
}

/** Parse a bullet-only JSON patch from a follow-up model call. */
export function parseCardBulletPatch(
  rawText: string,
): { whyBullets: string[]; whatKillsBullets: string[] } | null {
  try {
    const parsed = JSON.parse(extractJson(rawText)) as Record<string, unknown>;
    const whyBullets = enforceCardBullets(
      parseBulletArrayFromAi(parsed.whyBullets ?? parsed.why_it_works ?? parsed.whyItWorks),
      undefined,
      "why",
    );
    const whatKillsBullets = enforceCardBullets(
      parseBulletArrayFromAi(
        parsed.whatKillsBullets ?? parsed.what_kills_it ?? parsed.whatKillsIt,
      ),
      undefined,
      "kill",
    );
    if (whyBullets.length === 0 && whatKillsBullets.length === 0) return null;
    return { whyBullets, whatKillsBullets };
  } catch {
    return null;
  }
}
