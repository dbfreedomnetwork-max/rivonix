import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { canReviewReports } from './admin_policy.js';

type Authed = Request & { userId?: string };
type AsyncRoute = (handler: (req: Authed, res: Response) => Promise<void>) => RequestHandler;
type Auth = (req: Authed, res: Response, next: NextFunction) => void;

export function registerAdminRoutes(app: Express, db: PrismaClient, auth: Auth, asyncRoute: AsyncRoute) {
  // Verify role from the database every request; JWTs never carry trusted admin privileges.
  const adminGuard: RequestHandler = (req, res, next) => {
    void (async () => {
      const user = await db.user.findUnique({
        where: { id: (req as Authed).userId! }, select: { role: true },
      });
      if (!user || !canReviewReports(user.role)) {
        res.status(403).json({ error: 'Administrator permission required' });
        return;
      }
      next();
    })().catch(next);
  };

  app.get('/admin/reports', auth, adminGuard, asyncRoute(async (req, res) => {
    const { status, limit, cursor } = z.object({
      status: z.enum(['OPEN','REVIEWED','DISMISSED']).default('OPEN'),
      limit: z.coerce.number().int().min(1).max(50).default(25),
      cursor: z.string().cuid().optional(),
    }).parse(req.query);
    const items = await db.liveReport.findMany({
      where: { status },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, roomId: true, reporterId: true, subjectId: true,
        reason: true, status: true, createdAt: true, reviewedAt: true,
        reviewedById: true, reviewNote: true,
        room: { select: { id: true, title: true, status: true, hostId: true } },
      },
    });
    const hasMore = items.length > limit;
    const page = items.slice(0, limit);
    res.json({ items: page, nextCursor: hasMore ? page[page.length - 1].id : null });
  }));

  app.patch('/admin/reports/:id', auth, adminGuard, asyncRoute(async (req, res) => {
    const { status, note } = z.object({
      status: z.enum(['REVIEWED','DISMISSED']),
      note: z.string().trim().min(3).max(1000),
    }).strict().parse(req.body);

    // Only open reports can be resolved; concurrent updates cannot silently overwrite.
    const changed = await db.liveReport.updateMany({
      where: { id: req.params.id, status: 'OPEN' },
      data: { status, reviewNote: note, reviewedById: req.userId!, reviewedAt: new Date() },
    });
    if (changed.count !== 1) {
      res.status(409).json({ error: 'Report not found or already resolved' });
      return;
    }
    const report = await db.liveReport.findUniqueOrThrow({
      where: { id: req.params.id }, select: {
        id: true, status: true, reviewedAt: true, reviewedById: true, reviewNote: true,
      },
    });
    res.json(report);
  }));
}
