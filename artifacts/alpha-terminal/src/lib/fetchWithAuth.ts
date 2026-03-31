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

  return fetch(input, { ...init, headers });
}

export async function getClerkToken(): Promise<string | null> {
  if (!clerkGetToken) return null;
  try {
    return await clerkGetToken();
  } catch {
    return null;
  }
}
