let clerkGetToken: (() => Promise<string | null>) | null = null;

export function setClerkTokenGetter(fn: () => Promise<string | null>) {
  clerkGetToken = fn;
}

type FetchWithAuthInit = RequestInit & {
  /** If set, do not wait longer than this for Clerk session token (avoids hung UI). */
  clerkTokenTimeoutMs?: number;
};

export async function fetchWithAuth(
  input: RequestInfo | URL,
  init?: FetchWithAuthInit,
): Promise<Response> {
  const { clerkTokenTimeoutMs, ...rest } = init ?? {};
  const headers = new Headers(rest.headers);

  if (clerkGetToken) {
    try {
      let token: string | null;
      if (clerkTokenTimeoutMs != null && clerkTokenTimeoutMs > 0) {
        token = await Promise.race([
          clerkGetToken(),
          new Promise<null>((resolve) => {
            if (typeof window !== "undefined") {
              window.setTimeout(() => resolve(null), clerkTokenTimeoutMs);
            } else {
              resolve(null);
            }
          }),
        ]);
      } else {
        token = await clerkGetToken();
      }
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }
    } catch {}
  }

  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const urlStr = typeof input === "string" ? input : input instanceof URL ? input.href : "request";

  try {
    const res = await fetch(input, { ...rest, headers, redirect: "error" });
    return res;
  } catch (err) {
    const elapsedMs =
      typeof performance !== "undefined"
        ? Math.round(performance.now() - startedAt)
        : Math.round(Date.now() - startedAt);

    if (typeof window !== "undefined" && err instanceof TypeError) {
      const msg = err.message ?? String(err);
      const isFetchDiag =
        /redirect|pattern|opaque|failed to fetch|networkerror|load failed|aborted/i.test(msg);
      if (isFetchDiag) {
        console.groupCollapsed(`[fetchWithAuth] request failed (${elapsedMs}ms) — ${urlStr}`);
        console.info("error:", msg);
        console.info("elapsedMs:", elapsedMs);
        console.info("note: Response unavailable after fetch throws; if the failure is mid-read, check Network tab for status and timing.");
        console.groupEnd();
      }
    }

    if (err instanceof TypeError && /redirect|pattern|opaque/i.test(err.message)) {
      return new Response(JSON.stringify({ error: "Session expired" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw err;
  }
}

export async function getClerkToken(): Promise<string | null> {
  if (!clerkGetToken) return null;
  try {
    return await clerkGetToken();
  } catch {
    return null;
  }
}
