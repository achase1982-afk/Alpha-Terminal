import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ReportTone, StatChip, StrategistFullReport } from "@/lib/strategistFullReportTypes";

const LINE = "rgba(255,255,255,0.10)";
const SURFACE_2 = "#202023";
const WHITE = "#ffffff";
const AMBER = "#f5a524";
const GREEN = "#46d486";
const RED = "#ff7a7a";
const DIM = "rgba(255,255,255,0.55)";
const SYS_FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif';

function toneColor(t: ReportTone | undefined): string {
  if (t === "green") return GREEN;
  if (t === "red") return RED;
  if (t === "amber" || t === "yellow") return AMBER;
  return WHITE;
}

function ChipRow({ chips }: { chips: StatChip[] }) {
  if (!chips.length) return null;
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "6px 10px",
        background: SURFACE_2,
        borderRadius: 12,
        padding: "10px 12px",
        marginTop: 8,
        fontSize: 12.5,
        fontWeight: 600,
        lineHeight: 1.4,
      }}
    >
      {chips.map((c, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {i > 0 ? <span style={{ color: "rgba(255,255,255,0.25)" }}>·</span> : null}
          <span style={{ color: DIM, fontWeight: 500 }}>{c.label}</span>
          <span style={{ color: toneColor(c.tone), fontWeight: 600 }}>{c.value}</span>
        </span>
      ))}
    </div>
  );
}

function ReportSectionBlock({
  title,
  titleColor = AMBER,
  chips,
  body,
  children,
}: {
  title: string;
  titleColor?: string;
  chips?: StatChip[];
  body?: string;
  children?: React.ReactNode;
}) {
  if (!body?.trim() && (!chips || chips.length === 0) && !children) return null;
  return (
    <section style={{ paddingTop: 15 }}>
      <h3
        style={{
          margin: 0,
          fontSize: 11.5,
          fontWeight: 800,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          color: titleColor,
        }}
      >
        {title}
      </h3>
      {chips && chips.length > 0 ? <ChipRow chips={chips} /> : null}
      {body?.trim() ? (
        <p style={{ margin: "10px 0 0", fontSize: 13.5, lineHeight: 1.6, color: WHITE, fontWeight: 400 }}>
          {body}
        </p>
      ) : null}
      {children}
    </section>
  );
}

function Divider() {
  return <div style={{ height: 1, background: LINE, marginTop: 15 }} />;
}

function ProvenancePanel({ report }: { report: StrategistFullReport }) {
  const p = report.provenance;
  return (
    <div
      style={{
        background: SURFACE_2,
        borderRadius: 12,
        padding: "12px 14px",
        marginTop: 12,
      }}
    >
      {p.freshness.map((f, i) => (
        <div key={i} style={{ fontSize: 12, color: DIM, marginBottom: 4 }}>
          {f.source}
          {f.asOf ? ` · as of ${f.asOf}` : ""}
        </div>
      ))}
      <p style={{ margin: "10px 0 0", fontSize: 13.5, lineHeight: 1.6, color: WHITE }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: toneColor(p.confidenceTier) }}>
          {p.confidence}{" "}
        </span>
        <span style={{ fontWeight: 600 }}>confidence.</span> {p.confidenceRead}
      </p>
    </div>
  );
}

/**
 * Read Full Report drawer — layout per strategist-report mockup spec.
 * Collapsed by default; does not alter the shipped trade card shell.
 */
export function StrategistFullReportDrawer({ report }: { report: StrategistFullReport | null | undefined }) {
  const [open, setOpen] = useState(false);
  if (!report) return null;

  return (
    <div style={{ borderTop: `1px solid ${LINE}`, fontFamily: SYS_FONT, fontVariantNumeric: "tabular-nums" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 18px",
          background: "none",
          border: "none",
          color: AMBER,
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          cursor: "pointer",
        }}
      >
        Read full report
        <ChevronDown
          size={18}
          aria-hidden
          style={{
            color: WHITE,
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform 0.2s ease",
          }}
        />
      </button>

      {open && (
        <div style={{ padding: "0 18px 14px", color: WHITE }}>
          <ReportSectionBlock title="Provenance / Snapshot">
            <ProvenancePanel report={report} />
          </ReportSectionBlock>

          {report.tradeRecap && (
            <>
              <Divider />
              <ReportSectionBlock title="The Trade" chips={report.tradeRecap.chips} />
            </>
          )}

          {report.whyInPlay && (
            <>
              <Divider />
              <ReportSectionBlock title="Why It's In Play" chips={report.whyInPlay.chips} body={report.whyInPlay.body} />
            </>
          )}

          {report.thesisWithNumbers && (
            <>
              <Divider />
              <ReportSectionBlock
                title="Thesis, With The Numbers"
                chips={report.thesisWithNumbers.chips}
                body={report.thesisWithNumbers.body}
              />
            </>
          )}

          {report.streetVsTape && (
            <>
              <Divider />
              <ReportSectionBlock title="Street vs Tape" body={report.streetVsTape.body}>
                <p style={{ margin: "8px 0 0", fontSize: 12, fontWeight: 700, color: DIM, textTransform: "uppercase" }}>
                  Sell side
                </p>
                <ChipRow chips={report.streetVsTape.sellSide.chips} />
                {report.streetVsTape.sellSide.recent.length > 0 && (
                  <ul style={{ margin: "8px 0 0", padding: "0 0 0 16px", fontSize: 12.5, lineHeight: 1.5 }}>
                    {report.streetVsTape.sellSide.recent.map((r, i) => (
                      <li key={i} style={{ marginBottom: 4 }}>
                        {r.firm}: {r.action} ({r.from} → {r.to}) · {r.date}
                      </li>
                    ))}
                  </ul>
                )}
                <p style={{ margin: "12px 0 0", fontSize: 12, fontWeight: 700, color: DIM, textTransform: "uppercase" }}>
                  Buy side (tape)
                </p>
                <ChipRow chips={report.streetVsTape.buySide.chips} />
              </ReportSectionBlock>
            </>
          )}

          {report.idioMacro && (
            <>
              <Divider />
              <ReportSectionBlock title="Idiosyncratic vs Macro" chips={report.idioMacro.chips} body={report.idioMacro.body} />
            </>
          )}

          {report.sectorExposure && (report.sectorExposure.peers.length > 0 || report.sectorExposure.body) && (
            <>
              <Divider />
              <ReportSectionBlock title="What Else Could Move This" body={report.sectorExposure.body}>
                {report.sectorExposure.peers.length > 0 && (
                  <ChipRow
                    chips={report.sectorExposure.peers.map((p) => ({ label: "Peer", value: p, tone: "white" as const }))}
                  />
                )}
              </ReportSectionBlock>
            </>
          )}

          {report.whyStructure && (
            <>
              <Divider />
              <ReportSectionBlock title="Why This Structure" body={report.whyStructure.body} />
            </>
          )}

          {report.bearCase && (
            <>
              <Divider />
              <ReportSectionBlock title="The Bear Case" titleColor={RED} body={report.bearCase.body} />
            </>
          )}

          {report.riskManagement && (
            <>
              <Divider />
              <ReportSectionBlock
                title="Risk & Management"
                chips={report.riskManagement.chips}
                body={report.riskManagement.body}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
