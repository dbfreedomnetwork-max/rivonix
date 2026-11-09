# Phase 7 — LIVE moderation and authorization tests

The Rivonix Flutter + TypeScript implementation includes:
- Host-only room bans and host removal of guest seats.
- Room ban enforcement on RTC token mint/renewal, reading chat, sending chat, and seat management.
- Host-visible list of accounts that have joined a room (first 100; **not live presence**).
- Audience LIVE reports stored for later human review.
- Flutter Safety & moderation panel (report button, host removal interface).
- Flutter five-second room-state checks: exit room if ended/banned. This is **polling**, not instantaneous server-initiated RTC disconnection.
- Unit-tested pure policy helpers for publisher roles and host authority. CI now runs `npm test` for the API.

## Run checks

In `apps/api`:

```sh
npm install
npx prisma migrate dev --name live_moderation
npx prisma generate
npm run typecheck
npm test
```

In `apps/mobile`:

```sh
flutter pub get
flutter analyze
flutter run
```

The repository still requires generated native project files and Agora/Android/iOS setup. Run on multiple real devices to validate camera, microphone, room updates and permission behavior.

## Security limitations / not production ready

**Bans are not immediate RTC ejections.** Previously issued Agora publisher tokens can remain usable until their expiration. Implement Agora-side privilege revocation and a real-time control channel; also coordinate disconnects with room ending and user moderation.
**Reports are saved only.** No staffed moderation queue, case-management, escalation, appeals, user safety tools or admin review workflow exists.
**Joined users are not necessarily online.** Host viewer list is based on recorded joins, with no heartbeats or presence expiration.
**Polling is not real-time.** Flutter checks room status every five seconds. Guest-seat status is also polled.
**The report endpoint lacks dedicated per-user spam controls** beyond the global API limiter. Add rate limits and moderation audit logs.
**Room creation and seat operations still need race-condition and integration testing.** Unit tests cover pure policy decisions, not database or Agora security guarantees.
**No actual device/RTC broadcast has been verified** and CI status checks may not be accessible through this connector.

## Next priority
Deploy dev infrastructure, generate native Flutter shells, run full CI and multi-device tests, then implement real-time moderation/room presence and server-driven Agora privilege revocation before gifts or monetization.
