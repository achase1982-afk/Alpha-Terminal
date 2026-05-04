#!/usr/bin/env python3
"""
Recompute IV30 + IVR for LC130 on a fixed session date after widening the
selectIv30d DTE window (mirrors dailySnapshot.ts logic in Python).

Usage:
  DATABASE_URL=... python3 scripts/recompute-iv30-ivr-lc130-after-dte-window.py

Requires: psycopg2-binary (pip install psycopg2-binary).
"""
from __future__ import annotations

import json
import math
import os
import sys
from typing import Any, Iterable

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    print("Install psycopg2-binary: pip install psycopg2-binary", file=sys.stderr)
    raise

SESSION_DATE = "2026-05-04"

# Must match dailySnapshot.ts after the DTE window change
IV30_MIN_DTE = 15
IV30_MAX_DTE = 45
IV30_ATM_MONEYNESS = 0.05
IV30_MIN_OPEN_INTEREST = 10
IV30_MIN_VOLUME = 1
IV30_MAX_REL_SPREAD = 0.35

IV_MIN_VALID = 0.01
IV_MAX_VALID = 5.0
IVR_MIN_HISTORY = 60
IVR_LOOKBACK = 252
HV_WINDOW = 30
ANNUALIZE = 252 ** 0.5

BROAD_INDEX = {"SPY", "QQQ", "DIA", "IWM", "VTI", "VOO"}
SECTOR_ETF_SET = {"XLE", "XLF", "XLK", "XLU", "XLV", "XLI", "XLP", "XLY", "XLB", "XLC", "XLRE"}


def vrp_multiplier(sym: str) -> float:
    s = sym.upper()
    if s in BROAD_INDEX:
        return 1.08
    if s in SECTOR_ETF_SET:
        return 1.12
    return 1.20


def compute_today_hv_proxy(cur, sym: str, as_of: str) -> float | None:
    cur.execute(
        """
        SELECT close::float AS c FROM equity_daily
        WHERE symbol = %s AND date <= %s::date AND close IS NOT NULL
        ORDER BY date DESC
        LIMIT %s
        """,
        (sym.upper(), as_of, HV_WINDOW + 1),
    )
    rows = cur.fetchall()
    if len(rows) < HV_WINDOW + 1:
        return None
    closes = [float(r["c"]) for r in reversed(rows)]
    rets: list[float] = []
    for i in range(1, len(closes)):
        prev, curv = closes[i - 1], closes[i]
        if prev <= 0 or curv <= 0:
            return None
        rets.append(math.log(curv / prev))

    mean = sum(rets) / len(rets)
    var = sum((x - mean) ** 2 for x in rets) / (len(rets) - 1)
    hv = math.sqrt(var) * ANNUALIZE
    return hv * vrp_multiplier(sym)


# Mirrors `LIQUID_CORE_SYMBOL_STRINGS` in src/data/liquidCore130.ts
LC130 = [
    "SPY", "QQQ", "IWM", "DIA", "TQQQ", "GLD", "SLV", "USO", "NVDA", "TSLA", "AAPL", "AMZN", "META", "MSFT", "AMD", "AVGO", "GOOGL", "GOOG", "SMCI", "PLTR", "CRWD", "PANW", "MU", "MRVL", "INTC", "QCOM", "AMAT", "LRCX", "KLAC", "NXPI", "TXN", "ADI", "MCHP", "HOOD", "COIN", "RIVN", "DKNG", "ROKU", "PATH", "SNOW", "DDOG", "HUBS", "SHOP", "CRDO", "APP", "NFLX", "JPM", "BAC", "GS", "SCHW", "BLK", "MS", "AXP", "COF", "PNC", "TFC", "USB", "FITB", "HBAN", "RF", "CFG", "BK", "LLY", "UNH", "JNJ", "ABBV", "PFE", "MRK", "AMGN", "GILD", "VRTX", "REGN", "BMY", "MDT", "SYK", "ISRG", "BSX", "ELV", "CI", "HUM", "COST", "WMT", "PG", "KO", "PEP", "MCD", "NKE", "TGT", "KR", "DG", "DLTR", "BURL", "ROST", "TJX", "XOM", "CVX", "COP", "OXY", "SLB", "BKR", "EOG", "FANG", "DVN", "MPC", "PSX", "VLO", "OKE", "TRGP", "LNG", "CAT", "HON", "RTX", "LMT", "NOC", "BA", "DAL", "UAL", "LUV", "UNP", "CSX", "NSC", "GEHC", "TDG", "PCAR", "V", "MA", "CRM", "NOW", "ACN", "DIS",
]

SEVENTEEN = [
    "BK", "BKR", "CFG", "ELV", "FANG", "HUBS", "KLAC", "MPC", "NOC", "NSC", "NXPI", "PCAR", "RF", "SYK", "TDG", "TFC", "TRGP",
]


def normalize_iv(raw: float | None) -> float | None:
    if raw is None:
        return None
    if not isinstance(raw, (int, float)) or raw != raw:  # NaN
        return None
    v = float(raw)
    if v <= -100:
        return None
    if v > IV_MAX_VALID:
        v = v / 100.0
    if v < IV_MIN_VALID or v > IV_MAX_VALID:
        return None
    return v


def median_of(vals: list[float]) -> float:
    if not vals:
        return 0.0
    s = sorted(vals)
    m = len(s) // 2
    if len(s) % 2 == 0:
        return (s[m - 1] + s[m]) / 2.0
    return float(s[m])


def select_iv30d(spot: float, rows: Iterable[dict[str, Any]]) -> float | None:
    if spot <= 0:
        return None
    candidates: list[dict[str, Any]] = []
    for r in rows:
        iv = normalize_iv(r.get("implied_volatility"))
        if iv is None:
            continue
        dte = int(r["dte"]) if r.get("dte") is not None else 0
        bid = r.get("bid")
        ask = r.get("ask")
        bid_f = float(bid) if bid is not None else None
        ask_f = float(ask) if ask is not None else None
        mid = None
        rel_spread = None
        if bid_f is not None and ask_f is not None and bid_f > 0 and ask_f > 0:
            mid = (bid_f + ask_f) / 2.0
            rel_spread = (ask_f - bid_f) / mid
        vol = float(r.get("volume") or r.get("daily_volume") or 0)
        oi = float(r.get("open_interest") or 0)
        strike = float(r["strike"])
        mny = abs(strike - spot) / spot
        if not (IV30_MIN_DTE <= dte <= IV30_MAX_DTE):
            continue
        if mny > IV30_ATM_MONEYNESS:
            continue
        if rel_spread is not None and rel_spread > IV30_MAX_REL_SPREAD:
            continue
        if not (oi >= IV30_MIN_OPEN_INTEREST or vol >= IV30_MIN_VOLUME):
            continue
        candidates.append({"iv": iv, "dte": dte, "mny": mny})

    if not candidates:
        return None
    candidates.sort(key=lambda c: abs(c["dte"] - 30) + c["mny"] * 100.0)
    selected = [c["iv"] for c in candidates[:6]]
    return median_of(selected)


def count_valid_iv(cur, sym: str, date: str, column: str) -> int:
    cur.execute(
        f"""
        SELECT COUNT(*)::int AS c
        FROM equity_daily
        WHERE symbol = %s AND date <= %s::date
          AND {column} IS NOT NULL
          AND {column} >= %s AND {column} <= %s
        """,
        (sym, date, IV_MIN_VALID, IV_MAX_VALID),
    )
    return int(cur.fetchone()["c"])


def compute_ivr(cur, sym: str, date: str, today_iv: float | None) -> float | None:
    sym_u = sym.upper()
    real_cnt = count_valid_iv(cur, sym_u, date, "iv_30d")
    proxy_cnt = count_valid_iv(cur, sym_u, date, "iv_30d_proxy")
    use_proxy = real_cnt < IVR_MIN_HISTORY and proxy_cnt >= IVR_MIN_HISTORY

    if use_proxy and today_iv is not None:
        today_iv = None  # ignore chain override when ranking proxy series

    current_iv = today_iv
    if current_iv is None:
        cur.execute(
            """
            SELECT iv_30d, iv_30d_proxy FROM equity_daily
            WHERE symbol = %s AND date = %s::date LIMIT 1
            """,
            (sym_u, date),
        )
        row = cur.fetchone()
        if not row:
            return None
        if use_proxy:
            v = row["iv_30d_proxy"]
            current_iv = float(v) if v is not None else None
            if current_iv is None:
                current_iv = compute_today_hv_proxy(cur, sym_u, date)
        else:
            v = row["iv_30d"]
            current_iv = float(v) if v is not None else None

    current_iv = normalize_iv(current_iv)
    if current_iv is None:
        return None

    col = "iv_30d_proxy" if use_proxy else "iv_30d"
    cur.execute(
        f"""
        SELECT {col} AS iv FROM equity_daily
        WHERE symbol = %s AND date < %s::date
          AND {col} IS NOT NULL AND {col} >= %s AND {col} <= %s
        ORDER BY date DESC
        LIMIT %s
        """,
        (sym_u, date, IV_MIN_VALID, IV_MAX_VALID, IVR_LOOKBACK),
    )
    hist = [float(r["iv"]) for r in cur.fetchall() if r["iv"] is not None]
    if len(hist) < IVR_MIN_HISTORY:
        return None
    iv_min = min(hist)
    iv_max = max(hist)
    if iv_max <= iv_min:
        return None
    raw = (current_iv - iv_min) / (iv_max - iv_min) * 100.0
    return max(0.0, min(100.0, round(raw)))


def fetch_chain(cur, sym: str, date: str) -> list[dict[str, Any]]:
    cur.execute(
        """
        SELECT strike, dte, bid, ask, volume, open_interest, implied_volatility
        FROM options_chain_daily
        WHERE underlying_symbol = %s AND date = %s::date
        """,
        (sym.upper(), date),
    )
    return list(cur.fetchall())


def fetch_flow(cur, sym: str, date: str) -> list[dict[str, Any]]:
    cur.execute(
        """
        SELECT strike, dte, bid, ask, daily_volume AS volume, open_interest, implied_volatility
        FROM options_flow_per_strike
        WHERE underlying_symbol = %s AND date = %s::date
        """,
        (sym.upper(), date),
    )
    return list(cur.fetchall())


def main() -> None:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL required", file=sys.stderr)
        sys.exit(1)

    conn = psycopg2.connect(url)
    conn.autocommit = False

    results_17: dict[str, dict[str, Any]] = {}
    regression: dict[str, Any] = {"max_abs_diff": 0.0, "changed_count": 0, "unchanged_count": 0}

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        # Snapshot before IV30 for LC130 on session date
        cur.execute(
            """
            SELECT symbol, iv_30d::float FROM equity_daily
            WHERE date = %s::date AND symbol = ANY(%s)
            """,
            (SESSION_DATE, LC130),
        )
        before_iv = {r["symbol"].upper(): (float(r["iv_30d"]) if r["iv_30d"] is not None else None) for r in cur.fetchall()}

        cur.execute(
            "SELECT symbol, close::float AS spot FROM equity_daily WHERE date = %s::date AND symbol = ANY(%s)",
            (SESSION_DATE, LC130),
        )
        spots = {r["symbol"].upper(): float(r["spot"]) for r in cur.fetchall()}

        for sym in LC130:
            spot = spots.get(sym.upper())
            if spot is None or spot <= 0:
                continue
            chain = fetch_chain(cur, sym, SESSION_DATE)
            flow = fetch_flow(cur, sym, SESSION_DATE)
            iv_chain = select_iv30d(spot, chain)
            iv_flow = select_iv30d(spot, flow)
            if iv_flow is not None:
                iv_new = iv_flow
                src = "flow"
            elif iv_chain is not None:
                iv_new = iv_chain
                src = "chain"
            else:
                iv_new = None
                src = None

            if iv_new is None:
                continue

            cur.execute(
                """
                UPDATE equity_daily
                SET iv_30d = %s, ivr_source = %s
                WHERE symbol = %s AND date = %s::date
                """,
                (iv_new, src, sym.upper(), SESSION_DATE),
            )

            ivr = compute_ivr(cur, sym, SESSION_DATE, iv_new)
            cur.execute(
                "UPDATE equity_daily SET ivr = %s WHERE symbol = %s AND date = %s::date",
                (ivr, sym.upper(), SESSION_DATE),
            )

            if sym.upper() in {s.upper() for s in SEVENTEEN}:
                results_17[sym.upper()] = {"iv_30d": iv_new, "ivr": ivr, "ivr_source": src}

        # Regression: symbols that had iv_30d before
        cur.execute(
            """
            SELECT symbol, iv_30d::float AS iv FROM equity_daily
            WHERE date = %s::date AND symbol = ANY(%s) AND iv_30d IS NOT NULL
            """,
            (SESSION_DATE, LC130),
        )
        after_iv = {r["symbol"].upper(): float(r["iv"]) for r in cur.fetchall()}

        for s, b in before_iv.items():
            if b is None:
                continue
            a = after_iv.get(s)
            if a is None:
                continue
            d = abs(a - b)
            regression["max_abs_diff"] = max(regression["max_abs_diff"], d)
            if d > 1e-9:
                regression["changed_count"] += 1
            else:
                regression["unchanged_count"] += 1

    conn.commit()
    conn.close()

    out = {
        "session_date": SESSION_DATE,
        "seventeen": results_17,
        "regression_iv30_lc130_had_value": regression,
    }
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
