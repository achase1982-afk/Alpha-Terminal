"""
ORB engine main loop.

Cycle:
  1. Wait until market is approaching open.
  2. Every poll_interval seconds:
       a. Risk check.
       b. Fetch 1-min bars + quote.
       c. If no position yet and 9:45+ ET: check ORB signal.
       d. If signal fires: place bracket order (shadow or live).
  3. At time_stop (15:55 ET): cancel any open orders, stop for the day.

Only one position per symbol per day. Bracket order manages exit automatically.
"""
import logging
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from .schwab_client import (
    get_token,
    get_bars,
    get_quote,
    extract_avg_daily_volume,
    place_bracket_order,
    cancel_open_orders_for_symbol,
)
from .features import compute_or_levels, compute_rvol
from .setup_orb import check_orb_entry
from .risk import RiskManager
from .trade_log import (
    log_signal,
    log_order,
    log_skip,
    log_risk_halt,
    log_eod_flatten,
    log_error,
)

ET = ZoneInfo("America/New_York")
log = logging.getLogger("orb_engine")


def _et_now() -> datetime:
    return datetime.now(tz=ET)


def _is_trading_day() -> bool:
    return _et_now().weekday() < 5  # Mon–Fri


def _minutes_et() -> int:
    now = _et_now()
    return now.hour * 60 + now.minute


def _secs_until_market_pre_open(lead_minutes: int = 5) -> float:
    """Seconds until (market_open - lead_minutes). Negative if already past."""
    now = _et_now()
    target = now.replace(hour=9, minute=30 - lead_minutes, second=0, microsecond=0)
    return (target - now).total_seconds()


def _is_past_time_stop(time_stop_str: str) -> bool:
    h, m = map(int, time_stop_str.split(":"))
    return _minutes_et() >= h * 60 + m


def run_engine(config: dict, shadow: bool) -> None:
    symbol = config["symbol"].upper()
    account_hash = config.get("account_hash", "").strip()
    poll_interval = max(15, int(config.get("poll_interval_sec", 60)))
    log_file = config.get("log_file", "autotrader/trades.jsonl")
    time_stop = config["orb"]["time_stop"]

    if not shadow and not account_hash:
        raise ValueError("account_hash is required in config.yaml for live mode")

    risk = RiskManager(config)

    entered_today = False
    active_order_id = None
    day_key = _et_now().strftime("%Y-%m-%d")

    log.info(
        "ORB engine ready | symbol=%s | mode=%s | poll=%ds",
        symbol, "SHADOW" if shadow else "LIVE", poll_interval,
    )

    while True:
        now = _et_now()
        today = now.strftime("%Y-%m-%d")

        # ── Reset daily state at day boundary ──────────────────────────────────
        if today != day_key:
            day_key = today
            entered_today = False
            active_order_id = None
            log.info("Day boundary: %s — resetting session state", today)

        # ── Skip weekends ──────────────────────────────────────────────────────
        if not _is_trading_day():
            log.debug("Weekend — sleeping 1h")
            time.sleep(3600)
            continue

        # ── Wait until 9:25 ET before fetching data ────────────────────────────
        secs_to_pre_open = _secs_until_market_pre_open(lead_minutes=5)
        if secs_to_pre_open > 0:
            sleep_secs = min(secs_to_pre_open, 600)
            log.info("Market opens in ~%.0f min — sleeping %.0fs", secs_to_pre_open / 60, sleep_secs)
            time.sleep(sleep_secs)
            continue

        # ── EOD: past time_stop — cancel orders and rest ───────────────────────
        if _is_past_time_stop(time_stop):
            if active_order_id and not shadow and account_hash:
                token = get_token(config)
                if token:
                    n = cancel_open_orders_for_symbol(account_hash, symbol, token)
                    log_eod_flatten(log_file, symbol, n, shadow)
                    log.info("EOD flatten: cancelled %d orders for %s", n, symbol)
            elif shadow and not entered_today:
                log.info("EOD reached without a trade signal today")
            time.sleep(3600)
            continue

        # ── Risk check ─────────────────────────────────────────────────────────
        can_trade, halt_reason = risk.check()
        if not can_trade:
            log_risk_halt(log_file, halt_reason)
            log.warning("Risk halt: %s", halt_reason)
            time.sleep(poll_interval)
            continue

        # ── Fetch market data ──────────────────────────────────────────────────
        token = get_token(config)
        if not token:
            log_error(log_file, "no_token", detail="Check token file or DATABASE_URL")
            log.error("No Schwab access token — skipping cycle")
            time.sleep(poll_interval)
            continue

        try:
            bars = get_bars(symbol, token, days=1)
            quote = get_quote(symbol, token)
        except Exception as e:
            log_error(log_file, "data_fetch_failed", detail=str(e))
            log.error("Market data fetch failed: %s", e)
            time.sleep(poll_interval)
            continue

        if not bars:
            log.warning("No bars returned for %s", symbol)
            time.sleep(poll_interval)
            continue

        avg_vol = extract_avg_daily_volume(quote)

        # ── Check ORB entry (only if we haven't entered today) ─────────────────
        if not entered_today:
            signal = check_orb_entry(bars, config, avg_vol, already_entered=False)

            if signal is None:
                # Log why we're waiting
                or_levels = compute_or_levels(bars, config["orb"]["or_minutes"])
                if or_levels:
                    rvol = compute_rvol(bars, avg_vol)
                    last = bars[-1]["close"]
                    above_or = last > or_levels["or_high"]
                    log_skip(
                        log_file, symbol,
                        "no_breakout" if not above_or else "rvol_too_low",
                        or_high=or_levels["or_high"],
                        or_low=or_levels["or_low"],
                        last=last,
                        rvol=round(rvol, 2),
                        min_rvol=config["entry"]["min_rvol"],
                    )
                    log.info(
                        "Watching %s | OR_H=%.2f last=%.2f RVOL=%.2f (need %.1f)",
                        symbol, or_levels["or_high"], last, rvol, config["entry"]["min_rvol"],
                    )
                else:
                    log.info("Waiting for %s opening range to complete (%d bars so far)", symbol, len(bars))

            else:
                log.info(
                    "SIGNAL %s | entry=%.2f stop=%.2f target=%.2f shares=%d RVOL=%.2f",
                    symbol,
                    signal["entry_limit"], signal["stop"], signal["target"],
                    signal["shares"], signal["rvol"],
                )
                log_signal(log_file, symbol, signal)

                result = place_bracket_order(
                    account_hash=account_hash,
                    symbol=symbol,
                    qty=signal["shares"],
                    entry_limit=signal["entry_limit"],
                    stop_price=signal["stop"],
                    target_price=signal["target"],
                    token=token,
                    shadow=shadow,
                )
                log_order(log_file, symbol, signal, result, shadow)

                if result.get("ok"):
                    entered_today = True
                    active_order_id = result.get("orderId")
                    log.info(
                        "%s bracket order | orderId=%s",
                        "SHADOW" if shadow else "LIVE", active_order_id,
                    )
                else:
                    log.error("Order placement failed: %s", result.get("error"))

        time.sleep(poll_interval)
