import { describe, expect, it } from "vitest";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import {
  deskCaptureInboundFrame,
  deskEmitBufferedRawTapeSince,
  getDeskRawTapeHealth,
} from "../deskSpxTapeRaw.js";
import { deskSessionDateEt } from "../deskEt.js";

describe("deskSpxTapeRaw", () => {
  it("includes in-memory buffer before DB chunks", () => {
    const session = deskSessionDateEt();
    deskCaptureInboundFrame({
      c: 1,
      rx_ns: 5000,
      m: { data: [{ service: "LEVELONE_EQUITIES", content: [{ key: "$SPX", 3: 1 }] }] },
      session_date: session,
    });
    const out: string[] = [];
    const n = deskEmitBufferedRawTapeSince(session, 0n, (line) => out.push(line));
    expect(n).toBe(1);
    expect(out[0]).toMatch(/"rx_ns":5000[^0-9]/);
  });

  it("accumulates frame counters", () => {
    const before = getDeskRawTapeHealth().frames;
    deskCaptureInboundFrame({
      c: 1,
      rx_ns: 1000,
      m: { data: [{ service: "LEVELONE_EQUITIES", content: [{ key: "SPY", 3: 1 }] }] },
    });
    deskCaptureInboundFrame({
      c: 1,
      rx_ns: 2000,
      m: { data: [{ service: "LEVELONE_EQUITIES", content: [{ key: "$SPX", 3: 1 }] }] },
    });
    const after = getDeskRawTapeHealth();
    expect(after.frames).toBe(before + 2);
    expect(after.last_frame_ns).toBe(2000);
    expect(after.buffer_frames).toBeGreaterThanOrEqual(2);
  });

  it("filters ndjson lines by since_ns when gunzipping", async () => {
    const lines = [
      JSON.stringify({ c: 1, rx_ns: 100, m: {} }),
      JSON.stringify({ c: 1, rx_ns: 500, m: {} }),
    ].join("\n");
    const { gzipSync } = await import("node:zlib");
    const buf = gzipSync(Buffer.from(`${lines}\n`, "utf8"));
    const out: string[] = [];
    await gunzipLinesSince(buf, 400n, (l) => out.push(l));
    expect(out.length).toBe(1);
    expect(out[0]).toMatch(/"rx_ns":500[^0-9]/);
  });
});

function gunzipLinesSince(
  data: Buffer,
  sinceNs: bigint,
  write: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let leftover = "";
    const gunzip = createGunzip();
    Readable.from(data).pipe(gunzip);
    gunzip.setEncoding("utf8");
    gunzip.on("data", (chunk: string) => {
      const text = leftover + chunk;
      const parts = text.split("\n");
      leftover = parts.pop() ?? "";
      for (const line of parts) {
        if (!line.trim()) continue;
        const obj = JSON.parse(line) as { rx_ns?: number };
        if (BigInt(obj.rx_ns ?? 0) > sinceNs) write(`${line}\n`);
      }
    });
    gunzip.on("end", () => resolve());
    gunzip.on("error", reject);
  });
}