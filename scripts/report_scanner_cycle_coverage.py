#!/usr/bin/env python3
"""
Print per-ticker tape coverage for the last N scanner_health cycles (e.g. 5 market sessions).

Requires: DATABASE_URL, psycopg2-binary
Usage:
  DATABASE_URL=... python3 scripts/report_scanner_cycle_coverage.py --tickers NVDA,AAPL --cycles 5
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict

import psycopg2


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--tickers",
        default="NVDA,AAPL,MSFT,AMZN,GOOGL,META,TSLA,AVGO,NFLX,AMD,ORCL,MU,CRWD,COST,PEP,MCD,JPM,BAC,XOM,RF",
    )
    p.add_argument("--cycles", type=int, default=5)
    args = p.parse_args()
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL required", file=sys.stderr)
        sys.exit(1)
    want = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]

    conn = psycopg2.connect(url)
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, cycle_started_at, cycle_completed_at
        FROM scanner_health
        WHERE cycle_completed_at IS NOT NULL
        ORDER BY cycle_completed_at DESC
        LIMIT %s
        """,
        (args.cycles,),
    )
    cyc = cur.fetchall()
    if not cyc:
        print("No scanner_health rows.")
        return
    cyc = list(reversed(cyc))  # oldest first for column order
    cycle_ids = [c[0] for c in cyc]
    id_to_idx = {cid: i for i, cid in enumerate(cycle_ids)}

    cur.execute(
        """
        SELECT cycle_id, ticker, chain_contract_count, occ_coverage_pct, trades_inserted, trades_observed,
               insert_coverage_pct, tier, elapsed_ms, truncated
        FROM scanner_ticker_cycle_coverage
        WHERE cycle_id = ANY(%s::int[]) AND ticker = ANY(%s::text[])
        ORDER BY recorded_at
        """,
        (cycle_ids, want),
    )
    rows = cur.fetchall()
    by_ticker: dict[str, list] = defaultdict(list)
    for r in rows:
        by_ticker[r[1]].append(r)

    print("Cycles (oldest → newest):")
    for c in cyc:
        print(f"  id={c[0]}  {c[1]} → {c[2]}")
    print()

    for t in want:
        rs = {r[0]: r for r in by_ticker.get(t, [])}
        print(f"=== {t} ===")
        for i, cid in enumerate(cycle_ids):
            r = rs.get(cid)
            if not r:
                print(f"  cycle {i+1}: (no row — run migration + deploy worker)")
                continue
            _cid, _t, chain_cc, occ_pct, ins, obs, ins_pct, tier, el_ms, trunc = r
            occ_pct_s = f"{float(occ_pct) * 100:.2f}" if occ_pct is not None else "—"
            ins_pct_s = f"{float(ins_pct) * 100:.2f}" if ins_pct is not None else "—"
            print(
                f"  cycle {i+1}: chain={chain_cc}  occ%={occ_pct_s}  "
                f"trades_in={ins}  trades_obs={obs}  insert%={ins_pct_s}  "
                f"tier={tier}  ms={el_ms}  trunc={trunc}",
            )
        print()

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
