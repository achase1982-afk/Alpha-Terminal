/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { AtGlanceGrossFlow } from "./AtGlanceGrossFlow";
import type { DeskNetPremiumGlance } from "@/lib/active-trader/deskFlowNetPremium";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";

const glance: DeskNetPremiumGlance = {
  streamKind: "spx_options",
  streamNote: null,
  calls: null,
  puts: null,
  connection: "offline",
  stale: false,
  noPrints: false,
  unsupported: false,
  closed: true,
  windowMs: 30_000,
  windowLabel: "30s",
  grossCallsBuy: 0,
  grossCallsSell: 0,
  grossPutsBuy: 0,
  grossPutsSell: 0,
  grossTapeBuy: 0,
  grossTapeSell: 0,
};

const zones: ZoneModel = {
  callWall: 7365,
  putWall: 7320,
  flip: 7355,
  netGexUsdPer1Pct: -1e9,
  env: "amplifying",
  asOfLabel: "4:15 PM",
};

describe("AtGlanceGrossFlow walls", () => {
  it("shows a dash for the closed call and put wall inside the existing two rows", () => {
    const { container } = render(
      <div style={{ width: 440 }}>
        <AtGlanceGrossFlow
          glance={glance}
          zones={{ ...zones, callWall: null, putWall: null, flip: null, wallsRollLabel: "rolls at open" }}
          forceDashAmounts
        />
      </div>,
    );
    const hits = container.textContent?.match(/rolls at open/g) ?? [];
    expect(hits).toHaveLength(0);
    expect(container.querySelector('[data-at-flow-wall="shared"]')?.textContent).toContain("\u2014");
    expect(container.textContent).toContain("Call · Put wall");
    expect(container.querySelector('[data-at-flow-wall="shared"]')).toBeTruthy();
    expect(container.querySelectorAll("[data-at-gross-flow-row]")).toHaveLength(2);
  });

  it("keeps populated call and put wall strikes on their own rows", () => {
    const { container } = render(
      <div style={{ width: 440 }}>
        <AtGlanceGrossFlow glance={glance} zones={zones} forceDashAmounts />
      </div>,
    );
    expect(container.textContent).toContain("Call wall");
    expect(container.textContent).toContain("7,365");
    expect(container.textContent).toContain("Put wall");
    expect(container.textContent).toContain("7,320");
    expect(container.querySelector('[data-at-flow-wall="calls"]')).toBeTruthy();
    expect(container.querySelector('[data-at-flow-wall="puts"]')).toBeTruthy();
    expect(container.querySelector('[data-at-flow-wall="shared"]')).toBeNull();
  });
});
