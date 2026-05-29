import { useCallback, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Copy, Play, Check } from "lucide-react";
import type { StrategistSendToOrderPayload, StrategistV2Result } from "@/components/StrategistV2Card";
import { buildOccSymbol } from "@/components/StrategistV2Card";
import { strategistCardToPlainText } from "@/lib/strategistPlaintext";
import {
  confidenceColor,
  directionStyle,
  formatGenerated,
  modelFromV2Result,
  type StrategistTradeCardModel,
} from "@/lib/strategistCardModel";
import { useValidationCardTts } from "@/hooks/useValidationCardTts";

const SURFACE = "#161618";
const SURFACE_2 = "#202023";
const LINE = "rgba(255,255,255,0.10)";
const WHITE = "#ffffff";
const AMBER = "#f5a524";
const GREEN = "#46d486";
const RED = "#ff7a7a";
const SYS_FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif';

const VALUE_COL_W = 64;

function StrategistBulletList({ items, dotColor }: { items: string[]; dotColor: string }) {
  if (!items.length) return null;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {items.map((text, i) => (
        <li
          key={i}
          style={{
            fontSize: 13,
            fontWeight: 400,
            color: WHITE,
            lineHeight: 1.4,
            padding: "2px 0 2px 15px",
            position: "relative",
          }}
        >
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              top: 10,
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: dotColor,
            }}
          />
          {text}
        </li>
      ))}
    </ul>
  );
}

export function StrategistTradeCard({
  model,
  onSendToOrder,
  buildSendPayload,
  plainText,
  generatedAt,
}: {
  model: StrategistTradeCardModel;
  onSendToOrder?: (payload: StrategistSendToOrderPayload) => void;
  buildSendPayload?: () => StrategistSendToOrderPayload | null;
  plainText?: string;
  collapseStorageKey?: string | null;
  generatedAt?: string | number | null;
}) {
  const panelId = useId();
  const panelDomId = `strategist-trade-card-${panelId.replace(/:/g, "")}`;
  const [reportOpen, setReportOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const dir = directionStyle(model.direction);
  const confColor = confidenceColor(model.confidence);
  const genLabel = formatGenerated(generatedAt ?? model.generatedAt);
  const signalLabel =
    model.underlyingAtSignal != null && Number.isFinite(model.underlyingAtSignal)
      ? `$${model.underlyingAtSignal.toFixed(2)} at signal`
      : "";

  const row1Label = model.isCredit
    ? "Net credit · your max profit"
    : model.debitRowUsesMaxRisk
      ? "Net debit · your max risk"
      : "Net debit · your max loss";

  const row2Label = model.isCredit ? "Max loss" : "Max profit";

  const row1Value = `$${model.netEntry.toFixed(2)}`;
  const row2Primary = model.isCredit
    ? model.maxLossDisplay ?? `$${(model.maxLoss / 100).toFixed(2)}`
    : model.maxProfitDisplay ??
      (model.maxProfit >= 99999 ? "Unlimited" : `~$${(model.maxProfit / 100).toFixed(2)}`);

  const copyText =
    plainText ??
    (model.plainTextSource
      ? strategistCardToPlainText(model.plainTextSource, generatedAt ?? undefined)
      : model.deskPlainText ?? "");

  const audioId = useMemo(
    () => `strategist-trade-${model.ticker}-${copyText.slice(0, 48)}`,
    [model.ticker, copyText],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const { startPlay, audioLoading, audioRef, onAudioEnded, onLoadedMetadata, onPlay, onPause, onAudioElementError } =
    useValidationCardTts({
      plainText: copyText,
      audioId,
      resetDependency: copyText,
      containerRef,
    });

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [copyText]);

  return (
    <div
      ref={containerRef}
      id={panelDomId}
      style={{
        background: SURFACE,
        borderRadius: 18,
        overflow: "hidden",
        fontFamily: SYS_FONT,
        fontVariantNumeric: "tabular-nums",
        color: WHITE,
      }}
    >
      <audio
        ref={audioRef}
        preload="auto"
        playsInline
        className="hidden"
        onEnded={onAudioEnded}
        onLoadedMetadata={onLoadedMetadata}
        onPlay={onPlay}
        onPause={onPause}
        onError={onAudioElementError}
      />

      {/* §3.1 Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          padding: "13px 18px 0",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 500, color: WHITE, flex: "0 0 auto" }}>{genLabel}</span>
        <span style={{ flex: 1, textAlign: "center", fontSize: 12, fontWeight: 500, color: WHITE }}>{signalLabel}</span>
        <div style={{ textAlign: "right", flex: "0 0 auto", minWidth: 72 }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: confColor, lineHeight: 1 }}>{model.confidence}</div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: WHITE,
              textTransform: "uppercase",
              marginTop: 2,
              letterSpacing: "0.02em",
            }}
          >
            CONFIDENCE
          </div>
        </div>
      </div>

      {/* §3.2 Title */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          padding: "8px 18px 0",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
          <span style={{ fontSize: 29, fontWeight: 700, lineHeight: 1.1 }}>{model.ticker}</span>
          <span style={{ fontSize: 19, fontWeight: 700, color: dir.color, whiteSpace: "nowrap" }}>
            {dir.glyph} {model.direction}
          </span>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{model.strategyName}</div>
          <div style={{ fontSize: 13, fontWeight: 500, marginTop: 2 }}>{model.structureDescriptor}</div>
        </div>
      </div>

      {/* §3.3 Legs */}
      <div style={{ padding: "11px 18px 0" }}>
        {model.legs.map((leg, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              fontSize: 15,
              paddingBottom: i === model.legs.length - 1 ? 0 : 6,
            }}
          >
            <span style={{ width: 40, fontWeight: 700, color: leg.side === "SELL" ? RED : GREEN, flexShrink: 0 }}>
              {leg.side}
            </span>
            <span style={{ fontWeight: 700, flexShrink: 0 }}>{leg.expiry}</span>
            <span style={{ fontWeight: 700, flexShrink: 0 }}>{leg.strikeType}</span>
            <span style={{ fontWeight: 500 }}>{leg.deltaLabel}</span>
            <span
              style={{
                marginLeft: "auto",
                width: VALUE_COL_W,
                textAlign: "right",
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {leg.price}
            </span>
          </div>
        ))}
      </div>

      {/* §3.4 Economics */}
      <div style={{ padding: "4px 18px 0" }}>
        <div
          style={{
            marginLeft: "auto",
            width: VALUE_COL_W,
            borderTop: `1px solid ${LINE}`,
            marginTop: 6,
            marginBottom: 4,
          }}
        />
        <EconRow label={row1Label} value={row1Value} valueColor={model.isCredit ? GREEN : RED} />
        <EconRow
          label={row2Label}
          value={row2Primary}
          valueColor={model.isCredit ? RED : GREEN}
          subValue={model.maxProfitShowEst ? "est." : undefined}
          subColor={GREEN}
        />
      </div>

      {/* §3.5 Risk : Reward + Send */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 18px 0",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>
          Risk : Reward <span style={{ fontWeight: 800 }}>{model.riskRewardDisplay}</span>
        </span>
        {onSendToOrder && buildSendPayload && (
          <button
            type="button"
            onClick={() => {
              const p = buildSendPayload();
              if (p) onSendToOrder(p);
            }}
            style={{
              background: "none",
              border: "none",
              color: AMBER,
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              padding: 0,
              textTransform: "uppercase",
            }}
          >
            SEND TO ORDER →
          </button>
        )}
      </div>

      {/* §3.6 Plan */}
      {model.exitPlan && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 22,
            padding: "11px 18px 6px",
            borderTop: `1px solid ${LINE}`,
            marginTop: 11,
          }}
        >
          <PlanColumn title="Entry">
            <PlanRow label="Stock" value={model.entryStockBand ?? "—"} />
            <PlanRow label="Fill" value={model.fillBand ?? "—"} />
          </PlanColumn>
          <PlanColumn title="Exit">
            <PlanRow label="Profit" value={model.exitPlan.profitDisplay} valueColor={GREEN} />
            <PlanRow label="Stop" value={model.exitPlan.stopDisplay} valueColor={RED} />
            <PlanRow label="Time" value={model.exitPlan.timeStop || "—"} />
          </PlanColumn>
        </div>
      )}

      {/* §3.7 Brief */}
      {(model.whyBullets.length > 0 || model.whatKillsBullets.length > 0) && (
        <div style={{ padding: "12px 18px 4px", borderTop: model.exitPlan ? "none" : `1px solid ${LINE}` }}>
          {model.whyBullets.length > 0 && (
            <div style={{ marginBottom: model.whatKillsBullets.length > 0 ? 12 : 0 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: GREEN,
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                ▲ Why it works
              </div>
              <StrategistBulletList items={model.whyBullets} dotColor={GREEN} />
            </div>
          )}
          {model.whatKillsBullets.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: RED,
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                ▼ What kills it
              </div>
              <StrategistBulletList items={model.whatKillsBullets} dotColor={RED} />
            </div>
          )}
        </div>
      )}

      {/* §3.8 Report drawer */}
      {model.reportDrawer && (
        <div style={{ borderTop: `1px solid ${LINE}` }}>
          <button
            type="button"
            onClick={() => setReportOpen((o) => !o)}
            aria-expanded={reportOpen}
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 18px",
              background: "none",
              border: "none",
              color: WHITE,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Read full report
            <ChevronDown
              size={18}
              aria-hidden
              style={{
                transform: reportOpen ? "rotate(90deg)" : "none",
                transition: "transform 0.2s ease",
                flexShrink: 0,
              }}
            />
          </button>
          {reportOpen && (
            <div style={{ padding: "0 18px 12px", fontSize: 13, lineHeight: 1.5 }}>
              <ReportSection title="Company" body={model.reportDrawer.company} />
              <ReportSection title="Thesis" body={model.reportDrawer.thesis} />
              <ReportSection title="Exit Detail" body={model.reportDrawer.exitDetail} />
              <ReportSection title="Levels & Liquidity" body={model.reportDrawer.levelsLiquidity} />
              <ReportSection title="Edge & Regime" body={model.reportDrawer.edgeRegime} />
            </div>
          )}
        </div>
      )}

      {/* §3.9 Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          padding: "11px 16px",
          borderTop: `1px solid ${LINE}`,
        }}
      >
        <button
          type="button"
          onClick={() => void handleCopy()}
          aria-label="Copy card"
          style={footerIconStyle}
        >
          {copied ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />}
        </button>
        <button
          type="button"
          onClick={() => void startPlay()}
          disabled={audioLoading || !copyText.trim()}
          aria-label="Listen"
          style={{
            ...footerIconStyle,
            opacity: audioLoading || !copyText.trim() ? 0.45 : 1,
            cursor: audioLoading || !copyText.trim() ? "not-allowed" : "pointer",
          }}
        >
          <Play size={18} aria-hidden />
        </button>
      </div>
    </div>
  );
}

const footerIconStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 10,
  background: SURFACE_2,
  border: "none",
  color: WHITE,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

function EconRow({
  label,
  value,
  valueColor,
  subValue,
  subColor,
}: {
  label: string;
  value: string;
  valueColor: string;
  subValue?: string;
  subColor?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        padding: "5px 0",
        fontSize: 16,
        fontWeight: 700,
      }}
    >
      <span style={{ paddingRight: 12 }}>{label}</span>
      <div style={{ width: VALUE_COL_W, textAlign: "right", color: valueColor, flexShrink: 0 }}>
        <div>{value}</div>
        {subValue ? (
          <div style={{ fontSize: 12, fontWeight: 600, color: subColor ?? valueColor, marginTop: 1 }}>{subValue}</div>
        ) : null}
      </div>
    </div>
  );
}

function PlanColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: AMBER,
          textTransform: "uppercase",
          marginBottom: 8,
          letterSpacing: "0.04em",
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function PlanRow({
  label,
  value,
  valueColor = WHITE,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        marginBottom: 6,
        gap: 8,
      }}
    >
      <span style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: valueColor, textAlign: "right" }}>{value}</span>
    </div>
  );
}

function ReportSection({ title, body }: { title: string; body: string }) {
  if (!body?.trim()) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: AMBER,
          textTransform: "uppercase",
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      <div style={{ whiteSpace: "pre-wrap" }}>{body}</div>
    </div>
  );
}

export function StrategistTradeCardFromV2({
  result,
  onSendToOrder,
  generatedAt,
}: {
  result: StrategistV2Result;
  onSendToOrder?: (payload: StrategistSendToOrderPayload) => void;
  generatedAt?: string | number | null;
  collapseStorageKey?: string | null;
}) {
  const model = useMemo(() => modelFromV2Result(result, generatedAt), [result, generatedAt]);

  const buildSendPayload = useCallback((): StrategistSendToOrderPayload | null => {
    const rec = result.recommendation;
    if (!rec) return null;
    const credit = rec.credit != null && rec.credit > 0;
    const netPrice = credit ? rec.credit! : rec.debit ?? 0;
    const orderLegs = rec.legs.map((leg) => ({
      schwabSymbol: buildOccSymbol(result.ticker, leg.expiration, leg.type, leg.strike),
      instruction: leg.side === "buy" ? "BUY_TO_OPEN" : "SELL_TO_OPEN",
      quantity: 1,
      optionType: leg.type.toUpperCase(),
      strike: leg.strike,
      expiration: leg.expiration,
      bid: leg.bid,
      ask: leg.ask,
      delta: leg.delta,
    }));
    return { ticker: result.ticker, legs: orderLegs, netPrice, isCredit: credit };
  }, [result]);

  if (!model) return null;

  return (
    <StrategistTradeCard
      model={model}
      onSendToOrder={onSendToOrder}
      buildSendPayload={buildSendPayload}
      generatedAt={generatedAt}
    />
  );
}
