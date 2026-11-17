import { deskUtcEpochNs } from "./deskUtcNs.js";

/** Numeric rx_ns for desk tape JSON (fits IEEE double for current epoch ns). */
export function deskTapeRxNsNumber(): number {
  return Number(deskUtcEpochNs());
}

export function deskStringifyTapeJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? Number(v) : v));
}

export function rxNsFromLine(line: string): bigint | null {
  try {
    const obj = JSON.parse(line) as { rx_ns?: number | string };
    if (typeof obj.rx_ns === "number" && Number.isFinite(obj.rx_ns)) {
      return BigInt(Math.trunc(obj.rx_ns));
    }
    if (typeof obj.rx_ns === "string" && obj.rx_ns.trim() !== "") {
      return BigInt(obj.rx_ns);
    }
  } catch {
    /* */
  }
  return null;
}