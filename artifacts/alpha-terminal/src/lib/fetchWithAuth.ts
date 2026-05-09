import { signalClerkAuthLost } from "./authNoticeStore";

/** Mirrors Clerk `getToken` options we care about (long strategist polls + 401 recovery). */
export type ClerkGetTokenOptions = { skipCache?: boolean };

let clerkGetToken: ((opts?: ClerkGetTokenOptions) => Promise<string | null>) | null = null;

export function setClerkTokenGetter(fn: (opts?: ClerkGetTokenOptions) => Promise<string | null>) {
  clerkGetToken = fn;
}

type FetchWithAuthInit = RequestInit & {
  /** If set, do not wait longer than this for Clerk session token (avoids hung UI). */
  clerkTokenTimeoutMs?: number;
  /** Bypass Clerk JWT cache for this request (rare; paired with 401 retry logic). */
  clerkSkipCache?: boolean;
  /** @internal prevents infinite 401 retry loops */
  _authRetry?: boolean;
};

export async function fetchWithAuth(
  input: RequestInfo | URL,
  init?: FetchWithAuthInit,
): Promise<Response> {
  const {
    clerkTokenTimeoutMs,
    clerkSkipCache,
    _authRetry,
    ...fetchInit
  } = init ?? {};
  const headers = new Headers(fetchInit.headers);
  const tokenOpts: ClerkGetTokenOptions | undefined = clerkSkipCache === true ? { skipCache: true } : undefined;

  if (clerkGetToken) {
    try {
      let token: string | null;
      if (clerkTokenTimeoutMs != null && clerkTokenTimeoutMs > 0) {
        token = await Promise.race([
          clerkGetToken(tokenOpts),
          new Promise<null>((resolve) => {
            if (typeof window !== "undefined") {
              window.setTimeout(() => resolve(null), clerkTokenTimeoutMs);
            } else {
              resolve(null);
            }
          }),
        ]);
      } else {
        token = await clerkGetToken(tokenOpts);
      }
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }
    } catch {}
  }

  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const urlStr = typeof input === "string" ? input : input instanceof URL ? input.href : "request";

  try {
    const res = await fetch(input, { ...fetchInit, headers, redirect: "error" });
    if (
      (res.status === 401 || res.status === 403) &&
      clerkGetToken &&
      !_authRetry &&
      typeof window !== "undefined"
    ) {
      try {
        const fresh = await clerkGetToken({ skipCache: true });
        if (fresh) {
          const headers2 = new Headers(fetchInit.headers);
          headers2.set("Authorization", `Bearer ${fresh}`);
          const res2 = await fetch(input, { ...fetchInit, headers: headers2, redirect: "error" });
          if (res2.status === 401 || res2.status === 403) {
            signalClerkAuthLost(
              "The server rejected your account session.",
              "Try Reload app below, or sign out and sign in again. After a deployment, reloading usually fixes stale auth.",
            );
          }
          return res2;
        }
        signalClerkAuthLost(
          "No active account session token.",
          "Sign in again, or reload the app if you just updated.",
        );
      } catch {
        /* return first 401 */
      }
    }
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

export async function getClerkToken(opts?: ClerkGetTokenOptions): Promise<string | null> {
  if (!clerkGetToken) return null;
  try {
    return await clerkGetToken(opts);
  } catch {
    return null;
  }
}

const MAX_ERROR_BODY_CHARS = 500;

/**
 * Turns raw `fetch` error bodies into short UI strings. Maps 401 / JSON
 * `{ "error": "Unauthorized" }` to a session hint so operators do not confuse
 * auth failures with model token limits or timeouts.
 */
export function humanizeFailedApiBody(status: number, bodyText: string): string {
  if (status === 401 || status === 403) {
    return "Session expired — sign in again and retry.";
  }
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return `Request failed (HTTP ${status})`;
  }
  try {
    const j = JSON.parse(trimmed) as { error?: unknown; message?: unknown };
    const err = j.error != null ? String(j.error) : "";
    const msg = j.message != null ? String(j.message) : "";
    if (/unauthorized|forbidden/i.test(err) || /unauthorized|forbidden/i.test(msg)) {
      return "Session expired — sign in again and retry.";
    }
    const pick = msg || err;
    if (pick) {
      return pick.length > MAX_ERROR_BODY_CHARS ? `${pick.slice(0, MAX_ERROR_BODY_CHARS - 1)}…` : pick;
    }
  } catch {
    /* not JSON */
  }
  return trimmed.length > MAX_ERROR_BODY_CHARS ? `${trimmed.slice(0, MAX_ERROR_BODY_CHARS - 1)}…` : trimmed;
}
