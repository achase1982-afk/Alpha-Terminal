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

  return fetch(input, { ...rest, headers, redirect: "error" }).catch((err) => {
    if (err instanceof TypeError && /redirect|pattern|opaque/i.test(err.message)) {
      return new Response(JSON.stringify({ error: "Session expired" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw err;
  });
}

export async function getClerkToken(): Promise<string | null> {
  if (!clerkGetToken) return null;
  try {
    return await clerkGetToken();
  } catch {
    return null;
  }
}
