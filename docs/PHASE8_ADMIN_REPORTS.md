# Phase 8 — Administrator report review

This milestone adds a secure **development-stage** moderation review interface for Rivonix LIVE reports.

## What's implemented
- User roles: `USER` (default) and `ADMIN` (server-managed enum).
- LIVE reports have `OPEN`, `REVIEWED`, or `DISMISSED` status.
- Report review records the administrator user ID, review time, and required notes.
- `GET /admin/reports?status=OPEN&limit=25`: role-protected, paginated report queue.
- `PATCH /admin/reports/:id`: role-protected resolution of an **OPEN** report, with a required note and concurrency check.
- Flutter Profile tab shows **Review LIVE reports** only when `GET /me` returns `role=ADMIN`. All API authorization is independently enforced on the server.
- Fail-closed role-policy unit tests.

## Activate in your own development environment
1. Apply the schema update before running the API. This repository has not yet established checked-in Prisma migration history; generate and review the migration locally: `cd apps/api && npm install && npx prisma migrate dev --name admin_reports && npx prisma generate`.
2. Run `npm run typecheck && npm test`.
3. Verify an administrator's identity outside the app. To promote **one deliberately selected account** in a trusted development database, use Prisma Studio or a parameterized administrative database query. For PostgreSQL, with an independently confirmed account email and authorization:

   ```sql
   UPDATE "User" SET "role" = 'ADMIN' WHERE "email" = '<verified-account-email>';
   ```

   Do not expose role changes in public registration or account-edit endpoints. Never use a shared/public admin password. In production, use an audited, least-privilege provisioning process, strong authentication and MFA.
4. In Flutter, `flutter pub get && flutter analyze` and run a supported Android/iOS build.
5. Create a LIVE report from a normal account. Sign in as the verified administrator, open Profile > Review LIVE reports, inspect, and mark reviewed or dismissed with notes.
6. Verify `GET /admin/reports` and `PATCH /admin/reports/:id` return 403 for normal users; concurrent review of the same report must return 409 for the second reviewer.

## Important launch blockers
- **No public moderation operations are deployed or verified.** Source commits do not establish successful API compilation, schema migration, CI, or device operation.
- Reports are user-submitted claims, not verified misconduct. Decisions currently update review status only. They do not automatically ban users or terminate streams.
- This is a Flutter admin review view, **not** a full web administration portal or staffed moderation program.
- Add immutable moderation audit logs, report attachments/evidence retention rules, escalation, appeals, rate limits, moderator roles, MFA, and data access controls before production.
- LIVE room bans are not immediate Agora-side ejections. Add RTC privilege revocation and real-time control messages.
- Existing repo CI and native Flutter project setup require verification; the project is not production ready.

Repository: https://github.com/dbfreedomnetwork-max/rivonix
