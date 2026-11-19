import crypto from "node:crypto";

const WEBULL_HOST = "api.webull.com";

export function webullApiHost(): string {
  return WEBULL_HOST;
}

export function webullSignRequest(params: {
  method: string;
  path: string;
  query?: Record<string, string>;
  bodyString?: string | null;
  appKey: string;
  appSecret: string;
  timestamp: string;
  nonce: string;
}): string {
  const signingHeaders: Record<string, string> = {
    "x-app-key": params.appKey,
    "x-timestamp": params.timestamp,
    "x-signature-algorithm": "HMAC-SHA1",
    "x-signature-version": "1.0",
    "x-signature-nonce": params.nonce,
    host: WEBULL_HOST,
  };
  const allParams: Record<string, string> = { ...params.query, ...signingHeaders };
  const str1 = Object.keys(allParams)
    .sort()
    .map((k) => `${k}=${allParams[k]}`)
    .join("&");

  let str3: string;
  if (params.bodyString) {
    const str2 = crypto.createHash("md5").update(params.bodyString, "utf8").digest("hex").toUpperCase();
    str3 = `${params.path}&${str1}&${str2}`;
  } else {
    str3 = `${params.path}&${str1}`;
  }

  const encoded = encodeURIComponent(str3);
  const signingKey = `${params.appSecret}&`;
  return crypto.createHmac("sha1", signingKey).update(encoded, "utf8").digest("base64");
}

export function webullUtcTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function webullNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}