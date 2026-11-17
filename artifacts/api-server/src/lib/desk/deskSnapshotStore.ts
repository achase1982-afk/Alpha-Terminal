import { db, deskApiSnapshotsTable } from "@workspace/db";
import { deskSessionDateEt } from "./deskEt.js";
import { logger } from "../logger.js";

export type DeskSnapshotKind = "health" | "quotes" | "chains";

export async function deskPersistSnapshot(
  kind: DeskSnapshotKind,
  payload: unknown,
  symbol?: string,
): Promise<void> {
  try {
    await db.insert(deskApiSnapshotsTable).values({
      kind,
      symbol: symbol?.toUpperCase() ?? null,
      sessionDate: deskSessionDateEt(),
      capturedAt: new Date(),
      payload,
    });
  } catch (err) {
    logger.debug({ err, kind }, "desk snapshot persist skipped");
  }
}