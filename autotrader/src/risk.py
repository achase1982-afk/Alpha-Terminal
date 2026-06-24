"""
Risk management layer for the ORB engine.
All checks are synchronous and in-memory. State is reset at the ET day boundary.
"""
import logging
import os
import time
from datetime import datetime
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
KILL_SWITCH_PATH = "autotrader/.kill"

log = logging.getLogger("orb_engine.risk")


class RiskManager:
    def __init__(self, config: dict):
        risk = config.get("risk", {})
        self.daily_max_loss       = abs(float(risk.get("daily_max_loss", 100)))
        self.loss_streak_halt     = int(risk.get("loss_streak_halt", 3))
        self.cooldown_min         = float(risk.get("loss_streak_cooldown_min", 60))
        self.pdt_limit            = int(risk.get("pdt_limit", 3))

        self._pnl_today: float   = 0.0
        self._trades_today: int  = 0
        self._loss_streak: int   = 0
        self._cooldown_until: float = 0.0  # epoch seconds
        self._day_key: str       = self._today()

    def _today(self) -> str:
        return datetime.now(tz=ET).strftime("%Y-%m-%d")

    def _reset_if_new_day(self) -> None:
        today = self._today()
        if today != self._day_key:
            self._day_key = today
            self._pnl_today = 0.0
            self._trades_today = 0
            self._loss_streak = 0
            self._cooldown_until = 0.0
            log.info("New trading day: %s — risk counters reset", today)

    def kill_switch_active(self) -> bool:
        """Kill switch: create autotrader/.kill to halt the engine immediately."""
        return os.path.exists(KILL_SWITCH_PATH)

    def check(self) -> tuple:
        """
        Returns (can_trade: bool, reason: str).
        Call before every potential entry.
        """
        self._reset_if_new_day()

        if self.kill_switch_active():
            return False, "KILL_SWITCH (delete autotrader/.kill to resume)"

        if self._pnl_today <= -self.daily_max_loss:
            return False, f"DAILY_LOSS_LIMIT (P&L ${self._pnl_today:.2f} ≤ -${self.daily_max_loss:.2f})"

        if self._trades_today >= self.pdt_limit:
            return False, f"PDT_LIMIT ({self._trades_today}/{self.pdt_limit} day trades)"

        if self._loss_streak >= self.loss_streak_halt:
            remaining = self._cooldown_until - time.time()
            if remaining > 0:
                return False, f"LOSS_STREAK_COOLDOWN ({remaining / 60:.0f}m remaining after {self._loss_streak} losses)"

        return True, ""

    def record_trade(self, pnl: float) -> None:
        """Call after each trade closes with realized P&L."""
        self._reset_if_new_day()
        self._pnl_today += pnl
        self._trades_today += 1
        if pnl < 0:
            self._loss_streak += 1
            if self._loss_streak >= self.loss_streak_halt:
                self._cooldown_until = time.time() + self.cooldown_min * 60
                log.warning(
                    "Loss streak %d reached — cooling down %.0f min",
                    self._loss_streak, self.cooldown_min,
                )
        else:
            self._loss_streak = 0
        log.info(
            "Trade recorded: pnl=%.2f | day_pnl=%.2f | day_trades=%d | streak=%d",
            pnl, self._pnl_today, self._trades_today, self._loss_streak,
        )

    @property
    def pnl_today(self) -> float:
        return self._pnl_today

    @property
    def trades_today(self) -> int:
        return self._trades_today
