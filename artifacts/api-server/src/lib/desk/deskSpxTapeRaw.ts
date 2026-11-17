import { createGunzip, gzipSync } from "node:zlib";
import { Readable } from "node:stream";
import { and, asc, eq, gte, db, deskSpxTapeRawTable } from "@workspace/db";
import { deskSessionDateEt } from "./deskEt.js";
import { logger } from "../logger.js";

export type DeskRawTapeFrame = {
  c: number;
  rx_ns: string;
  m: unknown;
};

const FLUSH_INTERVAL_MS = 60_000;
const MAX_BUFFER_LINES = 25_000;
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

let buffer: string[] = [];
let bufferBytes = 0;
let chunkStartNs: bigint | null = null;
let chunkEndNs: bigint | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushInFlight: Promise<void> | null = null;

let framesCaptured = 0;
let bytesCaptured = 0;
let lastFrameNs: string | null = null;
let lastFrameUtcMs: number | null = null;

function frameLine(frame: DeskRawTapeFrame): string {
  return JSON.stringify(frame);
}

function rxNsBigInt(rx_ns: string): bigint | null {
  try {
    return BigInt(rx_ns);
  } catch {
    return null;
  }
}

export function deskCaptureInboundFrame(frame: DeskRawTapeFrame): void {
  const line = frameLine(frame);
  const lineBytes = Buffer.byteLength(line, "utf8") + 1;
  const ns = rxNsBigInt(frame.rx_ns);

  if (chunkStartNs == null && ns != null) chunkStartNs = ns;
  if (ns != null) chunkEndNs = ns;

  buffer.push(line);
  bufferBytes += lineBytes;
  framesCaptured += 1;
  bytesCaptured += lineBytes;
  lastFrameNs = frame.rx_ns;
  lastFrameUtcMs = Date.now();

  if (buffer.length >= MAX_BUFFER_LINES || bufferBytes >= MAX_BUFFER_BYTES) {
    void deskFlushRawTapeChunk("buffer_cap");
  }
}

export function getDeskRawTapeHealth(): {
  frames: number;
  bytes: number;
  last_frame_ns: string | null;
  last_frame_utc_ms: number | null;
  buffer_frames: number;
} {
  return {
    frames: framesCaptured,
    bytes: bytesCaptured,
    last_frame_ns: lastFrameNs,
    last_frame_utc_ms: lastFrameUtcMs,
    buffer_frames: buffer.length,
  };
}

async function persistChunk(
  sessionDate: string,
  gzipBuf: Buffer,
  meta: { chunkStartNs: bigint; chunkEndNs: bigint; nFrames: number },
): Promise<void> {
  if (meta.nFrames === 0) return;
  try {
    await db.insert(deskSpxTapeRawTable).values({
      sessionDate,
      chunkStartNs: meta.chunkStartNs,
      chunkEndNs: meta.chunkEndNs,
      nFrames: meta.nFrames,
      bytesRaw: gzipBuf.length,
      data: gzipBuf,
    });
  } catch (err) {
    logger.warn(
      { err, nFrames: meta.nFrames, hint: "apply migration 0052_desk_spx_tape_raw" },
      "Desk raw tape chunk insert failed",
    );
  }
}

export async function deskFlushRawTapeChunk(reason = "interval"): Promise<void> {
  if (buffer.length === 0) return;
  if (flushInFlight) {
    await flushInFlight;
    if (buffer.length === 0) return;
  }

  const lines = buffer;
  const startNs = chunkStartNs;
  const endNs = chunkEndNs;
  const sessionDate = deskSessionDateEt();
  buffer = [];
  bufferBytes = 0;
  chunkStartNs = null;
  chunkEndNs = null;

  const meta = {
    chunkStartNs: startNs ?? 0n,
    chunkEndNs: endNs ?? 0n,
    nFrames: lines.length,
  };

  flushInFlight = (async () => {
    const raw = `${lines.join("\n")}\n`;
    const gzipBuf = gzipSync(Buffer.from(raw, "utf8"));
    await persistChunk(sessionDate, gzipBuf, meta);
    logger.debug({ reason, n: lines.length, sessionDate }, "Desk raw tape chunk flushed");
  })().finally(() => {
    flushInFlight = null;
  });

  await flushInFlight;
}

export function startDeskRawTapeCapture(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void deskFlushRawTapeChunk("interval");
  }, FLUSH_INTERVAL_MS);
  flushTimer.unref?.();

  const onTerm = () => {
    void deskFlushRawTapeChunk("sigterm").finally(() => process.exit(0));
  };
  process.once("SIGTERM", onTerm);
  process.once("SIGINT", onTerm);
}

export function deskEmitBufferedRawTapeSince(sinceNs: bigint, write: (line: string) => void): number {
  let emitted = 0;
  for (const line of buffer) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as { rx_ns?: string };
      const ns = obj.rx_ns != null ? BigInt(obj.rx_ns) : 0n;
      if (ns > sinceNs) {
        write(`${line}\n`);
        emitted += 1;
      }
    } catch {
      /* skip */
    }
  }
  return emitted;
}

export async function streamDeskRawTapeNdjson(
  sessionDate: string,
  sinceNs: bigint,
  write: (line: string) => void,
): Promise<number> {
  let emitted = deskEmitBufferedRawTapeSince(sinceNs, write);

  try {
    const rows = await db
      .select()
      .from(deskSpxTapeRawTable)
      .where(
        and(eq(deskSpxTapeRawTable.sessionDate, sessionDate), gte(deskSpxTapeRawTable.chunkEndNs, sinceNs)),
      )
      .orderBy(asc(deskSpxTapeRawTable.chunkStartNs));

    for (const row of rows) {
      const emittedFromChunk = await gunzipLines(row.data as Buffer, sinceNs, write);
      emitted += emittedFromChunk;
    }
  } catch (err) {
    logger.warn({ err, sessionDate }, "Desk raw tape DB read failed — buffer-only response");
  }
  return emitted;
}

function gunzipLines(
  data: Buffer,
  sinceNs: bigint,
  write: (line: string) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let emitted = 0;
    let leftover = "";
    const gunzip = createGunzip();
    const src = Readable.from(data);
    src.pipe(gunzip);
    gunzip.setEncoding("utf8");
    gunzip.on("data", (chunk: string) => {
      const text = leftover + chunk;
      const lines = text.split("\n");
      leftover = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line) as { rx_ns?: string };
          const ns = obj.rx_ns != null ? BigInt(obj.rx_ns) : 0n;
          if (ns > sinceNs) {
            write(`${line}\n`);
            emitted += 1;
          }
        } catch {
          /* skip corrupt line */
        }
      }
    });
    gunzip.on("end", () => {
      if (leftover.trim()) {
        try {
          const obj = JSON.parse(leftover) as { rx_ns?: string };
          const ns = obj.rx_ns != null ? BigInt(obj.rx_ns) : 0n;
          if (ns > sinceNs) {
            write(`${leftover}\n`);
            emitted += 1;
          }
        } catch {
          /* skip */
        }
      }
      resolve(emitted);
    });
    gunzip.on("error", reject);
  });
}