import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { RtcRole, RtcTokenBuilder } from 'agora-token';
import { randomBytes, randomInt } from 'node:crypto';
import { z } from 'zod';

type Authed = Request & { userId?: string };
type AsyncRoute = (handler: (req: Authed, res: Response) => Promise<void>) => RequestHandler;
type Auth = (req: Authed, res: Response, next: NextFunction) => void;
const hostSelect = { id: true, username: true, displayName: true, avatarUrl: true } as const;
const roomInclude = { host: { select: hostSelect } } as const;
const TTL_SECONDS = 120; // Short-lived RTC privilege; revocation is not instantaneous.

function agoraCredentials() {
  const appId = process.env.AGORA_APP_ID ?? '';
  const cert = process.env.AGORA_APP_CERTIFICATE ?? '';
  if (!/^[0-9a-f]{32}$/i.test(appId) || !/^[0-9a-f]{32}$/i.test(cert)) return null;
  return { appId, cert };
}

// Publisher tokens are restricted to host or currently approved guest seats.
// Agora subscriber roles alone may not provide sufficient protection against
// unauthorized publishing in every Agora configuration; enable Agora's
// cohost/authentication controls and monitor channels before production.
export function registerLiveRoutes(app: Express, db: PrismaClient, auth: Auth, asyncRoute: AsyncRoute) {
  app.get('/live/rooms', asyncRoute(async (_req, res) => {
    const items = await db.liveRoom.findMany({
      where: { status: 'LIVE' },
      take: 30,
      orderBy: { startedAt: 'desc' },
      include: roomInclude,
    });
    res.json({ items });
  }));

  app.post('/live/rooms', auth, asyncRoute(async (req, res) => {
    if (!agoraCredentials()) {
      res.status(503).json({ error: 'LIVE streaming has not been configured by the administrator' });
      return;
    }
    const { title } = z.object({ title: z.string().trim().min(3).max(120) }).parse(req.body);
    const existing = await db.liveRoom.findFirst({ where: { hostId: req.userId!, status: 'LIVE' } });
    if (existing) {
      res.status(409).json({ error: 'End your existing LIVE room before starting another' });
      return;
    }
    const room = await db.liveRoom.create({
      data: { title, hostId: req.userId!, channel: 'rv_' + randomBytes(16).toString('hex') },
      include: roomInclude,
    });
    res.status(201).json(room);
  }));

  app.get('/live/rooms/:id', asyncRoute(async (req, res) => {
    const room = await db.liveRoom.findUnique({ where: { id: req.params.id }, include: roomInclude });
    if (!room) { res.status(404).json({ error: 'LIVE room not found' }); return; }
    res.json(room);
  }));

  app.post('/live/rooms/:id/join', auth, asyncRoute(async (req, res) => {
    const credentials = agoraCredentials();
    if (!credentials) { res.status(503).json({ error: 'Agora is not configured' }); return; }
    const room = await db.liveRoom.findUnique({ where: { id: req.params.id } });
    if (!room || room.status !== 'LIVE') {
      res.status(404).json({ error: 'LIVE room is unavailable' }); return;
    }
    const isHost = room.hostId === req.userId!;
    let member = await db.liveParticipant.findUnique({
      where: { roomId_userId: { roomId: room.id, userId: req.userId! } },
    });
    if (!member) {
      // Each user keeps a stable Agora numeric UID within a room for renewals.
      member = await db.liveParticipant.create({
        data: { roomId: room.id, userId: req.userId!, agoraUid: randomInt(1, 2147483647) },
      });
    }
    const guestSeat = isHost ? null : await db.liveGuestSeat.findUnique({
      where:{roomId_userId:{roomId:room.id,userId:req.userId!}},
      select:{status:true,seatNumber:true}
    });
    const canPublish = isHost || (guestSeat?.status === 'ACTIVE' && guestSeat.seatNumber !== null);
    const expireAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;
    const rtcToken = RtcTokenBuilder.buildTokenWithUid(
      credentials.appId, credentials.cert, room.channel, member.agoraUid,
      canPublish ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER, expireAt, expireAt,
    );
    res.json({
      appId: credentials.appId, channel: room.channel, uid: member.agoraUid,
      token: rtcToken, expiresAt: expireAt,
      role: isHost ? 'host' : canPublish ? 'guest' : 'audience',
    });
  }));

  app.post('/live/rooms/:id/end', auth, asyncRoute(async (req, res) => {
    const room = await db.liveRoom.findUnique({ where: { id: req.params.id } });
    if (!room) { res.status(404).json({ error: 'LIVE room not found' }); return; }
    if (room.hostId !== req.userId) {
      res.status(403).json({ error: 'Only the host can end this room' }); return;
    }
    const updated = await db.liveRoom.update({
      where: { id: room.id },
      data: { status: 'ENDED', endedAt: room.endedAt ?? new Date() },
      include: roomInclude,
    });
    res.json(updated);
  }));

  // REST polling chat is a development baseline, not a high-volume realtime service.
  app.get('/live/rooms/:id/messages', asyncRoute(async (req, res) => {
    const room = await db.liveRoom.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!room) { res.status(404).json({ error: 'LIVE room not found' }); return; }
    const items = await db.liveMessage.findMany({
      where: { roomId: room.id }, take: 50, orderBy: { createdAt: 'desc' },
      include: { user: { select: hostSelect } },
    });
    res.json({ items: items.reverse() });
  }));

  app.post('/live/rooms/:id/messages', auth, asyncRoute(async (req, res) => {
    const { text } = z.object({ text: z.string().trim().min(1).max(250) }).parse(req.body);
    const room = await db.liveRoom.findUnique({ where: { id: req.params.id } });
    if (!room || room.status !== 'LIVE') {
      res.status(404).json({ error: 'Room no longer LIVE' }); return;
    }
    const member = await db.liveParticipant.findUnique({
      where: { roomId_userId: { roomId: room.id, userId: req.userId! } },
    });
    if (!member) { res.status(403).json({ error: 'Join the room before chatting' }); return; }
    const message = await db.liveMessage.create({
      data: { roomId: room.id, userId: req.userId!, text },
      include: { user: { select: hostSelect } },
    });
    res.status(201).json(message);
  }));
}
