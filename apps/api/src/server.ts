import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { Prisma, PrismaClient } from '@prisma/client';
import { z, ZodError } from 'zod';

const db = new PrismaClient();
const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? false }));
app.use(express.json({ limit: '32kb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 100, standardHeaders: 'draft-7', legacyHeaders: false }));
const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) throw new Error('Set a JWT_SECRET of at least 32 characters');
const jwtSecret: string = secret;

type Authed = Request & { userId?: string };
const asyncRoute = (handler: (req: Authed, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => { Promise.resolve(handler(req as Authed, res)).catch(next); };
const auth = (req: Authed, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) { res.status(401).json({ error: 'Authentication required' }); return; }
  try {
    const payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
    if (typeof payload !== 'object' || typeof payload.sub !== 'string') throw new Error('Invalid token');
    req.userId = payload.sub;
    next();
  } catch { res.status(401).json({ error: 'Invalid or expired session' }); }
};
const publicUser = { id: true, username: true, displayName: true, bio: true } as const;
const postInclude = { author: { select: publicUser }, _count: { select: { likes: true, comments: true } } } as const;
const credentials = z.object({ email: z.string().email().max(254).transform(s => s.toLowerCase()), password: z.string().min(10).max(128) });
const register = credentials.extend({ username: z.string().regex(/^[a-zA-Z0-9_]{3,24}$/).transform(s => s.toLowerCase()), displayName: z.string().trim().min(1).max(80) });
const issue = (id: string) => jwt.sign({}, jwtSecret, { algorithm: 'HS256', subject: id, expiresIn: '12h', issuer: 'rivonix-api' });

app.get('/health', (_req, res) => res.json({ ok: true, service: 'rivonix-api' }));
app.post('/auth/register', asyncRoute(async (req,res) => {
  const input = register.parse(req.body);
  const user = await db.user.create({ data: { email: input.email, username: input.username, displayName: input.displayName, passwordHash: await argon2.hash(input.password) }, select: publicUser });
  res.status(201).json({ token: issue(user.id), user });
}));
app.post('/auth/login', asyncRoute(async (req,res) => {
  const input = credentials.parse(req.body);
  const user = await db.user.findUnique({ where: { email: input.email } });
  if (!user || !(await argon2.verify(user.passwordHash,input.password))) { res.status(401).json({ error: 'Invalid email or password' }); return; }
  res.json({ token: issue(user.id), user: { id: user.id, username: user.username, displayName: user.displayName, bio: user.bio } });
}));
app.get('/me', auth, asyncRoute(async (req,res) => {
  const user = await db.user.findUnique({ where: { id: req.userId! }, select: publicUser });
  if (!user) { res.status(404).json({error:'Account not found'}); return; }
  res.json(user);
}));
app.patch('/me', auth, asyncRoute(async (req,res) => {
  const input = z.object({ displayName: z.string().trim().min(1).max(80).optional(), bio: z.string().max(240).optional() }).strict().parse(req.body);
  const user = await db.user.update({ where: { id: req.userId! }, data: input, select: publicUser });
  res.json(user);
}));
app.get('/posts', asyncRoute(async (req,res) => {
  const input = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(30).default(20) }).parse(req.query);
  const posts = await db.post.findMany({ take: input.limit + 1, ...(input.cursor ? { skip: 1, cursor: { id: input.cursor } } : {}), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: postInclude });
  const hasMore = posts.length > input.limit;
  const items = posts.slice(0,input.limit);
  res.json({ items, nextCursor: hasMore ? items[items.length-1]?.id : null });
}));
app.post('/posts', auth, asyncRoute(async (req,res) => {
  const { text } = z.object({ text: z.string().trim().min(1).max(2000) }).parse(req.body);
  const post = await db.post.create({ data: { text, authorId: req.userId! }, include: postInclude });
  res.status(201).json(post);
}));
app.post('/posts/:id/likes', auth, asyncRoute(async (req,res) => {
  const exists = await db.post.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!exists) { res.status(404).json({error:'Post not found'}); return; }
  await db.like.upsert({ where: { userId_postId: { userId: req.userId!, postId: req.params.id } }, create: { userId: req.userId!, postId: req.params.id }, update: {} });
  res.status(204).end();
}));
app.delete('/posts/:id/likes', auth, asyncRoute(async (req,res) => {
  await db.like.deleteMany({ where: { userId: req.userId!, postId: req.params.id } }); res.status(204).end();
}));
app.get('/posts/:id/comments', asyncRoute(async (req,res) => {
  const items = await db.comment.findMany({ where: { postId: req.params.id }, orderBy: { createdAt: 'asc' }, take: 100, include: { author: { select: publicUser } } });
  res.json({ items });
}));
app.post('/posts/:id/comments', auth, asyncRoute(async (req,res) => {
  const { text } = z.object({ text: z.string().trim().min(1).max(1000) }).parse(req.body);
  const exists = await db.post.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!exists) { res.status(404).json({error:'Post not found'}); return; }
  const comment = await db.comment.create({ data: { text, postId: req.params.id, authorId: req.userId! }, include: { author: { select: publicUser } } });
  res.status(201).json(comment);
}));
app.get('/users/:username', asyncRoute(async (req,res) => {
  const user = await db.user.findUnique({ where: { username: req.params.username.toLowerCase() }, select: { ...publicUser, _count: { select: { posts: true, followers: true, following: true } } } });
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  res.json(user);
}));
app.post('/users/:id/follow', auth, asyncRoute(async (req,res) => {
  if (req.userId === req.params.id) { res.status(400).json({error:'Cannot follow yourself'}); return; }
  const user = await db.user.findUnique({ where: { id: req.params.id }, select: { id:true } });
  if (!user) { res.status(404).json({error:'User not found'}); return; }
  await db.follow.upsert({ where: { followerId_followingId: { followerId: req.userId!, followingId: req.params.id } }, create: { followerId: req.userId!, followingId: req.params.id }, update: {} });
  res.status(204).end();
}));
app.delete('/users/:id/follow', auth, asyncRoute(async (req,res) => {
  await db.follow.deleteMany({ where: { followerId: req.userId!, followingId: req.params.id } }); res.status(204).end();
}));
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) { res.status(400).json({error:'Invalid input',details:err.flatten()});return; }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') { res.status(409).json({error:'Email or username already taken'});return; }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') { res.status(404).json({error:'Resource not found'});return; }
  console.error('Request error:',err.name);
  res.status(500).json({error:'Internal server error'});
});
const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`Rivonix API listening on ${port}`));
