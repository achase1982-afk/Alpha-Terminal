/** OAuth-style JSON error bodies: keep status + error fields only (no raw body). */
export function minimalOAuthStyleErrorFields(
  text: string,
  httpStatus: number,
): Record<string, unknown> {
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const out: Record<string, unknown> = { status: httpStatus };
    if (typeof data.error === "string") out.error = data.error;
    if (typeof data.error_description === "string") out.error_description = data.error_description;
    if (typeof data.message === "string" && !("error" in out)) out.error = data.message;
    return out;
  } catch {
    return { status: httpStatus };
  }
}