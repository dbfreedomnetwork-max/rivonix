# Rivonix — Independent Flutter social app

Fresh codebase, **no SayHi source, APIs, dependencies or assets**.

## Stack
- **Flutter/Dart:** Android and iOS application, five-tab navigation, account registration/login, post creation/feed, profile, LIVE and notification placeholders.
- **Node.js + Express + TypeScript:** API for authentication, posts, likes, comments, follows, and user profiles.
- **PostgreSQL + Prisma:** persistent data.
- Planned: Agora RTC with server-generated short-lived tokens, moderation, media storage, messaging, creator wallets, payouts, agency dashboard, and push notifications.

## Quick start

1. Install Node.js 22+, Docker, and Flutter SDK. Run `flutter doctor`. Initialize mobile platform shells from `apps/mobile` with `flutter create --platforms=android,ios .` (native folders are not included in the starter).
2. From the repository root run `docker compose up -d db`.
3. In `apps/api` copy `.env.example` to `.env`, set a strong secret, run `npm install`, `npx prisma migrate dev --name init`, and `npm run dev`.
4. In `apps/mobile` run `flutter pub get`, then `flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000` for Android emulator. On iOS Simulator use `http://localhost:4000`; physical devices need a reachable host. Use HTTPS in production.
5. Validate: `npm run typecheck` from `apps/api`, and `flutter analyze` from `apps/mobile`.

## Status
This is a source-code starter, **not** a finished or production-tested app. The LIVE, Explore and Notifications tabs are placeholders. No Agora RTC integration, messages, gift wallets, payouts, moderation, or verification flows have been completed. Platform shells, dependency installation, database migrations, device builds, and end-to-end tests still need to be run.

## Security
The development database credentials in `docker-compose.yml` and `.env.example` are local-only examples. Never commit real secrets or certificates. Authentication uses Argon2 password hashing and bearer tokens stored through Flutter secure storage. Before launch, add verification, password recovery, session revocation, stronger abuse controls, audit logs, production-ready secrets and HTTPS. Monetary operations must use a server-side ledger and robust fraud controls.

## Source control
GitHub: https://github.com/dbfreedomnetwork-max/rivonix

No external SayHi source was included.
