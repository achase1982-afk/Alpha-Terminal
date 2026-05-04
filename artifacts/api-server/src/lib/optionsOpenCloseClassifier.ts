/**
 * Open / close classification from Polygon unified trade `conditions` integers.
 *
 * Source of truth for condition semantics:
 * - Polygon REST: GET /v3/reference/conditions (asset_class=options, data_type=trade)
 *   Documents Massive unified condition ids and maps from SIP (OPRA) letters via `sip_mapping`.
 *   Docs index: https://polygon.io/docs/rest/options/market-operations/condition-codes
 *
 * Verification note (2026-05): The full options trade `sale_condition` list returned by
 * Polygon's reference API contains mechanics (auction, cross, ISO, extended hours, canceled,
 * opening-trade indicators, etc.) but **does not** include explicit buy-to-open / sell-to-close
 * style descriptors in condition names or descriptions. Without SIP-letter parsing on each trade,
 * we cannot map unified ids to opening vs closing **positions** from conditions alone.
 *
 * Therefore every documented options trade sale_condition id currently resolves to "unknown"
 * here. When Polygon adds explicit open/close semantics to condition metadata, extend the maps
 * below using their published descriptions — do not invent codes.
 */

export type OpenCloseTag = "open" | "close" | "unknown";

/** Unified Massive condition ids that explicitly indicate opening vs closing a position (none yet per Polygon reference data). */
export const OPEN_POSITION_CONDITION_IDS = new Set<number>([]);

/** Unified Massive condition ids that explicitly indicate closing a position (none yet per Polygon reference data). */
export const CLOSE_POSITION_CONDITION_IDS = new Set<number>([]);

function classifySingleCondition(id: number): OpenCloseTag {
  if (OPEN_POSITION_CONDITION_IDS.has(id)) return "open";
  if (CLOSE_POSITION_CONDITION_IDS.has(id)) return "close";
  return "unknown";
}

/**
 * Classify open vs close from OPRA/Polygon trade condition codes (Massive unified integers).
 * Empty or unrecognized codes yield "unknown".
 */
export function classifyOpenCloseFromOpraConditions(
  conditions: number[] | null | undefined,
): OpenCloseTag {
  if (!conditions || conditions.length === 0) return "unknown";

  let sawOpen = false;
  let sawClose = false;
  let sawUnknown = false;

  for (const c of conditions) {
    if (!Number.isFinite(c)) continue;
    const t = classifySingleCondition(c);
    if (t === "open") sawOpen = true;
    else if (t === "close") sawClose = true;
    else sawUnknown = true;
  }

  if (sawOpen && sawClose) return "unknown";
  if (sawOpen) return "open";
  if (sawClose) return "close";
  if (sawUnknown) return "unknown";
  return "unknown";
}
