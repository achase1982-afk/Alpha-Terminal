import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const KEY_ENV = "SCANNER_TOKEN_ENCRYPTION_KEY";
const SALT = Buffer.from("scanner_jobs_v1", "utf8");
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

function getKeyMaterial(): Buffer {
  const hex = process.env[KEY_ENV];
  if (!hex || typeof hex !== "string") {
    throw new Error(
      `${KEY_ENV} is required for unified scanner jobs (32-byte key as 64 hex characters).`,
    );
  }
  const trimmed = hex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error(
      `${KEY_ENV} must be exactly 64 hex characters (32 bytes).`,
    );
  }
  return Buffer.from(trimmed, "hex");
}

let cachedDerivedKey: Buffer | null = null;

/** Derive AES-256 key from env hex using fixed salt (per-deployment secret is in env). */
function derivedKey(): Buffer {
  if (!cachedDerivedKey) {
    cachedDerivedKey = scryptSync(getKeyMaterial(), SALT, KEY_LEN);
  }
  return cachedDerivedKey;
}

/**
 * Validates SCANNER_TOKEN_ENCRYPTION_KEY at process start.
 */
export function assertScannerTokenEncryptionKeyConfigured(): void {
  void derivedKey();
}

/** AES-256-GCM encrypt; returns base64(iv || ciphertext+tag). */
export function encrypt(plaintext: string): string {
  const key = derivedKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LEN });
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString("base64");
}

export function decrypt(payloadB64: string): string {
  const key = derivedKey();
  const raw = Buffer.from(payloadB64, "base64");
  if (raw.length < IV_LEN + TAG_LEN) {
    throw new Error("scanner token payload too short");
  }
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(raw.length - TAG_LEN);
  const enc = raw.subarray(IV_LEN, raw.length - TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LEN });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
