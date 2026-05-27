import { describe, expect, it } from "vitest";
import type { MoversNewsHeadline } from "../fmpMoversNews.js";
import {
  isLitigationSolicitationHeadline,
  pickCatalystHeadline,
  pickDrivingHeadline,
  resolveHeadlineByTitle,
} from "../moversNewsKey.js";

function headline(title: string, publishedAt: string): MoversNewsHeadline {
  return { symbol: "FUTU", publishedAt, title, source: "", kind: "news" };
}

describe("isLitigationSolicitationHeadline", () => {
  it("flags law-firm solicitation patterns", () => {
    expect(
      isLitigationSolicitationHeadline(
        "Schall Law Firm Reminds Investors of Class Action Against Futu Holdings",
      ),
    ).toBe(true);
    expect(
      isLitigationSolicitationHeadline("Investors have opportunity to join securities fraud investigation"),
    ).toBe(true);
  });

  it("does not flag regulatory catalyst headlines", () => {
    expect(
      isLitigationSolicitationHeadline("China tightens regulatory scrutiny on online brokers"),
    ).toBe(false);
  });
});

describe("pickCatalystHeadline", () => {
  it("prefers hard-catalyst headline over newer ambient news", () => {
    const headlines = [
      headline("Broader market rally lifts fintech peers", "2026-05-24T14:00:00Z"),
      headline("Analyst upgrades FUTU to Buy, raises price target", "2026-05-24T11:00:00Z"),
    ];
    const picked = pickCatalystHeadline(headlines);
    expect(picked?.title).toContain("upgrades");
  });

  it("breaks equal hard-catalyst scores by recency", () => {
    const headlines = [
      headline("Company wins major government contract", "2026-05-24T09:00:00Z"),
      headline("Firm awarded new defense contract", "2026-05-24T12:00:00Z"),
    ];
    expect(pickCatalystHeadline(headlines)?.title).toContain("awarded");
  });
});

describe("pickDrivingHeadline", () => {
  it("skips solicitation when a substantive newer headline exists", () => {
    const headlines = [
      headline("Schall Law Firm announces investigation into FUTU", "2026-05-24T12:00:00Z"),
      headline("China regulatory crackdown hits online broker stocks", "2026-05-24T10:00:00Z"),
    ];
    const driving = pickDrivingHeadline(headlines);
    expect(driving?.title).toContain("regulatory crackdown");
  });

  it("falls back to newest when only solicitation headlines exist", () => {
    const headlines = [
      headline("Law firm encourages investors to contact firm about class action", "2026-05-24T11:00:00Z"),
    ];
    expect(pickDrivingHeadline(headlines)?.title).toContain("Law firm");
  });
});

describe("resolveHeadlineByTitle", () => {
  it("matches exact and partial titles", () => {
    const headlines = [headline("Company beats earnings for Q2", "2026-05-24")];
    expect(resolveHeadlineByTitle(headlines, "Company beats earnings for Q2")?.title).toBe(
      "Company beats earnings for Q2",
    );
    expect(resolveHeadlineByTitle(headlines, "beats earnings")?.title).toContain("earnings");
  });
});
