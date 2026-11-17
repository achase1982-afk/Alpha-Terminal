# QA PR B screenshots

Playwright captures against the real Vite dev server (`/qa` harness, mocked API/WS). Before shots temporarily swap `OrderTicket.tsx`, `OptionsTab.tsx`, `StrategyBuilder.tsx`, and `lib/order-ticket-math` from `main` ([`scripts/qa-capture-before-screenshots.sh`](../../scripts/qa-capture-before-screenshots.sh)).

```bash
pnpm --filter @workspace/alpha-terminal run test:e2e:qa-screenshots:before
QA_SNAPSHOT_VARIANT=after pnpm --filter @workspace/alpha-terminal run test:e2e:qa-screenshots
```

Pairs that were **byte-identical** between before and after were dropped (including chain — no visible delta vs main in this harness).

| Pair prefix | Proves (after vs before) |
|-------------|---------------------------|
| `option-open` | Stream bid/ask on ticket; SPX **$0.10** tick snap on Mid (**3.78 → 3.80**). |
| `debit-vertical` | **Positive** multi-leg spread NBBO (2.45 / mid / 2.60) after NBBO direction fix. |
| `stock` | Equity limit **cent** formatting: live **187.41 / 187.43** stream vs mid rounded to **187.42**. |
| `review` | Real **Order Confirmation** with enabled Review + snapped limit (not disabled form). |
| `option-fail-review` | **FAIL** liquidity with entered limit **3.50** visible; Review stays disabled. |

Each kept scenario has `before-*` and `after-*` at **440×956** and **402×715** when a delta exists.