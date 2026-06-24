"""
Schwab REST API client for the ORB engine.
Handles: token loading, bar data, quotes, bracket order placement.
"""
import json
import logging
import os
import re
from datetime import datetime, timezone, timedelta
from typing import Optional

import requests

SCHWAB_MARKET_BASE = "https://api.schwabapi.com/marketdata/v1"
SCHWAB_TRADER_BASE = "https://api.schwabapi.com/trader/v1"

log = logging.getLogger("orb_engine.schwab")


# ── Token loading ──────────────────────────────────────────────────────────────

def _load_token_file(path: str) -> Optional[str]:
    """Read access token from schwab-tokens.json (written by the Node.js server)."""
    try:
        with open(path) as f:
            data = json.load(f)
        return (
            data.get("trader", {}).get("accessToken")
            or data.get("market", {}).get("accessToken")
        )
    except Exception:
        return None


def _load_token_db(db_url: str) -> Optional[str]:
    """Read access token from schwab_tokens table (authoritative source)."""
    try:
        import psycopg2
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        cur.execute(
            "SELECT access_token FROM schwab_tokens WHERE kind IN ('trader','market') "
            "ORDER BY (kind='trader') DESC LIMIT 1"
        )
        row = cur.fetchone()
        cur.close()
        conn.close()
        return row[0] if row else None
    except Exception as e:
        log.debug("DB token load failed: %s", e)
        return None


def get_token(config: dict) -> Optional[str]:
    """Try the JSON token file first, fall back to DATABASE_URL."""
    token_file = config.get("token_file", "artifacts/api-server/.data/schwab-tokens.json")
    token = _load_token_file(token_file)
    if token:
        return token
    db_url = os.environ.get("DATABASE_URL")
    if db_url:
        return _load_token_db(db_url)
    log.error("No token source available (file missing, DATABASE_URL not set)")
    return None


# ── Market data ────────────────────────────────────────────────────────────────

def get_bars(symbol: str, token: str, days: int = 1) -> list:
    """
    Fetch 1-minute OHLCV bars for the current session.
    Returns list of candle dicts: {open, high, low, close, volume, datetime (epoch ms)}.
    """
    url = f"{SCHWAB_MARKET_BASE}/pricehistory"
    params = {
        "symbol": symbol.upper(),
        "periodType": "day",
        "period": days,
        "frequencyType": "minute",
        "frequency": 1,
        "needExtendedHoursData": "false",
    }
    res = requests.get(
        url, params=params,
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    res.raise_for_status()
    data = res.json()
    return data.get("candles", [])


def get_quote(symbol: str, token: str) -> dict:
    """
    Fetch full quote including fundamentals (for avg daily volume).
    Returns the inner quote object for the symbol, or {}.
    """
    url = f"{SCHWAB_MARKET_BASE}/quotes"
    params = {"symbols": symbol.upper(), "fields": "quote,fundamental"}
    res = requests.get(
        url, params=params,
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    res.raise_for_status()
    data = res.json()
    return data.get(symbol.upper(), {})


def extract_avg_daily_volume(quote: dict) -> float:
    """Pull average daily volume from Schwab quote/fundamental fields."""
    fundamental = quote.get("fundamental", {})
    quote_data = quote.get("quote", {})
    return (
        fundamental.get("vol10DayAvg")
        or fundamental.get("averageVolume10DayEstimate")
        or quote_data.get("totalVolume")
        or 0.0
    )


# ── Order placement ────────────────────────────────────────────────────────────

def _build_bracket_order(symbol: str, qty: int, entry_limit: float, stop_price: float, target_price: float) -> dict:
    """
    Construct a First-Triggers-OCO bracket order payload.
    Primary: BUY LIMIT at entry_limit.
    On fill → OCO: SELL LIMIT at target_price OR SELL STOP at stop_price.
    """
    sym = symbol.upper()
    leg = lambda instruction: [
        {
            "instruction": instruction,
            "quantity": qty,
            "instrument": {"symbol": sym, "assetType": "EQUITY"},
        }
    ]
    return {
        "orderStrategyType": "TRIGGER",
        "session": "NORMAL",
        "duration": "DAY",
        "orderType": "LIMIT",
        "price": str(round(entry_limit, 2)),
        "orderLegCollection": leg("BUY"),
        "childOrderStrategies": [
            {
                "orderStrategyType": "OCO",
                "childOrderStrategies": [
                    {
                        "orderStrategyType": "SINGLE",
                        "session": "NORMAL",
                        "duration": "DAY",
                        "orderType": "LIMIT",
                        "price": str(round(target_price, 2)),
                        "orderLegCollection": leg("SELL"),
                    },
                    {
                        "orderStrategyType": "SINGLE",
                        "session": "NORMAL",
                        "duration": "DAY",
                        "orderType": "STOP",
                        "stopPrice": str(round(stop_price, 2)),
                        "orderLegCollection": leg("SELL"),
                    },
                ],
            }
        ],
    }


def place_bracket_order(
    account_hash: str,
    symbol: str,
    qty: int,
    entry_limit: float,
    stop_price: float,
    target_price: float,
    token: str,
    shadow: bool = True,
) -> dict:
    """
    Place a bracket order. Returns {shadow, orderId, ok, order_payload}.
    shadow=True logs everything but makes no HTTP call.
    """
    order = _build_bracket_order(symbol, qty, entry_limit, stop_price, target_price)

    if shadow:
        log.info(
            "SHADOW bracket order: BUY %d %s limit=%.2f stop=%.2f target=%.2f",
            qty, symbol.upper(), entry_limit, stop_price, target_price,
        )
        return {"shadow": True, "orderId": None, "ok": True, "order": order}

    url = f"{SCHWAB_TRADER_BASE}/accounts/{account_hash}/orders"
    res = requests.post(
        url, json=order,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        timeout=15,
    )

    if not res.ok:
        body = res.text[:300]
        log.error("Bracket order rejected %d: %s", res.status_code, body)
        return {"shadow": False, "orderId": None, "ok": False, "error": body}

    location = res.headers.get("location", "")
    m = re.search(r"orders/(\d+)", location)
    order_id = m.group(1) if m else None

    log.info(
        "Bracket order placed: BUY %d %s limit=%.2f stop=%.2f target=%.2f → orderId=%s",
        qty, symbol.upper(), entry_limit, stop_price, target_price, order_id,
    )
    return {"shadow": False, "orderId": order_id, "ok": True, "order": order}


def cancel_open_orders_for_symbol(account_hash: str, symbol: str, token: str) -> int:
    """Cancel all working orders that involve the given symbol. Returns count cancelled."""
    now = datetime.now(timezone.utc)
    frm = (now - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%SZ")
    to  = (now + timedelta(minutes=2)).strftime("%Y-%m-%dT%H:%M:%SZ")

    res = requests.get(
        f"{SCHWAB_TRADER_BASE}/accounts/{account_hash}/orders",
        params={"fromEnteredTime": frm, "toEnteredTime": to},
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    if not res.ok:
        return 0

    orders = res.json()
    if not isinstance(orders, list):
        return 0

    cancellable = {"WORKING", "PENDING_ACTIVATION", "QUEUED", "ACCEPTED", "AWAITING_PARENT_ORDER"}
    sym_upper = symbol.upper()
    cancelled = 0

    for o in orders:
        if o.get("status") not in cancellable:
            continue
        legs = o.get("orderLegCollection", [])
        if not any(leg.get("instrument", {}).get("symbol", "").upper() == sym_upper for leg in legs):
            continue
        dr = requests.delete(
            f"{SCHWAB_TRADER_BASE}/accounts/{account_hash}/orders/{o['orderId']}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        if dr.ok:
            cancelled += 1

    return cancelled


def get_order_status(account_hash: str, order_id: str, token: str) -> dict:
    """Fetch order status from Schwab."""
    res = requests.get(
        f"{SCHWAB_TRADER_BASE}/accounts/{account_hash}/orders/{order_id}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    res.raise_for_status()
    return res.json()
