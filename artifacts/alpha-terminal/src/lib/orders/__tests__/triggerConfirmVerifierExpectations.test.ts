import { describe, expect, it } from "vitest";
import {
  validateOcoTriggerConfirm,
  validateSequenceTriggerConfirm,
  type TriggerConfirmVerifierRow,
} from "../triggerConfirmVerifierExpectations";

const sequenceRows: TriggerConfirmVerifierRow[] = [
  { isParent: true, positionEffect: "TO OPEN", orderKind: "TRIGGER" },
  { isParent: false, positionEffect: "TO CLOSE", orderKind: "LIMIT" },
];

const ocoRows: TriggerConfirmVerifierRow[] = [
  { isParent: true, positionEffect: "TO OPEN", orderKind: "TRIGGER" },
  { isParent: false, positionEffect: "TO CLOSE", orderKind: "LIMIT" },
  { isParent: false, positionEffect: "TO CLOSE", orderKind: "STOP" },
];

describe("triggerConfirmVerifierExpectations", () => {
  it("accepts Sequence bracket (parent OPEN + one LIMIT close)", () => {
    expect(validateSequenceTriggerConfirm(sequenceRows)).toBeNull();
  });

  it("rejects Sequence when OCO-shaped", () => {
    expect(validateSequenceTriggerConfirm(ocoRows)).toMatch(/expected 2 confirm rows/);
  });

  it("accepts OCO bracket (parent OPEN + LIMIT + STOP closes)", () => {
    expect(validateOcoTriggerConfirm(ocoRows)).toBeNull();
  });

  it("rejects OCO when only one exit", () => {
    expect(validateOcoTriggerConfirm(sequenceRows)).toMatch(/expected 3 confirm rows/);
  });
});