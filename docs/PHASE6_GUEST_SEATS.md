# Phase 6 — LIVE Guest Seats (development)

Independent Flutter/Dart + Node/Prisma implementation, no SayHi code.

## Scope implemented
- Nine participants on camera maximum: **one host plus eight guests**.
- `LiveGuestSeat` has status REQUESTED, INVITED, ACTIVE, DECLINED, REMOVED and a nullable numbered seat 1–8.
- Audience can request a seat. The host can approve requests, invite members, reject requests and remove guests.
- Invitees must accept before receiving publishing privileges. Guests can leave their seats.
- The `/live/rooms/:id/join` token endpoint checks current seat status and grants a publishing role only to the host or an ACTIVE guest. Token TTL is 120 seconds.
- Flutter polls seat state, shows guest-seat controls, switches roles after approval/removal, and lays out up to nine video tiles.
- Seat assignment uses serializable Prisma transactions and uniqueness constraints to reduce race conditions.

## API additions
- `GET /live/rooms/:id/seats`: active seats and the calling user's requests/invitations; host also sees pending requests.
- `POST /live/rooms/:id/seats/request`: joined viewer requests a guest seat.
- `POST /live/rooms/:id/seats/invite`: host invites a joined viewer by account ID.
- `POST /live/rooms/:id/seats/:userId/approve`: host approves a requested seat.
- `POST /live/rooms/:id/seats/accept`: invited viewer consents to take a seat.
- `DELETE /live/rooms/:id/seats/:userId`: host removes/rejects, or user leaves/cancels.

## Run and verify
1. Apply Prisma migration from `apps/api`: `npx prisma migrate dev --name guest_seats`, then `npx prisma generate`.
2. Install dependencies and run API type checking: `npm install && npm run typecheck`.
3. Configure Agora token credentials on the **server only**, and native Flutter camera/microphone permissions.
4. Run `flutter pub get && flutter analyze` in `apps/mobile`. Build and run on real Android/iOS devices.
5. Test one host and nine separate audience accounts: approve eight guests; verify the ninth is denied (409).
6. Test rejection, invitation acceptance, seat release, duplicate approvals, races from two host actions, token expiration/renewal and guest role transition.
7. Test rapid disconnects, network changes, host termination and device pause/resume.

## Limitations that block public launch
- **This is not a tested production co-host service.** No multi-device RTC test or build verification has been completed.
- Seat removal/rejection does **not** instantly revoke an RTC token already issued. The old token can remain usable until expiry; implement Agora-side channel privilege revocation/kick and a server-enforced disconnect path.
- Room-ending enforcement, ban lists, host moderation/reporting, user blocking, safety tooling and abuse detection need completion.
- No speaker-only roles, guest queue priority, co-host invite notifications, realtime presence, reconnect cleanup or persistent stage layout yet.
- Host invitations currently take the viewer's account ID; replace with a joined-viewer picker.
- Status polling is every five seconds. Replace with authenticated realtime events and server-side permission rechecks before production.
- Each approved guest still needs device camera/microphone permission and a functioning Agora configuration.
- The basic host and audience identity design and Agora RTC roles must be validated against the Agora project configuration before launch.
- Use short-lived tokens with secure renewal and protect all endpoints with granular per-user limits. The original project still requires a complete security audit.

## Next milestone
Hardening and test automation first; then joined-viewer picking, realtime stage presence, host kicks, reporting/moderation, and a controlled guest queue before LIVE gifts and battles.
