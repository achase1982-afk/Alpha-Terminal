import { stripLegacyEmptyAccessTokenQuery } from "@workspace/api-client-react";

/** Mirrors Clerk `getToken` options we care about (long strategist polls + 401 recovery). */
export type ClerkGetTokenOptions = { skipCache?: boolean };

type ClerkWindow = {
  Clerk?: { session?: { getToken: (opts?: ClerkGetTokenOptions) => Promise<string | null> } };
};

let clerkGetToken: ((opts?: ClerkGetTokenOptions) => Promise<string | null>) | null = null;

export function setClerkTokenGetter(fn: (opts?: ClerkGetTokenOptions) => Promise<string | null>) {
  clerkGetToken = fn;
}

/** Fresh Clerk session JWT — never from app store or URL query params. */
async function resolveClerkToken(opts?: ClerkGetTokenOptions): Promise<string | null> {
  if (typeof window !== "undefined") {
    const getToken = (window as ClerkWindow).Clerk?.session?.getToken;
    if (getToken) {
      try {
        return await getToken(opts);
      } catch {
        return null;
      }
    }
  }
  if (clerkGetToken) {
    try {
      return await clerkGetToken(opts);
    } catch {
      return null;
    }
  }
  return null;
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

  try {
    let token: string | null;
    if (clerkTokenTimeoutMs != null && clerkTokenTimeoutMs > 0) {
      token = await Promise.race([
        resolveClerkToken(tokenOpts),
        new Promise<null>((resolve) => {
          if (typeof window !== "undefined") {
            window.setTimeout(() => resolve(null), clerkTokenTimeoutMs);
          } else {
            resolve(null);
          }
        }),
      ]);
    } else {
      token = await resolveClerkToken(tokenOpts);
    }
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  } catch {}

  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const urlStr = typeof input === "string" ? input : input instanceof URL ? input.href : "request";

  try {
    const res = await fetch(input, { ...fetchInit, headers, redirect: "error" });
    if (
      res.status === 401 &&
      !_authRetry &&
      typeof window !== "undefined"
    ) {
      try {
        const fresh = await resolveClerkToken({ skipCache: true });
        if (fresh) {
          const headers2 = new Headers(fetchInit.headers);
          headers2.set("Authorization", `Bearer ${fresh}`);
          const res2 = await fetch(input, { ...fetchInit, headers: headers2, redirect: "error" });
          if (res2.status === 401) {
            throw new Error(`Unauthorized after token refresh (${urlStr})`);
          }
          return res2;
        }
      } catch (retryErr) {
        if (retryErr instanceof Error && retryErr.message.startsWith("Unauthorized after token refresh")) {
          throw retryErr;
        }
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
  return resolveClerkToken(opts);
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
    const j = JSON.parse(trimmed) as { error?: unknown; message?: unknown; hint?: unknown };
    const err = j.error != null ? String(j.error) : "";
    const msg = j.message != null ? String(j.message) : "";
    const hintRaw = j.hint != null ? String(j.hint) : "";
    if (/unauthorized|forbidden/i.test(err) || /unauthorized|forbidden/i.test(msg)) {
      return "Session expired — sign in again and retry.";
    }
    const pick = msg || err;
    if (pick) {
      let out = pick.length > MAX_ERROR_BODY_CHARS ? `${pick.slice(0, MAX_ERROR_BODY_CHARS - 1)}…` : pick;
      if (hintRaw) {
        const hint =
          hintRaw.length > 280 ? `${hintRaw.slice(0, 279)}…` : hintRaw;
        out = `${out}\n\n${hint}`;
      }
      return out;
    }
    if (hintRaw) {
      return hintRaw.length > MAX_ERROR_BODY_CHARS
        ? `${hintRaw.slice(0, MAX_ERROR_BODY_CHARS - 1)}…`
        : hintRaw;
    }
  } catch {
    /* not JSON */
  }
  return trimmed.length > MAX_ERROR_BODY_CHARS ? `${trimmed.slice(0, MAX_ERROR_BODY_CHARS - 1)}…` : trimmed;
}
