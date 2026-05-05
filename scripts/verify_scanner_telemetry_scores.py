#!/usr/bin/env python3
"""
Replay scanner v1 composite against strategist_telemetry.full_diagnostic rows.

Requires: psycopg2-binary, requests
Usage:
  DATABASE_URL=... POLYGON_API_KEY=... python3 scripts/verify_scanner_telemetry_scores.py 293 295 296 297 298
"""

from __future__ import annotations

import json
import math
import os
import sys
from datetime import datetime, timezone
from typing import Any

import psycopg2
import requests

THRESHOLD = 55


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def hv_to_vol_points(hv: float | None) -> float | None:
    if hv is None or not math.isfinite(hv) or hv <= 0:
        return None
    return hv * 100 if hv < 1 else hv


def implied_move_one_week_from_iv_decimal(iv_dec: float | None) -> float | None:
    if iv_dec is None or not math.isfinite(iv_dec) or iv_dec <= 0:
        return None
    return iv_dec * math.sqrt(7 / 365) * 100


def first_listed_expiry_on_or_after(sorted_iso: list[str], anchor: str) -> str | None:
    for e in sorted_iso:
        if e >= anchor:
            return e
    return None


def pick_four_curve_points(
    strip: list[dict[str, Any]],
    earnings_ymd: str | None,
    listed_sorted: list[str],
) -> tuple[float | None, float | None, float | None, str | None]:
    pts = [
        p
        for p in strip
        if p.get("atm_iv") is not None and float(p["days_to_exp"]) > 0
    ]
    pts.sort(key=lambda p: float(p["days_to_exp"]))
    if not pts:
        return None, None, None, None
    near = float(pts[0]["atm_iv"])
    if not earnings_ymd or len(earnings_ymd) != 10:
        nxt = float(pts[1]["atm_iv"]) if len(pts) > 1 else None
        far = float(pts[-1]["atm_iv"]) if pts else None
        return near, near, nxt, None

    capture = first_listed_expiry_on_or_after(listed_sorted, earnings_ymd)
    strip_sorted = [p for p in pts]
    before = [p for p in strip_sorted if capture and str(p["expiry"]) < capture]
    after = [p for p in strip_sorted if capture and str(p["expiry"]) > capture]
    capture_pt = next((p for p in strip_sorted if capture and str(p["expiry"]) == capture), None)

    pre_event = float(before[-1]["atm_iv"]) if before else near
    event_iv = (
        float(capture_pt["atm_iv"]) if capture_pt and capture_pt.get("atm_iv") is not None else None
    )

    return near, pre_event, event_iv, capture


def score_catalyst_term_shape(
    strip: list[dict[str, Any]],
    earnings_ymd: str | None,
    listed_sorted: list[str],
) -> tuple[float, str | None]:
    near, pre_e, event_iv, capture = pick_four_curve_points(strip, earnings_ymd, listed_sorted)
    if event_iv is None or pre_e is None:
        return 0.0, None
    kink = event_iv - pre_e
    score = 0.0
    if kink > 0:
        if kink <= 5:
            score = kink * 6
        elif kink <= 15:
            score = 30 + (kink - 5) * 4
        else:
            score = min(100, 70 + (kink - 15) * 2)
    strip_sorted = sorted(
        [p for p in strip if p.get("atm_iv") is not None and float(p["days_to_exp"]) > 0],
        key=lambda p: float(p["days_to_exp"]),
    )
    if capture:
        idx = next((i for i, p in enumerate(strip_sorted) if str(p["expiry"]) == capture), -1)
        if idx >= 0:
            prev_iv = float(strip_sorted[idx - 1]["atm_iv"]) if idx > 0 else None
            next_iv = float(strip_sorted[idx + 1]["atm_iv"]) if idx < len(strip_sorted) - 1 else None
            ev_iv = float(strip_sorted[idx]["atm_iv"]) if strip_sorted[idx].get("atm_iv") is not None else None
            if prev_iv is not None and next_iv is not None and ev_iv is not None:
                if ev_iv < prev_iv and ev_iv < next_iv:
                    score *= 0.35
    score = clamp(score, 0, 100)
    reason = (
        f"earnings-capture kink {kink:.1f} vol pts vs pre-event @ {capture}"
        if score > 50 and capture
        else (
            f"earnings-capture kink {kink:.1f} vol pts vs pre-event"
            if score > 50
            else None
        )
    )
    return score, reason


def get_iv_rv_points(
    strip: list[dict[str, Any]],
    earnings_ymd: str | None,
    listed_sorted: list[str],
) -> tuple[float | None, float | None, float | None]:
    near, pre_e, ev, _ = pick_four_curve_points(strip, earnings_ymd, listed_sorted)
    return near, pre_e, ev


def score_iv_vs_realized_multi(
    front: float | None,
    pre_e: float | None,
    event_iv: float | None,
    hv20: float | None,
    hv30: float | None,
) -> float:
    hv20p = hv_to_vol_points(hv20)
    hv30p = hv_to_vol_points(hv30)
    gaps: list[float] = []

    def push(iv: float | None, hv: float | None) -> None:
        if iv is not None and hv is not None and hv > 0:
            gaps.append(iv - hv)

    push(front, hv20p)
    push(front, hv30p)
    push(pre_e, hv20p)
    push(pre_e, hv30p)
    push(event_iv, hv20p)
    push(event_iv, hv30p)
    pos = [g for g in gaps if g > 0]
    if not pos:
        return 0.0
    max_gap = max(pos)
    return clamp(max_gap * 4.5, 0, 100)


def score_skew(skew_pts: float | None) -> float:
    if skew_pts is None or not math.isfinite(skew_pts):
        return 0.0
    a = abs(skew_pts)
    if a < 2:
        s = 0.0
    elif a < 5:
        s = (a - 2) * 15
    elif a < 10:
        s = 45 + (a - 5) * 8
    else:
        s = min(100, 85 + (a - 10) * 2)
    return min(100, s)


def macro_density_from_telemetry(
    macro_events: list[dict[str, Any]],
    start_ymd: str,
    end_ymd: str | None,
) -> tuple[int, float]:
    if not end_ymd:
        return 0, 0.0
    n = 0
    for ev in macro_events:
        d = ev.get("date")
        imp = ev.get("importance")
        if not isinstance(d, str) or imp not in ("HIGH", "MEDIUM"):
            continue
        if start_ymd <= d <= end_ymd:
            n += 1
    score = clamp(n * 12, 0, 60)
    return n, score


def desk_end_iso(avail: list[str], prefs_max: int = 45) -> str | None:
    best = None
    best_dte = -1
    now_ms = datetime.now(timezone.utc).timestamp() * 1000
    for exp in sorted(avail):
        try:
            exp_ms = datetime.fromisoformat(exp + "T16:00:00-05:00").timestamp() * 1000
        except ValueError:
            continue
        dte = max(0, round((exp_ms - now_ms) / 86400000))
        if dte <= 0 or dte > prefs_max:
            continue
        if dte > best_dte:
            best_dte = dte
            best = exp
    return best


def build_earnings_edge_polygon(sym: str) -> float:
    key = os.environ.get("POLYGON_API_KEY") or ""
    if not key:
        return 0.0
    url = f"https://api.polygon.io/benzinga/v1/earnings?ticker={sym}&limit=20&apiKey={key}"
    try:
        r = requests.get(url, timeout=25)
        if not r.ok:
            return 0.0
        rows = r.json().get("results") or []
    except OSError:
        return 0.0

    usable = 0
    gap_abs: list[float] = []
    dirs: list[int] = []
    ratios: list[float] = []

    for row in rows[:8]:
        pr = row.get("price_reaction") or {}
        ivr = row.get("iv_reaction") or {}
        g = pr.get("gap_open_pct")
        if g is None:
            continue
        usable += 1
        gap_abs.append(abs(float(g)))
        dirs.append(1 if float(g) > 0 else -1 if float(g) < 0 else 0)
        implied = ivr.get("implied_move_at_close_pct")
        actual = abs(float(g)) if g is not None else None
        if implied is not None and actual is not None and float(implied) > 0:
            ratios.append(float(implied) / actual)

    if usable == 0:
        return 0.0

    def avg(xs: list[float]) -> float:
        return sum(xs) / len(xs) if xs else 0.0

    score = 0.0
    if gap_abs:
        score += clamp(avg(gap_abs) * 1.1, 0, 22)
    streak = 3 if usable >= 4 and len(set(dirs[:4])) == 1 else 0
    if streak:
        score += 18
    score = clamp(score, 0, 100)
    return score


def score_flow_quality(
    tape_q: str,
    ask_n: float,
    threshold: float,
    totals: dict[str, Any] | None,
    top_prints: list[dict[str, Any]] | None,
) -> float:
    if tape_q in ("not_run", "degraded") or ask_n < threshold:
        return 0.0
    t = totals or {}
    total_p = int(t.get("totalPrints") or 0)
    known_cov = (
        ((int(t.get("askCount") or 0) + int(t.get("bidCount") or 0)) / total_p) if total_p > 0 else 0.0
    )
    ask_share = float(t.get("askNotionalUsd") or 0) + float(t.get("bidNotionalUsd") or 0) + float(
        t.get("midNotionalUsd") or 0
    ) + float(t.get("unknownNotionalUsd") or 0)
    ask_share = ask_n / ask_share if ask_share > 0 else 0.0
    mult = clamp(ask_n / threshold, 1, 3)
    base = min(100, ask_share * 100 * (mult / 3))
    cov_f = clamp(0.55 + known_cov * 0.45, 0, 1)
    repeat_bonus = 0
    if top_prints:
        mp: dict[str, int] = {}
        for p in top_prints:
            if not p.get("isBlock"):
                continue
            side = p.get("side")
            if side not in ("ask", "bid"):
                continue
            k = f'{p.get("strike")}|{side}'
            mp[k] = mp.get(k, 0) + 1
        mx = max(mp.values()) if mp else 0
        if mx >= 3:
            repeat_bonus = 12
        elif mx == 2:
            repeat_bonus = 6
    sc = clamp(base * cov_f + repeat_bonus, 0, 100)
    mid_share = (int(t.get("midCount") or 0) / total_p) if total_p > 0 else 0.0
    if mid_share > 0.4:
        sc *= clamp(1 - (mid_share - 0.4) * 2.2, 0.35, 1)
    return sc


def liquidity_from_curated(curated: list[dict[str, Any]], spot: float) -> float:
    if spot <= 0 or not curated:
        return 0.0
    rows = sorted(curated, key=lambda c: float(c.get("dte") or 9999))
    front = rows[0] if rows else None
    if not front:
        return 0.0
    lo, hi = spot * 0.95, spot * 1.05
    max_oi = 0
    for strike_row in front.get("strikes") or []:
        if not isinstance(strike_row, dict):
            continue
        strike = strike_row.get("strike")
        if strike is None:
            continue
        for side in ("call", "put"):
            leg = strike_row.get(side)
            if isinstance(leg, dict) and leg.get("oi") is not None:
                oi = int(leg["oi"])
                if lo <= float(strike) <= hi:
                    max_oi = max(max_oi, oi)
    return clamp(math.log10(1 + max_oi) * 14, 0, 62)


def score_implied_richness(current_pct: float | None, hist_iv_pres: list[float]) -> float:
    if current_pct is None or not hist_iv_pres:
        return 0.0
    sorted_hist = sorted(hist_iv_pres)
    n = len(sorted_hist)
    med = sorted_hist[n // 2] if n % 2 == 1 else (sorted_hist[n // 2 - 1] + sorted_hist[n // 2]) / 2
    if med <= 0:
        return 0.0
    below = sum(1 for x in sorted_hist if x < current_pct)
    pct_rank = below / n
    ratio = current_pct / med
    return clamp((ratio - 1) * 55 + pct_rank * 28, 0, 100)


def composite_v1(c: dict[str, float]) -> float:
    return clamp(
        c["catalyst_term_shape"] * 0.3
        + c["iv_vs_realized"] * 0.25
        + c["flow_quality"] * 0.2
        + c["earnings_edge_signature"] * 0.15
        + c["skew_anomaly"] * 0.05
        + c["macro_density_in_window"] * 0.05,
        0,
        100,
    )


SUB_HIGH = 65


def surfaced_high(comps: dict[str, float]) -> list[str]:
    keys = [
        "catalyst_term_shape",
        "iv_vs_realized",
        "flow_quality",
        "earnings_edge_signature",
        "skew_anomaly",
        "macro_density_in_window",
        "implied_move_richness",
        "liquidity_anchor_score",
    ]
    return [k for k in keys if comps.get(k, 0) >= SUB_HIGH]


def run_one(cur: Any, tid: int) -> None:
    cur.execute(
        "SELECT ticker, full_diagnostic::text FROM strategist_telemetry WHERE id = %s",
        (tid,),
    )
    row = cur.fetchone()
    if not row:
        print(json.dumps({"telemetry_id": tid, "error": "not found"}))
        return
    sym, fd_raw = row
    fd = json.loads(fd_raw) if fd_raw else {}
    pkg = fd.get("inputDataPackage") or {}
    dqs = pkg.get("dataQualitySummary") or {}
    ocs = pkg.get("optionsChainSummary") or {}
    flow_obj = pkg.get("polygonFlowHighlights") or {}
    tape = flow_obj.get("sessionTape")
    tb = pkg.get("tapeBackfill") or {}

    ne = pkg.get("nextEarnings") or {}
    earnings_date = ne.get("earningsDate")
    if isinstance(earnings_date, str) and len(earnings_date) > 10:
        earnings_date = earnings_date[:10]

    rv = pkg.get("realizedVol") or {}
    hv20 = rv.get("hv20")
    hv30 = rv.get("hv30")
    hv20f = float(hv20) if hv20 is not None else None
    hv30f = float(hv30) if hv30 is not None else None

    spot = float(pkg.get("price") or 0) or 100.0

    strip: list[dict[str, Any]] = []
    for p in ocs.get("termStructure5pt") or []:
        if not isinstance(p, dict):
            continue
        strip.append(
            {
                "expiry": p.get("expiry"),
                "days_to_exp": float(p.get("daysToExpiry") or 0),
                "atm_iv": float(p["atmIV"]) if p.get("atmIV") is not None else None,
            }
        )

    listed = sorted([x for x in (pkg.get("availableExpirations") or []) if isinstance(x, str)])

    skew_obj = ocs.get("skew25Delta")
    skew_reason = str(ocs.get("skew25DeltaReason") or "")
    skew_pts = None
    if skew_reason == "clean_25d_first_expiry" and isinstance(skew_obj, dict):
        sp = skew_obj.get("skewPoints")
        skew_pts = float(sp) if sp is not None else None

    ts_score, _ = score_catalyst_term_shape(strip, earnings_date, listed)
    f, pe, ev = get_iv_rv_points(strip, earnings_date, listed)
    iv_rv = score_iv_vs_realized_multi(f, pe, ev, hv20f, hv30f)
    sk = score_skew(skew_pts)

    desk_end = desk_end_iso(listed, 45)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    macro_events = pkg.get("macroEventsInPositionWindow") or []
    if not isinstance(macro_events, list):
        macro_events = []
    mc_n, mc_sc = macro_density_from_telemetry(macro_events, today, desk_end)

    earn_edge = build_earnings_edge_polygon(sym)

    imp = ocs.get("impliedMove")
    implied_front = float(imp["percentOfSpot"]) if isinstance(imp, dict) and imp.get("percentOfSpot") is not None else None

    hist_moves: list[float] = []
    key = os.environ.get("POLYGON_API_KEY") or ""
    if key:
        try:
            url = f"https://api.polygon.io/benzinga/v1/earnings?ticker={sym}&limit=20&apiKey={key}"
            er = requests.get(url, timeout=25)
            if er.ok:
                for row in er.json().get("results") or []:
                    ivp = (row.get("iv_reaction") or {}).get("iv_at_close_pre_earnings")
                    if ivp is None:
                        continue
                    ivf = float(ivp)
                    dec = ivf / 100 if ivf > 1 else ivf
                    m = implied_move_one_week_from_iv_decimal(dec)
                    if m is not None:
                        hist_moves.append(m)
        except OSError:
            pass

    move_r = score_implied_richness(implied_front, hist_moves[:24])
    liq = liquidity_from_curated(pkg.get("curatedExpirations") or [], spot)

    totals = tape.get("aggressorSessionTotals") if isinstance(tape, dict) else None
    ask_n = float(totals.get("askNotionalUsd") or 0) if isinstance(totals, dict) else 0.0
    tape_kind = tape.get("tapeKind") if isinstance(tape, dict) else None
    src = tape.get("sessionAggregateSource") if isinstance(tape, dict) else None
    if tape_kind == "live" and src == "live_raw_trades":
        tq = "complete"
    elif tape_kind == "eod_fallback":
        tq = "partial"
    else:
        tq = "not_run"

    th = 100_000 if sym.upper() in ("NVDA", "AAPL", "MSFT") else 50_000
    top_prints = tape.get("topPrints") if isinstance(tape, dict) else None
    fl = score_flow_quality(tq, ask_n, th, totals if isinstance(totals, dict) else None, top_prints if isinstance(top_prints, list) else None)

    comps = {
        "catalyst_term_shape": ts_score,
        "iv_vs_realized": iv_rv,
        "flow_quality": fl,
        "earnings_edge_signature": earn_edge,
        "skew_anomaly": sk,
        "macro_density_in_window": mc_sc,
        "implied_move_richness": move_r,
        "liquidity_anchor_score": liq,
    }

    iv_clean = float(dqs.get("ivCleanedRatio") or 1)
    flags = dqs.get("flags") or []
    iv_contam = "iv_contamination_elevated" in flags
    tape_partial = tb.get("status") == "partial" or "tape_backfill_incomplete" in flags

    curated = pkg.get("curatedExpirations") or []
    cap_exp = None
    if isinstance(curated, list):
        for c in curated:
            if isinstance(c, dict) and c.get("bucket") == "earnings_capture":
                cap_exp = c.get("expiration")
                break
    cap_atm = None
    if cap_exp:
        for p in strip:
            if str(p.get("expiry")) == str(cap_exp):
                cap_atm = p.get("atm_iv")
                break

    no_clean = earnings_date is not None and cap_exp is not None and cap_atm is None

    disqual: list[str] = []
    if iv_clean < 0.5 or iv_contam:
        disqual.append("iv_contamination")
    if tape_partial:
        disqual.append("tape_partial")
    if no_clean:
        disqual.append("no_clean_earnings_expiry")

    comp = 0.0 if disqual else composite_v1(comps)

    out = {
        "telemetry_id": tid,
        "ticker": sym,
        "scanner_composite_v1": round(comp, 2),
        "candidate_threshold": THRESHOLD,
        "below_threshold": comp < THRESHOLD,
        "disqual_flags": disqual,
        "component_scores": {k: round(v, 2) for k, v in comps.items()},
        "surfaced_subscores_high": surfaced_high(comps),
    }
    print(json.dumps(out, indent=2))


def main() -> None:
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL required", file=sys.stderr)
        sys.exit(1)
    ids = [int(x) for x in sys.argv[1:] if x.isdigit()]
    if not ids:
        ids = [293, 295, 296, 297, 298]

    conn = psycopg2.connect(db_url)
    try:
        cur = conn.cursor()
        for tid in ids:
            run_one(cur, tid)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
