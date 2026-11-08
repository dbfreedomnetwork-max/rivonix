# Rivonix Phase 5: LIVE broadcasting foundation

Status: **source committed, untested on devices**. Completely independent from SayHi.

## Features added
- Room listing, create, join, detail, and end APIs backed by PostgreSQL.
- Host-controlled room state and host-only publisher token issuance.
- Agora RTC Flutter host camera/microphone broadcasting and audience playback.
- Per-user Agora numeric UIDs with server-issued tokens (60-minute lifetime and renewal handler).
- Basic room message history and 4-second polling chat.
- Host camera toggle, microphone mute, camera switch, and end LIVE.

## Required setup
1. Create an Agora account/project and enable token authentication.
2. In `apps/api/.env`, set `AGORA_APP_ID` and `AGORA_APP_CERTIFICATE`.
   **Never put the certificate in Flutter, GitHub, or mobile build parameters.**
3. Install API packages: `cd apps/api && npm install`.
4. Run `npx prisma migrate dev --name live_rooms` and `npx prisma generate`.
5. Generate missing native app files with `cd apps/mobile && flutter create --platforms=android,ios .`.
6. Run `flutter pub get` and configure OS permissions below, then run on **two physical devices**.
7. Configure reachable HTTPS `API_BASE_URL`; localhost URLs are only for emulators.

### AndroidManifest.xml (app module)
Add permissions outside the application element:
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
```
Adjust Android SDK and permission targets according to the current Agora Flutter SDK instructions.

### iOS Info.plist
```xml
<key>NSCameraUsageDescription</key>
<string>Rivonix needs camera access to broadcast LIVE video.</string>
<key>NSMicrophoneUsageDescription</key>
<string>Rivonix needs microphone access to broadcast LIVE audio.</string>
```
Validate iOS deployment target compatibility with Agora.

## Endpoint overview
- `GET /live/rooms` — list LIVE rooms.
- `POST /live/rooms` — authenticated user starts a room.
- `GET /live/rooms/:id` — room metadata.
- `POST /live/rooms/:id/join` — authenticated, server-scoped Agora RTC token.
- `POST /live/rooms/:id/end` — room owner only.
- `GET /live/rooms/:id/messages` — recent 50 chat messages.
- `POST /live/rooms/:id/messages` — only authenticated room members.

## Important limitations before launch
- RTC is not tested yet. The platform currently lacks committed native Android/iOS shells.
- Agora credentials must be supplied before enabling LIVE.
- Tokens are role-scoped by the server, but Agora subscriber restrictions need Agora-side security configuration validation. Do not rely on the client role alone.
- Server currently has no kicks, bans, reporting, moderation, age-verification, abuse detection, streamer verification, or admin overrides.
- Room heartbeats, viewer presence, ended-room detection, stale-room cleanup and live streaming recording are not implemented.
- Chat uses REST polling (not WebSockets); no spam controls beyond the general API limiter.
- End LIVE marks the room ended in the database. Existing participants' Agora RTC sessions are not forcibly disconnected server-side.
- Simultaneous room-start requests and rare numeric UID collisions need transaction/retry hardening.
- No guest/cohost seats, gifting, battles, wallets or cashouts yet.
- API build, migrations, Flutter analysis, permission dialogs, camera switching and real two-device broadcasts **must be tested** before treating this as working.

## Smoke-test plan
1. Register host and audience accounts on separate devices.
2. Host: start room, accept camera and microphone permissions, observe local preview.
3. Audience: refresh LIVE list, join room, see and hear broadcaster.
4. Host: mute mic, disable camera, switch camera; verify changes for audience.
5. Both: send messages and verify visibility.
6. Audience leaves; host ends room; room should disappear from LIVE list.
7. Check unauthorized end (403), invalid room (404), non-member chat (403), and missing credentials (503).
8. Test token renewal after ~1 hour and app suspension/network recovery.

Agora SDK reference: https://pub.dev/packages/agora_rtc_engine
Agora server token docs: https://docs.agora.io/en/realtime-media/rtc/build/authenticate-users/deploy-token-server
