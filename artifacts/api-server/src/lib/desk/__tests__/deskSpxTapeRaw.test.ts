import { describe, expect, it } from "vitest";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import {
  deskCaptureInboundFrame,
  deskEmitBufferedRawTapeSince,
  getDeskRawTapeHealth,
} from "../deskSpxTapeRaw.js";

describe("deskSpxTapeRaw", () => {
  it("includes in-memory buffer before DB chunks", () => {
    deskCaptureInboundFrame({ c: 1, rx_ns: "5000", m: { x: 1 } });
    const out: string[] = [];
    const n = deskEmitBufferedRawTapeSince(4000n, (line) => out.push(line));
    expect(n).toBe(1);
    expect(out[0]).toContain('"rx_ns":"5000"');
  });

  it("accumulates frame counters", () => {
    const before = getDeskRawTapeHealth().frames;
    deskCaptureInboundFrame({ c: 1, rx_ns: "1000", m: { response: [] } });
    deskCaptureInboundFrame({ c: 1, rx_ns: "2000", m: { notify: [] } });
    const after = getDeskRawTapeHealth();
    expect(after.frames).toBe(before + 2);
    expect(after.last_frame_ns).toBe("2000");
    expect(after.buffer_frames).toBeGreaterThanOrEqual(2);
  });

  it("filters ndjson lines by since_ns when gunzipping", async () => {
    const lines = [
      JSON.stringify({ c: 1, rx_ns: "100", m: {} }),
      JSON.stringify({ c: 1, rx_ns: "500", m: {} }),
    ].join("\n");
    const { gzipSync } = await import("node:zlib");
    const buf = gzipSync(Buffer.from(`${lines}\n`, "utf8"));
    const out: string[] = [];
    await gunzipLinesSince(buf, 400n, (l) => out.push(l));
    expect(out.length).toBe(1);
    expect(out[0]).toContain('"rx_ns":"500"');
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
        const obj = JSON.parse(line) as { rx_ns?: string };
        if (BigInt(obj.rx_ns ?? "0") > sinceNs) write(`${line}\n`);
      }
    });
    gunzip.on("end", () => resolve());
    gunzip.on("error", reject);
  });
}