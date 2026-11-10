# Phase 11 — LIVE battles, Rivo Coins, virtual gifts, creator and agency foundations

**Status: development-only prototype committed to GitHub. Not launched or built/tested on devices.**

## Scope

- **Rivo Coins (demo):** a server-side integer balance and an append-only transaction log. A single opt-in local grant provides 500 non-purchasable demonstration coins per account. No public minting or client-side adjustment endpoint.
- **Gifts:** fixed catalog (Rose 10, Star 50, Comet 100 demo coins). Gifts require sender authentication, membership in an active LIVE room and a host/approved guest recipient. The sending wallet is conditionally debited inside a Prisma serializable transaction. A client-generated UUID idempotency key prevents repeated processing of the same operation.
- **Creator point records:** gift consumption distributes **virtual demonstration points**, not currency. When an ACTIVE agency membership exists, the illustrative allocation is approximately 50% creator, 15% agency, 35% platform, with all rounding retained by the platform. Without an active agency, it is 50% creator / 50% platform.
- **LIVE battles:** the LIVE host can start a timed 60–300-second competition against an approved guest. Demo gift costs accrue to the gifted side's score while the battle is active. Scores can be retrieved and an authorized host can end a battle. This is a **same-room host versus guest** implementation, not cross-room battles.
- **Agencies:** authenticated users can create an agency and invite a creator; the creator must opt in before joining. The data model limits each creator to one pending/active agency association. Owners can inspect their demo agency points and membership roster.
- **Mobile:** the Profile tab links to **Rivo Creator Center (demo)** for balances, activity and agency tools. LIVE shows a demo gift and battle panel with host/guest recipient selection. Scores refresh approximately every five seconds.
- **Creator earnings view:** the API returns demo creator points earned and counts of gifts received. The API explicitly reports `cashValue: null`, `withdrawable: false`.

## Local setup (no real money)

From a **new or safely migrated development** PostgreSQL database:

```bash
cd apps/api
npm install
npx prisma migrate dev --name rivo_demo_economy
npx prisma generate
npm run typecheck
npm test
```

In a local-only `.env`, set:

```
RIVONIX_DEMO_ECONOMY=true
NODE_ENV=development
```

**Important:** `RIVONIX_DEMO_ECONOMY` defaults to `false`, and the demo API always rejects economy actions when `NODE_ENV=production`. Do not connect this demo mechanism to Stripe, app-store purchases, real cash payouts, or real user funding.

Flutter must also run against this API with an authenticated user and working Agora LIVE rooms. Test all flows with separate sender, host, guest and agency-owner accounts.

## API reference

| Operation | Endpoint |
|---|---|
| Gift catalog | `GET /rivo/catalog` |
| Personal demo wallet | `GET /rivo/wallet` |
| Demo ledger | `GET /rivo/ledger` |
| Claim once-only test points | `POST /rivo/demo-credit` |
| Send gift | `POST /rivo/gifts` |
| Creator activity summary | `GET /rivo/creator/summary` |
| Current room battle | `GET /rivo/rooms/:roomId/battle` |
| Start battle | `POST /rivo/rooms/:roomId/battles` |
| Host ends battle | `POST /rivo/battles/:id/end` |
| Owned agencies / membership | `GET /rivo/agencies/mine` |
| Create agency | `POST /rivo/agencies` |
| Invite creator | `POST /rivo/agencies/:id/invite` |
| Creator accepts invite | `POST /rivo/agencies/invitations/accept` |
| Creator leaves association | `DELETE /rivo/agencies/membership` |
| Agency demo summary | `GET /rivo/agencies/:id/summary` |

## Test before continuing

1. Confirm production mode refuses ALL gifting, demo grants, agency and battle transactions.
2. Call demo credit twice for the same user: only one credit may be recorded.
3. Gift with a repeated idempotency key: it must not charge twice. Reusing a key for a different gift should yield a conflict.
4. Attempt gifts with insufficient balance, self-gifting, unjoined sender, unapproved recipient, banned sender, or ended room.
5. Run concurrent gift requests; reconcile wallet balances and ledger totals.
6. Assign agencies, accept and reject invitations, verify an agency owner cannot access another agency's report.
7. Start a battle against an approved guest, send gifts to BOTH participants, inspect score updates, end it and ensure scores stop.
8. Run actual `npm run typecheck`, `npm test`, Prisma migrations and Flutter analysis; perform real-device Agora tests. **None are confirmed passing in this turn.**

## Requirements before real-money operations

**Rivo Coins, creator earnings and agency percentages are NOT yet money.** Before enabling purchases or payouts, design and audit:

- Platform-supported mobile in-app purchases and an authoritative purchase-verification backend;
- A financial double-entry ledger and immutable receipts, refunds, chargebacks and reconciliation;
- Anti-fraud, throttling, idempotent webhooks, gift spam prevention and account limits;
- Business/legal review covering minors, age verification, taxes, payouts, creator identity verification, AML/KYC obligations where applicable, app-store rules and regional regulations;
- Clear terms describing virtual-item value and refund policies, and transparent agency commission agreements;
- A payout-provider integration with withheld balances, dispute handling, minimums and tax reporting;
- Controls for agency ownership, creator consent, moderation, user bans and LIVE content safety.

In particular, the current prototype's point ledger is **not a monetary double-entry ledger**, has no real revenue backing and cannot establish a lawful or accurate cash withdrawal balance.

## Next milestone
Fix any CI/typecheck failures, apply reviewed migrations, test ledger atomicity with a real database, then build a verified mobile-app purchase and controlled earnings design—not live money transfers yet.
