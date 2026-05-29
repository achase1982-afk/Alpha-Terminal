import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Copy, Play, X, Check } from "lucide-react";
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
const LINE_SOFT = "rgba(255,255,255,0.06)";
const WHITE = "#ffffff";
const AMBER = "#f5a524";
const GREEN = "#46d486";
const RED = "#ff7a7a";
const SYS_FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif';

const EXPANDED_PREFIX = "strategist-trade-card-expanded-";
const HIDDEN_PREFIX = "strategist-trade-card-hidden-";

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function StrategistBulletList({
  items,
  dotColor,
}: {
  items: string[];
  dotColor: string;
}) {
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
  collapseStorageKey,
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
  const storageKey = collapseStorageKey ?? model.ticker;

  const [hidden, setHidden] = useState(() => readSession(`${HIDDEN_PREFIX}${storageKey}`) === "1");
  const [expanded, setExpanded] = useState(() => {
    const v = readSession(`${EXPANDED_PREFIX}${storageKey}`);
    return v == null ? true : v === "1";
  });
  const [reportOpen, setReportOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const v = readSession(`${EXPANDED_PREFIX}${storageKey}`);
    setExpanded(v == null ? true : v === "1");
  }, [storageKey]);

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      writeSession(`${EXPANDED_PREFIX}${storageKey}`, next ? "1" : "0");
      return next;
    });
  }, [storageKey]);

  const dismiss = useCallback(() => {
    setHidden(true);
    writeSession(`${HIDDEN_PREFIX}${storageKey}`, "1");
  }, [storageKey]);

  const dir = directionStyle(model.direction);
  const confColor = confidenceColor(model.confidence);
  const genLabel = formatGenerated(generatedAt ?? model.generatedAt);
  const signalLabel =
    model.underlyingAtSignal != null && Number.isFinite(model.underlyingAtSignal)
      ? `$${model.underlyingAtSignal.toFixed(2)} at signal`
      : "";

  const row1Label = model.isCredit
    ? "Net credit · your max profit"
    : "Net debit · your max loss";
  const row2Label = model.isCredit ? "Max loss" : "Max profit";
  const row1Value = `$${model.netEntry.toFixed(2)}`;
  const row2Value = model.isCredit
    ? model.maxLossDisplay ?? `$${(model.maxLoss / 100).toFixed(2)}`
    : model.maxProfitDisplay ??
      (model.maxProfit >= 99999 ? "Unlimited" : `$${(model.maxProfit / 100).toFixed(2)}`);

  const summaryExtra = model.isCredit
    ? ` · $${model.netEntry.toFixed(2)} cr`
    : model.riskRewardDisplay !== "varies" && model.riskRewardDisplay !== "open-ended"
      ? ` · ${model.riskRewardDisplay}`
      : "";

  const copyText =
    plainText ??
    (model.plainTextSource
      ? strategistCardToPlainText(model.plainTextSource, generatedAt ?? undefined)
      : model.deskPlainText ?? "");

  const audioId = useMemo(
    () => `strategist-trade-${storageKey}-${copyText.slice(0, 64)}`,
    [storageKey, copyText],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const { startPlay, audioLoading, audioRef, onAudioEnded, onLoadedMetadata, onPlay, onPause, onAudioElementError } =
    useValidationCardTts({
      plainText: copyText,
      audioId,
      resetDependency: copyText,
      containerRef,
    });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  if (hidden) return null;

  return (
    <div
      ref={containerRef}
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

      {/* Summary / collapse bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 18px",
          borderBottom: expanded ? `1px solid ${LINE}` : "none",
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={toggleExpanded}
          aria-expanded={expanded}
          aria-controls={panelDomId}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            background: "none",
            border: "none",
            color: WHITE,
            cursor: "pointer",
            textAlign: "left",
            padding: 0,
            minHeight: 44,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {model.ticker} {dir.glyph} {model.strategyName}
            {summaryExtra}
          </span>
          <span style={{ fontSize: 26, fontWeight: 700, color: confColor, flexShrink: 0 }}>
            {model.confidence}
          </span>
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Hide card"
            style={{
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "none",
              border: "none",
              color: WHITE,
              cursor: "pointer",
            }}
          >
            <X size={18} aria-hidden />
          </button>
          <button
            type="button"
            onClick={toggleExpanded}
            aria-label={expanded ? "Collapse card" : "Expand card"}
            style={{
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "none",
              border: "none",
              color: WHITE,
              cursor: "pointer",
            }}
          >
            {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div id={panelDomId}>
          {/* Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              padding: "13px 18px 0",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 500, color: WHITE }}>{genLabel}</span>
            <span style={{ flex: 1, textAlign: "center", fontSize: 12, fontWeight: 500, color: WHITE }}>
              {signalLabel}
            </span>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 26, fontWeight: 700, color: confColor, lineHeight: 1 }}>
                {model.confidence}
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: WHITE,
                  textTransform: "uppercase",
                  marginTop: 2,
                }}
              >
                CONFIDENCE
              </div>
            </div>
          </div>

          {/* Title */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              padding: "8px 18px 0",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontSize: 29, fontWeight: 700 }}>{model.ticker}</span>
              <span style={{ fontSize: 19, fontWeight: 700, color: dir.color }}>
                {dir.glyph} {model.direction}
              </span>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{model.strategyName}</div>
              <div style={{ fontSize: 13, fontWeight: 500, marginTop: 2 }}>{model.structureDescriptor}</div>
            </div>
          </div>

          {/* Legs */}
          <div style={{ padding: "11px 18px 0" }}>
            {model.legs.map((leg, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 10,
                  fontSize: 15,
                  paddingBottom: 8,
                  borderBottom: i < model.legs.length - 1 ? `1px solid ${LINE_SOFT}` : "none",
                }}
              >
                <span
                  style={{
                    width: 40,
                    fontWeight: 700,
                    color: leg.side === "SELL" ? RED : GREEN,
                  }}
                >
                  {leg.side}
                </span>
                <span style={{ fontWeight: 700 }}>{leg.expiry}</span>
                <span style={{ fontWeight: 700 }}>{leg.strikeType}</span>
                <span style={{ fontWeight: 500 }}>{leg.deltaLabel}</span>
                <span
                  style={{
                    marginLeft: "auto",
                    width: 64,
                    textAlign: "right",
                    fontWeight: 700,
                  }}
                >
                  {leg.price}
                </span>
              </div>
            ))}
          </div>

          {/* Economics */}
          <div style={{ padding: "0 18px" }}>
            <div
              style={{
                marginLeft: "auto",
                width: 64,
                borderTop: `1px solid ${LINE}`,
                marginTop: 4,
              }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                padding: "6px 0",
                fontSize: 16,
                fontWeight: 700,
              }}
            >
              <span>{row1Label}</span>
              <span
                style={{
                  width: 64,
                  textAlign: "right",
                  color: model.isCredit ? GREEN : RED,
                }}
              >
                {row1Value}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                padding: "6px 0",
                fontSize: 16,
                fontWeight: 700,
              }}
            >
              <span>{row2Label}</span>
              <span
                style={{
                  width: 64,
                  textAlign: "right",
                  color: model.isCredit ? RED : GREEN,
                }}
              >
                {row2Value}
              </span>
            </div>
          </div>

          {/* R:R + Send */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 18px 0",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>
              Risk : Reward{" "}
              <span style={{ fontWeight: 800 }}>{model.riskRewardDisplay}</span>
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
                }}
              >
                SEND TO ORDER →
              </button>
            )}
          </div>

          {/* Plan */}
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
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: AMBER,
                    textTransform: "uppercase",
                    marginBottom: 8,
                  }}
                >
                  Entry
                </div>
                <PlanRow label="Stock" value={model.entryStockBand ?? "—"} />
                <PlanRow label="Fill" value={model.fillBand ?? "—"} />
              </div>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: AMBER,
                    textTransform: "uppercase",
                    marginBottom: 8,
                  }}
                >
                  Exit
                </div>
                <PlanRow
                  label="Profit"
                  value={
                    <>
                      <span style={{ color: GREEN }}>{model.exitPlan.profitPct}%</span>
                      {model.exitPlan.profitPrice && (
                        <span style={{ marginLeft: 7 }}>{model.exitPlan.profitPrice}</span>
                      )}
                    </>
                  }
                />
                <PlanRow
                  label="Stop"
                  value={
                    <>
                      <span style={{ color: RED }}>−{model.exitPlan.stopPct}%</span>
                      {model.exitPlan.stopPrice && (
                        <span style={{ marginLeft: 7 }}>{model.exitPlan.stopPrice}</span>
                      )}
                    </>
                  }
                />
                <PlanRow label="Time" value={model.exitPlan.timeStop || "—"} />
              </div>
            </div>
          )}

          {/* Brief */}
          {(model.whyBullets.length > 0 || model.whatKillsBullets.length > 0) && (
            <div style={{ padding: "12px 18px 4px", borderTop: `1px solid ${LINE}` }}>
              {model.whyBullets.length > 0 && (
                <div style={{ marginBottom: 12 }}>
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

          {/* Report drawer */}
          {model.reportDrawer && (
            <div style={{ borderTop: `1px solid ${LINE}` }}>
              <button
                type="button"
                onClick={() => setReportOpen((o) => !o)}
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
                  style={{
                    transform: reportOpen ? "rotate(90deg)" : "none",
                    transition: "transform 0.2s",
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

          {/* Footer */}
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
              style={{
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
              }}
            >
              {copied ? <Check size={18} /> : <Copy size={18} />}
            </button>
            <button
              type="button"
              onClick={() => void startPlay()}
              disabled={audioLoading || !copyText.trim()}
              aria-label="Listen"
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: SURFACE_2,
                border: "none",
                color: WHITE,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: audioLoading ? "not-allowed" : "pointer",
                opacity: audioLoading ? 0.5 : 1,
              }}
            >
              <Play size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PlanRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        marginBottom: 6,
      }}
    >
      <span style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 700 }}>{value}</span>
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
  collapseStorageKey,
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
      collapseStorageKey={collapseStorageKey}
    />
  );
}
