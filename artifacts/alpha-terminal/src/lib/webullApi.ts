import { fetchWithAuth, humanizeFailedApiBody } from "./fetchWithAuth";

export type WebullHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface WebullEndpointRequest {
  method?: WebullHttpMethod;
  path: `/market-data/${string}` | `/trading/${string}`;
  query?: Record<string, string | number | boolean | Array<string | number | boolean> | null | undefined>;
  body?: unknown;
}

export interface WebullCapabilities {
  configured: boolean;
  connected: boolean;
  authentication: {
    tokenCreate: string;
    tokenStatus: string;
    tokenDelete: string;
  };
  invocation: {
    endpoint: string;
    methods: WebullHttpMethod[];
    namespaces: Array<{
      prefix: string;
      product: string;
      categories: string[];
    }>;
    accessTokenAppliedServerSide: boolean;
    appSecretExposed: false;
    additionalAccounts: string;
  };
}

export async function getWebullCapabilities(): Promise<WebullCapabilities> {
  const res = await fetchWithAuth("/api/webull/capabilities");
  const text = await res.text();
  if (!res.ok) throw new Error(humanizeFailedApiBody(res.status, text));
  return JSON.parse(text) as WebullCapabilities;
}

export async function invokeWebullEndpoint<T = unknown>(
  request: WebullEndpointRequest,
): Promise<T> {
  const res = await fetchWithAuth("/api/webull/invoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(humanizeFailedApiBody(res.status, text));
  return JSON.parse(text) as T;
}
