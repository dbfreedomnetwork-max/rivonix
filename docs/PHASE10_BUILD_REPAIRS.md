# Rivonix Phase 10 — Native bootstrap & CI repairs

This phase repairs identifiable setup issues from Phase 9. **It does not certify that Flutter, Android, TypeScript, or Agora builds are passing.**

## Fixes committed
- The Linux CI runner bootstraps **Android only**, rather than depending on iOS project generation.
- `scripts/bootstrap_mobile.sh` makes the same setup steps reproducible locally.
- The generated Flutter starter test referencing `MyApp` is deleted; the repository test imports `Rivonix` classes.
- Android manifest includes required INTERNET, CAMERA, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS and ACCESS_NETWORK_STATE permissions; Android display name becomes Rivonix.
- Minimum Android SDK is set to 24 in the supported Gradle project variants.
- Local HTTP API access is enabled only in the **debug** Android manifest, not release.
- The optional iOS Info.plist gets Rivonix display name and camera/microphone/photo selection purpose strings if an iOS project was generated.
- GitHub Actions retains backend Prisma validation, API type-check/test/build, Flutter analyze/test and an Android debug APK build/artifact step.

## Local Android setup

Install Flutter stable, Android SDK and its licenses, Java, Node.js 22, Docker, and a PostgreSQL development database.

```bash
cd apps/mobile
bash ../../scripts/bootstrap_mobile.sh android
flutter doctor -v
flutter analyze
flutter test
flutter build apk --debug --dart-define=API_BASE_URL=https://your-development-api.example
```

On macOS with Xcode installed:

```bash
cd apps/mobile
bash ../../scripts/bootstrap_mobile.sh android,ios
flutter analyze
flutter test
```

Replace the sample API URL with your actual reachable development API. Never put production secrets into the Flutter app.

## Backend checks

```bash
cd apps/api
npm install
npx prisma validate
npx prisma generate
npm run typecheck
npm test
npm run build
```

The repository still has no committed dependency lockfiles or reviewed database migrations. Generate and validate these before production deployment.

## Review GitHub Actions

Visit https://github.com/dbfreedomnetwork-max/rivonix/actions and inspect the latest **Rivonix CI** push run. If Actions is disabled or no run is present, enable Actions for the repository. Open the failed job and inspect the first actionable error, then fix and rerun. The GitHub connection used here currently does not return push-triggered job details.

**No successful CI run or APK was verified during this phase.** Native Android and iOS project directories also remain generated at setup time, not committed permanent source files.

## Production blockers

- Android application ID and iOS bundle ID are still template values; change before app store signing.
- Native iOS permission-handler Podfile build settings and CocoaPods installation require macOS/Xcode validation.
- Android debug APK is not a production-signed or Play Store-ready build.
- Database migrations, LIVE access control, server-side media storage, creator identification, moderation, age verification, and Agora multi-device testing remain outstanding.
- Disabling a guest or banning a user does not force Agora-side immediate RTC removal.

**Next recommended development:** Inspect actual CI failures and commit fixes only after the logs identify them. Then generate and check in native app projects, verify Android/iOS builds, and run API/RTC integration tests.
