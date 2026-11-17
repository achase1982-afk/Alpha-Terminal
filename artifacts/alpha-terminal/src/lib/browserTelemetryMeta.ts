const sessionRequestId =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `sess-${Date.now()}`;

function readBuildSha(): string | undefined {
  try {
    const env = (import.meta as { env?: Record<string, string | undefined> }).env;
    return (
      env?.VITE_RAILWAY_GIT_COMMIT_SHA ??
      env?.VITE_GIT_COMMIT_SHA ??
      env?.RAILWAY_GIT_COMMIT_SHA ??
      undefined
    );
  } catch {
    return undefined;
  }
}

const buildSha = readBuildSha();

export function browserTelemetryBaseDetails(): Record<string, unknown> {
  const out: Record<string, unknown> = { requestId: sessionRequestId };
  if (buildSha) out.buildSha = buildSha;
  return out;
}