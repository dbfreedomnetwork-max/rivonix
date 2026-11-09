# Phase 9 — Build verification and repeatable local setup

This milestone strengthens the **build-and-test pipeline**. It does not mean the full app has passed compilation, API integration tests or real-device RTC tests.

## Continuous integration

The `.github/workflows/ci.yml` pipeline is configured to:
- Validate the Prisma schema using a dummy local-only `DATABASE_URL`.
- Generate the Prisma client, type-check, run existing unit tests, and compile the TypeScript backend.
- Install Flutter, generate Android and iOS native shells for the code-only starter, add required permissions, fetch packages, analyze Dart source, run a widget smoke test, then attempt a debug Android APK build.
- Upload a debug APK artifact on a successful build; APKs are **not signed release builds**.

Important: GitHub has **not confirmed the pipeline is passing** through available status checks. Generated native folders are not checked into the repository. For production applications, review and commit native project configuration, package names, permissions, SDK levels, and signing settings rather than repeatedly generating them.

## Start the API locally

Install Node.js 22+, Docker, and npm, then from the repository root:

```sh
docker compose up -d db
cd apps/api
cp .env.example .env
# Edit .env: use a randomly generated JWT_SECRET and Agora credentials for LIVE.
npm install
npx prisma migrate dev --name initial_development
npx prisma generate
npm run typecheck
npm test
npm run build
npm run dev
```

The project has schema definitions but no committed migration history. Generate and inspect the initial migration on a **new development database**. Existing databases require a migration plan; do not reset production data.

## Start Flutter locally

Install Flutter stable, Android tooling, and (for iOS) Xcode on a Mac.

```sh
cd apps/mobile
flutter create --project-name rivonix --platforms=android,ios .
bash ../../scripts/configure_mobile_permissions.sh
flutter pub get
flutter analyze
flutter test
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000
```

`10.0.2.2` reaches the local host from the standard Android emulator. Physical Android devices need a reachable HTTPS server address; iOS simulator typically reaches the host at localhost. HTTP is for development only and might require native cleartext transport exceptions—do not loosen transport policy for production.

## Manual device checklist

- Register and log in, close and relaunch the app, and load Home.
- Publish a text post, a photo, a video, and verify network errors are handled.
- Search, follow, comment, and edit profile.
- Run two accounts/devices for Agora LIVE, check microphone/camera permission prompts, RTC token renewal, guest-seat changes, ban handling, end-of-room behavior and chat.
- Verify a normal user receives 403 on administrator routes.
- Apply a reviewed database migration and test admin review decisions.
- Test Android and iOS with stable SDK versions; video codec/device compatibility matters.

## Known release blockers

- Actual GitHub Actions runs, typecheck results, test execution and APK compilation are unverified.
- A reproducible API package-lock and committed migration history are still missing; the workflow uses `npm install` rather than `npm ci`.
- Native Flutter source is generated in CI, not source-controlled.
- No real database/API integration tests or multi-device RTC tests.
- Agora credentials, deployment, durable media storage, moderation operations, user verification and launch security review are still outstanding.
- Store-signing credentials, Android application ID, iOS bundle identifier, app icons, privacy policies and production builds are not configured.

**Next milestone:** inspect and fix CI failures, commit native shells and lockfiles after validated generation, add database integration tests, and verify two-device LIVE behavior before monetization.
