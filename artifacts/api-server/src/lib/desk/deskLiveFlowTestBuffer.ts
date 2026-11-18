import type { DeskLiveFlowFrame } from "./deskLiveFlowHub.js";

const TEST_BUFFER_CAP = 2_000;
let frames: DeskLiveFlowFrame[] = [];

export function deskLiveFlowTestRecordFrame(frame: DeskLiveFlowFrame): void {
  if (process.env.VITEST !== "true") return;
  frames.push(frame);
  if (frames.length > TEST_BUFFER_CAP) frames.splice(0, frames.length - TEST_BUFFER_CAP);
}

export function deskLiveFlowTestSliceFrames(since: number): DeskLiveFlowFrame[] {
  return frames.slice(since);
}

export function deskLiveFlowTestResetFrames(): void {
  frames.length = 0;
}

export function deskLiveFlowTestFrameCount(): number {
  return frames.length;
}