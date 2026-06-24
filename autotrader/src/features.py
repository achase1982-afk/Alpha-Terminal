"""
Feature computation for the ORB engine.
All functions are pure — they take bars (list of dicts) and return values.
No side effects, no I/O.
"""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from typing import Optional

ET = ZoneInfo("America/New_York")


def bar_et(bar: dict) -> datetime:
    """Convert Schwab bar datetime (epoch ms, UTC) to ET-aware datetime."""
    return datetime.fromtimestamp(bar["datetime"] / 1000, tz=timezone.utc).astimezone(ET)


def opening_range_bars(bars: list, or_minutes: int = 15) -> list:
    """Return bars that fall within the opening range window."""
    result = []
    for b in bars:
        t = bar_et(b)
        session_open = t.replace(hour=9, minute=30, second=0, microsecond=0)
        or_end = t.replace(hour=9, minute=30 + or_minutes - 1, second=59, microsecond=999999)
        if session_open <= t <= or_end:
            result.append(b)
    return result


def compute_or_levels(bars: list, or_minutes: int = 15) -> Optional[dict]:
    """
    Compute opening range high/low from the first or_minutes bars.
    Returns None if the opening range is not yet complete.
    """
    or_bars = opening_range_bars(bars, or_minutes)
    if len(or_bars) < or_minutes:
        return None
    return {
        "or_high": max(b["high"] for b in or_bars),
        "or_low":  min(b["low"]  for b in or_bars),
        "or_volume": sum(b["volume"] for b in or_bars),
    }


def compute_atr(bars: list, period: int = 14) -> Optional[float]:
    """ATR(period) from 1-minute bars using simple average of true ranges."""
    if len(bars) < period + 1:
        return None
    trs = []
    for i in range(1, len(bars)):
        h = bars[i]["high"]
        l = bars[i]["low"]
        pc = bars[i - 1]["close"]
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    if len(trs) < period:
        return None
    return sum(trs[-period:]) / period


def compute_rvol(bars: list, avg_daily_volume: float) -> float:
    """
    Relative volume: current session volume vs expected volume at this time.
    Expected = avg_daily_volume × (minutes_elapsed / 390).
    Returns 0 if avg_daily_volume is unknown.
    """
    if avg_daily_volume <= 0:
        return 0.0
    session_vol = sum(b["volume"] for b in bars)
    minutes_elapsed = len(bars)  # 1 bar = 1 minute
    expected = avg_daily_volume * (minutes_elapsed / 390.0)
    return session_vol / expected if expected > 0 else 0.0


def compute_vwap(bars: list) -> Optional[float]:
    """Session VWAP from 1-minute bars."""
    pv = sum((b["high"] + b["low"] + b["close"]) / 3.0 * b["volume"] for b in bars)
    vol = sum(b["volume"] for b in bars)
    return pv / vol if vol > 0 else None
