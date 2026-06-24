#!/usr/bin/env python3
"""
ORB AutoTrader — deterministic Opening Range Breakout engine.

Usage:
    python autotrader/run.py                     # uses shadow_mode from config.yaml
    python autotrader/run.py --shadow            # force shadow (log only, no orders)
    python autotrader/run.py --live              # force live (real orders — requires account_hash)
    python autotrader/run.py --config path.yaml  # use a different config file

ALWAYS run in shadow mode for at least one full trading session before going live.
A kill switch can be activated by creating the file autotrader/.kill — the engine
will halt on the next poll cycle and log a RISK_HALT event.
"""
import argparse
import logging
import os
import sys

# Ensure the autotrader package is importable regardless of CWD
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import yaml
from src.engine import run_engine


def main() -> None:
    parser = argparse.ArgumentParser(
        description="ORB AutoTrader",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--shadow", action="store_true", help="Shadow mode: log signals, no orders")
    mode.add_argument("--live",   action="store_true", help="Live mode: place real orders")
    parser.add_argument(
        "--config",
        default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.yaml"),
        help="Path to config.yaml (default: autotrader/config.yaml)",
    )
    args = parser.parse_args()

    if not os.path.exists(args.config):
        print(f"Config file not found: {args.config}", file=sys.stderr)
        sys.exit(1)

    with open(args.config) as f:
        config = yaml.safe_load(f)

    # CLI flags override config.yaml
    if args.shadow:
        shadow = True
    elif args.live:
        shadow = False
    else:
        shadow = bool(config.get("shadow_mode", True))

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[
            logging.StreamHandler(sys.stdout),
        ],
    )

    mode_label = "SHADOW" if shadow else "LIVE ⚡"
    print(f"\n{'='*60}")
    print(f"  ORB AutoTrader | {mode_label} | symbol={config['symbol']}")
    print(f"{'='*60}\n")

    if not shadow:
        acct = config.get("account_hash", "").strip()
        if not acct:
            print("ERROR: account_hash must be set in config.yaml for live mode.", file=sys.stderr)
            sys.exit(1)
        print(f"  Account: {acct[:4]}...{acct[-4:] if len(acct) > 8 else acct}")
        print(f"  Symbol:  {config['symbol']}")
        print(f"  Budget:  ${config['position']['max_dollars']} max per trade")
        print()
        confirm = input("Type 'go live' to confirm live trading, or Ctrl+C to abort: ").strip()
        if confirm != "go live":
            print("Aborted.")
            sys.exit(0)

    run_engine(config, shadow=shadow)


if __name__ == "__main__":
    main()
