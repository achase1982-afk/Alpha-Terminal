#!/usr/bin/env python3
"""
Report OCC coverage stats from scanner_tape_metrics_cycle_log (after migration 0020).

Uses the last N completion timestamps from scanner_health as "cycles", assigns each
tape log row to the cycle whose [cycle_started_at, cycle_completed_at] contains recorded_at.

Requires: DATABASE_URL
Usage:
  DATABASE_URL=... python3 scripts/report_tape_occ_coverage.py \\
    NVDA AAPL MSFT AMZN GOOGL META TSLA AVGO NFLX AMD ORCL MU CRWD COST PEP MCD JPM BAC XOM RF

Optional env:
  RECENT_CYCLES=10   (default 10)
"""

from __future__ import annotations

import os
import sys

import psycopg2


def main() -> None:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL required", file=sys.stderr)
        sys.exit(1)
    tickers = [t.upper().strip() for t in sys.argv[1:] if t.strip()]
    if not tickers:
        print("Provide ticker symbols as arguments", file=sys.stderr)
        sys.exit(1)
    n_cycles = int(os.environ.get("RECENT_CYCLES", "10"))

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
        (n_cycles,),
    )
    cycles = cur.fetchall()
    if not cycles:
        print("No scanner_health rows found.")
        return

    cycle_ids = [c[0] for c in cycles]

    for ticker in tickers:
        cur.execute(
            """
            WITH cycles AS (
              SELECT id, cycle_started_at, cycle_completed_at
              FROM scanner_health
              WHERE id = ANY(%s::int[])
            ),
            matched AS (
              SELECT
                l.ticker,
                l.occ_requested,
                l.occ_completed,
                l.status,
                l.duration_ms,
                l.chain_contract_count,
                l.recorded_at,
                c.id AS cycle_id
              FROM scanner_tape_metrics_cycle_log l
              JOIN cycles c ON l.recorded_at >= c.cycle_started_at
                AND l.recorded_at <= c.cycle_completed_at
              WHERE l.ticker = %s
            )
            SELECT
              COUNT(*) AS n_matched,
              AVG(CASE WHEN occ_requested > 0 THEN occ_completed::float / occ_requested END) AS avg_occ_pct,
              MIN(CASE WHEN occ_requested > 0 THEN occ_completed::float / occ_requested END) AS min_occ_pct,
              MAX(CASE WHEN occ_requested > 0 THEN chain_contract_count END) AS max_chain_cc,
              AVG(CASE WHEN status = 'complete' AND duration_ms IS NOT NULL THEN duration_ms END) AS avg_duration_ms_complete
            FROM matched
            """,
            (cycle_ids, ticker),
        )
        row = cur.fetchone()
        if not row or row[0] == 0:
            print(f"{ticker}: no tape_cycle_log rows matched recent {n_cycles} scanner_health cycles (run migrations / deploy)")
            continue
        n_matched, avg_pct, min_pct, max_cc, avg_dur = row
        avg_pct100 = (avg_pct or 0) * 100
        min_pct100 = (min_pct or 0) * 100
        dur_s = f"{float(avg_dur):.0f}" if avg_dur is not None else "—"
        print(
            f"{ticker}: cycles_matched={int(n_matched)}/{n_cycles} "
            f"avg_occ_coverage={avg_pct100:.1f}% worst_cycle={min_pct100:.1f}% "
            f"chain_contracts_max_seen={max_cc or '—'} "
            f"avg_duration_ms_when_complete={dur_s}",
        )

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
