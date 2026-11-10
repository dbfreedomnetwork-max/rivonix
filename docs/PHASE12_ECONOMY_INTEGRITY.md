# Phase 12 — Demo Economy Reliability and Reconciliation

**Development-only. No real funds, purchases, cash balances or withdrawals.** All updates are source commits; CI execution and database integration testing still require verification.

## Changes

- Gift requests check `(senderId, idempotencyKey)` before room-status checks, so a successfully committed gift can be replayed after a lost response or the LIVE room ending. Reusing the key with different gift details returns conflict.
- Serializable database transaction conflicts (`P2034`) are retried a bounded number of times. Concurrent unique-key races (`P2002`) check the authoritative persisted gift before returning.
- One-time 500 demo-point onboarding grants handle concurrent duplicate claims without issuing a second grant.
- Gift allocations are checked so creator + agency + platform points equal the spent demo coins.
- The wallet reconciliation endpoint `GET /rivo/wallet/reconcile` compares a user's wallet balances with the sum of their complete demo ledger. It returns `consistent`, `wallet`, and `ledgerTotals`.
- Flutter Creator Center shows the consistency result and a creator gift-activity summary.
- Same-room battle creation uses a **parameterized, transaction-scoped PostgreSQL advisory lock** to serialize competing start requests. Previously expired active battles are marked ended before a new round begins.
- The demo feature flag now requires **both** `RIVONIX_DEMO_ECONOMY=true` and `NODE_ENV=development` or `NODE_ENV=test`. Unknown and production environments are rejected.
- Unit tests cover idempotency identity, accounting allocation, serialization retries, demo gate behavior and reconciliation mismatches.

## Local setup

1. Use an isolated development database; do not overwrite an existing production schema.
2. Run from `apps/api`:

```sh
npm install
npx prisma migrate dev --name economy_integrity
npx prisma generate
npm run typecheck
npm test
```

3. Configure your **local-only** API process explicitly:

```ini
NODE_ENV=development
RIVONIX_DEMO_ECONOMY=true
```

4. Use two or more test accounts to claim once-only coins, publish an Agora LIVE room, send repeated gift requests with the same UUID, and view `/rivo/wallet/reconcile`. The result should remain balanced after each operation.

## Integration tests still needed

Run PostgreSQL-backed concurrent tests to verify duplicate grant requests, double-click gifts, zero-balance gifts, gifts to guests removed mid-send, agency membership transitions, concurrent battle starts, and room termination during gifts. API unit tests alone cannot prove the database transaction behavior. Verify gift counts, wallet balances, ledger entries, replay responses and battle scores after concurrent requests.

Also test migrations against realistic existing development data, Android/iOS builds, Agora channel state, and full end-to-end flows. Those were **not** executed or confirmed passing in this phase.

## Security and monetary requirements

This is **not** a financial double-entry ledger. The reconciliation endpoint checks cached demo balances but does not prove platform liability or real-world value. The prototype does not process purchases, refunds, cash-outs, chargebacks, actual creator income, or agency commission payments.

Do not enable purchase or payout flows until mobile app-store payment requirements, immutable double-entry accounting, reconciliation, legal and tax requirements, age/identity checks, abuse protections, creator contracts, secure custody, payout verification and a production security audit are complete.
