let _getToken: (() => Promise<string | null>) | null = null;

export function setClerkTokenGetter(fn: () => Promise<string | null>) {
  _getToken = fn;
}

export async function fetchWithAuth(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);

  if (_getToken) {
    try {
      const token = await _getToken();
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }
    } catch {}
  }

  return fetch(input, { ...init, headers });
}
