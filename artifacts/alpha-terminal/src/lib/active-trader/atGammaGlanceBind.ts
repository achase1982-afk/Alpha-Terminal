import type { ZoneModel } from "./zonesModel";

/** A glance older than this is shown with its sample time and is not fresh. */
export const GAMMA_GLANCE_FRESH_MS = 60_000;

export type GammaGlanceBody = {
  zones?: ZoneModel;
  unavailable?: boolean;
  sessionClosed?: boolean;
  glanceCaption?: string;
  source?: string;
  asOfMs?: number;
};

export type GammaGlanceEvent = {
  activeTicker: string;
  requestTicker: string;
  requestId: number;
  currentId: number;
  body: GammaGlanceBody | null;
  error: boolean;
  nowMs: number;
};

function stampGlance(body: GammaGlanceBody, nowMs: number): GammaGlanceBody {
  const zones = body.zones;
  if (!zones) return body;
  const age = typeof body.asOfMs === "number" ? nowMs - body.asOfMs : null;
  const fresh = body.source === "unusual_whales" && age != null && age >= 0 && age <= GAMMA_GLANCE_FRESH_MS;
  const asOf = zones.asOfLabel && zones.asOfLabel !== "\u2014" ? zones.asOfLabel : "";
  const label = body.glanceCaption ?? (fresh ? "Gamma" : asOf ? `Gamma \u00b7 ${asOf}` : "Gamma");
  return {
    ...body,
    glanceCaption: label,
    zones: {
      ...zones,
      glanceCaption: zones.glanceCaption ?? label,
      levelSource: "unusual_whales",
      levelFresh: fresh,
    },
  };
}

/**
 * Apply a gamma response only when it belongs to the ticker that is on screen.
 * A late or failed response for the previous ticker clears rather than sticking.
 * A late poll for the same ticker leaves the newer sample in place.
 */
export function reduceGammaGlance(prev: GammaGlanceBody | null, event: GammaGlanceEvent): GammaGlanceBody | null {
  if (event.requestTicker !== event.activeTicker) return null;
  if (event.requestId !== event.currentId) return event.requestTicker === event.activeTicker ? prev : null;
  if (event.error || !event.body || event.body.unavailable || !event.body.zones) return null;
  return stampGlance(event.body, event.nowMs);
}

/** Chain walls are a fallback. They keep the chain clock and are not a live gamma sample. */
export function chainFallbackZones(model: ZoneModel): ZoneModel {
  const asOf = model.asOfLabel && model.asOfLabel !== "\u2014" ? model.asOfLabel : "";
  const label = asOf ? `Chain \u00b7 ${asOf}` : "Chain";
  return {
    ...model,
    levelSource: "chain",
    levelFresh: false,
    glanceCaption: label,
  };
}
