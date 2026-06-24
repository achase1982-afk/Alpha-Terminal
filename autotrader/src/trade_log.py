"""
Append-only JSONL trade log. Every engine event (signal, order, skip, halt) is
written as one line so the session can be fully reconstructed from the file.
"""
import json
import os
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
log = logging.getLogger("orb_engine.log")


def _write(log_file: str, event: dict) -> None:
    event.setdefault("ts", datetime.now(tz=ET).isoformat())
    parent = os.path.dirname(log_file)
    if parent:
        os.makedirs(parent, exist_ok=True)
    try:
        with open(log_file, "a") as f:
            f.write(json.dumps(event) + "\n")
    except Exception as e:
        log.warning("trade_log write failed: %s", e)


def log_signal(log_file: str, symbol: str, signal: dict) -> None:
    _write(log_file, {"type": "SIGNAL", "symbol": symbol, **signal})


def log_order(log_file: str, symbol: str, signal: dict, result: dict, shadow: bool) -> None:
    _write(log_file, {
        "type": "ORDER",
        "symbol": symbol,
        "shadow": shadow,
        "entry_limit": signal.get("entry_limit"),
        "stop": signal.get("stop"),
        "target": signal.get("target"),
        "shares": signal.get("shares"),
        "notional": signal.get("notional"),
        "rvol": signal.get("rvol"),
        "orderId": result.get("orderId"),
        "ok": result.get("ok"),
        "error": result.get("error"),
    })


def log_skip(log_file: str, symbol: str, reason: str, **kwargs) -> None:
    _write(log_file, {"type": "SKIP", "symbol": symbol, "reason": reason, **kwargs})


def log_risk_halt(log_file: str, reason: str) -> None:
    _write(log_file, {"type": "RISK_HALT", "reason": reason})


def log_eod_flatten(log_file: str, symbol: str, cancelled: int, shadow: bool) -> None:
    _write(log_file, {
        "type": "EOD_FLATTEN",
        "symbol": symbol,
        "cancelled_orders": cancelled,
        "shadow": shadow,
    })


def log_error(log_file: str, message: str, **kwargs) -> None:
    _write(log_file, {"type": "ERROR", "message": message, **kwargs})
