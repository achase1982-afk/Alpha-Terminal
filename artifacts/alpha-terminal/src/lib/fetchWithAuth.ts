let _getToken: (() => Promise<string | null>) | null = null;

export function setClerkTokenGetter(fn: () => Promise<string | null>) {
  _getToken = fn;
  (globalThis as any).__clerkTokenGetter = fn;
}

export async function fetchWithAuth(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);

  const getter = _getToken || (globalThis as any).__clerkTokenGetter;
  if (getter) {
    try {
      const token = await getter();
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      } else {
        console.warn("[fetchWithAuth] Clerk token is null — request may get 401");
      }
    } catch (err) {
      console.error("[fetchWithAuth] Failed to get Clerk token:", err);
    }
  } else {
    console.warn("[fetchWithAuth] No token getter registered — request will be unauthenticated");
  }

  return fetch(input, { ...init, headers });
}
