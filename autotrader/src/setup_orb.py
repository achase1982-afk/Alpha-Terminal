"""
ORB (Opening Range Breakout) signal logic.

Entry rule:
  - After 9:45 ET, a 1-min bar closes above OR_high.
  - RVOL at that moment >= min_rvol.
  - Entry limit = breakout_close × (1 + limit_buffer_pct).
  - Stop = OR_low (or entry − atr_k × ATR if use_or_low_stop=false).
  - Target = entry + r_target × (entry − stop).

Returns an entry dict or None.
"""
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Optional

from .features import compute_or_levels, compute_rvol, compute_atr, bar_et

ET = ZoneInfo("America/New_York")


def check_orb_entry(
    bars: list,
    config: dict,
    avg_daily_volume: float,
    already_entered: bool = False,
) -> Optional[dict]:
    """
    Evaluate the ORB entry condition against the current bar set.
    Returns entry parameters dict if a new trade should be entered, else None.
    """
    if already_entered:
        return None

    now = datetime.now(tz=ET)

    entry_after_str = config["orb"]["entry_after"]
    eh, em = map(int, entry_after_str.split(":"))
    entry_after = now.replace(hour=eh, minute=em, second=0, microsecond=0)

    if now < entry_after:
        return None  # Still inside the opening range window

    or_minutes = config["orb"]["or_minutes"]
    or_levels = compute_or_levels(bars, or_minutes)
    if or_levels is None:
        return None  # Opening range not yet complete

    or_high = or_levels["or_high"]
    or_low  = or_levels["or_low"]

    # All bars that closed after the OR window
    post_or = [b for b in bars if bar_et(b) >= entry_after]
    if not post_or:
        return None

    # Find the first bar that closed above OR_high (confirmed breakout)
    breakout_bar = next((b for b in post_or if b["close"] > or_high), None)
    if breakout_bar is None:
        return None

    # Volume filter — check RVOL across all session bars at this moment
    rvol = compute_rvol(bars, avg_daily_volume)
    if rvol < config["entry"]["min_rvol"]:
        return None

    atr = compute_atr(bars)

    close = breakout_bar["close"]
    buf = config["entry"].get("limit_buffer_pct", 0.001)
    entry_limit = round(close * (1.0 + buf), 2)

    if config["entry"].get("use_or_low_stop", True):
        stop = round(or_low, 2)
    else:
        atr_k = config["entry"].get("atr_k", 1.0)
        stop = round(entry_limit - atr_k * atr, 2) if atr else round(or_low, 2)

    risk = entry_limit - stop
    if risk <= 0:
        return None

    r_target = config["entry"]["r_target"]
    target = round(entry_limit + r_target * risk, 2)

    max_dollars = config["position"]["max_dollars"]
    shares = max(1, int(max_dollars / entry_limit))

    return {
        "entry_limit":        entry_limit,
        "stop":               stop,
        "target":             target,
        "shares":             shares,
        "rvol":               round(rvol, 3),
        "atr":                round(atr, 4) if atr else None,
        "or_high":            round(or_high, 2),
        "or_low":             round(or_low, 2),
        "risk_per_share":     round(risk, 4),
        "reward_per_share":   round(r_target * risk, 4),
        "notional":           round(shares * entry_limit, 2),
    }
