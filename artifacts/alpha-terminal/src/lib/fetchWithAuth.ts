let clerkGetToken: (() => Promise<string | null>) | null = null;

export function setClerkTokenGetter(fn: () => Promise<string | null>) {
  clerkGetToken = fn;
}

export async function fetchWithAuth(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);

  if (clerkGetToken) {
    try {
      const token = await clerkGetToken();
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }
    } catch {}
  }

  return fetch(input, { ...init, headers, redirect: "error" }).catch((err) => {
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
