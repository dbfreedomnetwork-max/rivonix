# Phase 4 — Video Posts and Reels (development implementation)

This phase adds `Post.videoUrl`, the `/uploads/video` multipart endpoint,
`/reels` paginated API, a Flutter MP4 picker, and a vertically swiped video player.

## Local setup

1. Start PostgreSQL and configure `apps/api/.env`.
2. In `apps/api`, run `npm install`, `npx prisma migrate dev --name reels_video`,
   `npx prisma generate`, `npm run typecheck`, then `npm run dev`.
   Existing databases need the schema migration before the API runs.
3. In `apps/mobile`, generate missing platform files if required using
   `flutter create --platforms=android,ios .`, then run
   `flutter pub get`, `flutter analyze`, and `flutter run` with a
   reachable `API_BASE_URL`.
4. Open Home > Reels, select the add icon, pick a supported MP4,
   enter an optional caption, and publish. Swipe vertically to browse.
   Android emulator can use `http://10.0.2.2:4000` locally. Production must use HTTPS.

## Limitations / security before production

- Only MP4 files up to 25 MiB are accepted. The API checks the file header
  for the MP4 container signature but **does not** transcode, inspect codecs,
  detect malware, or verify duration. Some MP4 encodings will not play on all devices.
- Files are stored on the local API server and served publicly from `/media`.
  They are lost if ephemeral infrastructure is restarted. Use persistent
  object storage, private upload staging, signed URLs, CDN and lifecycle
  cleanup in production.
- Implement a media processing worker (FFmpeg or managed transcoder),
  thumbnail generation, playback variants, content safety and abuse
  moderation, upload quotas and rate limits, copyright handling,
  access control, deletion and orphan cleanup.
- The Reels feed is chronological, not a ranking/recommendation system.
  Like counts shown in the player are not optimistically refreshed.
- Native Android/iOS project setup and platform permissions still require review.
- Code has been committed but Flutter builds, runtime video playback and API
  integration tests have **not** been independently verified.

## Next milestone
Build a reliable media pipeline before LIVE: transcoding, HLS playback,
resumable uploads, moderation, and automated tests.
