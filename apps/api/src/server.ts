import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { Prisma, PrismaClient } from '@prisma/client';
import { z, ZodError } from 'zod';
import multer from 'multer';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { registerLiveRoutes } from './live.js';
import { createReadStream } from 'node:fs';

const db = new PrismaClient();
const app = express();
const uploadsRoot = path.resolve(process.cwd(), 'uploads');
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 }, fileFilter: (_req,file,cb) =>
  cb(null, ['image/jpeg','image/png','image/webp'].includes(file.mimetype))
});
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? false }));
app.use(express.json({ limit: '32kb' }));
app.use('/media', express.static(uploadsRoot, { immutable: true, maxAge: '7d', fallthrough: false }));
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
const publicUser = { id: true, username: true, displayName: true, bio: true, avatarUrl: true } as const;
const postInclude = { author: { select: publicUser }, _count: { select: { likes: true, comments: true } } } as const;
const credentials = z.object({ email: z.string().email().max(254).transform(s => s.toLowerCase()), password: z.string().min(10).max(128) });
const register = credentials.extend({ username: z.string().regex(/^[a-zA-Z0-9_]{3,24}$/).transform(s => s.toLowerCase()), displayName: z.string().trim().min(1).max(80) });
const issue = (id: string) => jwt.sign({}, jwtSecret, { algorithm: 'HS256', subject: id, expiresIn: '12h', issuer: 'rivonix-api' });

app.get('/health', (_req, res) => res.json({ ok: true, service: 'rivonix-api' }));

// Local development media storage only. Deploy with managed object storage before production.
app.post('/uploads/image', auth, photoUpload.single('image'), asyncRoute(async (req,res) => {
  const file = req.file;
  if (!file) { res.status(400).json({ error: 'JPEG, PNG or WebP image required (max 5 MB)' }); return; }
  const purpose = z.enum(['post','avatar']).parse(req.body.purpose);
  // Sharp decodes the actual bytes and re-encodes to WebP to avoid trusting MIME or embedded metadata.
  const image = sharp(file.buffer, { failOn: 'error', limitInputPixels: 16_000_000 });
  const info = await image.metadata();
  if (!['jpeg','png','webp'].includes(info.format ?? '')) { res.status(400).json({error:'Unsupported image'}); return; }
  const output = await image.rotate().resize({width: 1600,height:1600,fit:'inside',withoutEnlargement:true})
    .webp({quality:82}).toBuffer();
  const fileName = `${randomUUID()}.webp`;
  await mkdir(uploadsRoot, {recursive: true});
  await writeFile(path.join(uploadsRoot,fileName),output,{flag:'wx'});
  const record = await db.uploadedMedia.create({data:{ ownerId:req.userId!, kind:purpose, fileName }});
  res.status(201).json({mediaId:record.id,url:`/media/${fileName}`});
}));
// Development-only local uploads: 25 MiB MP4 maximum. No transcoding or virus scanner.
const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, done) => { void mkdir(uploadsRoot,{recursive:true}).then(()=>done(null,uploadsRoot),done); },
    filename: (_req, _file, done) => done(null, randomUUID()+'.mp4')
  }),
  limits: {fileSize:25*1024*1024, files:1},
  fileFilter: (_req,file,done) => done(null,file.mimetype === 'video/mp4')
});
app.post('/uploads/video',auth,videoUpload.single('video'),asyncRoute(async(req,res)=>{
  const uploaded=req.file;
  if (!uploaded) {res.status(400).json({error:'MP4 video required (max 25 MB)'});return;}
  try {
    // MP4 ISO base media files normally have 'ftyp' at byte offset four.
    const fh=createReadStream(uploaded.path,{start:0,end:11});
    const chunks:Buffer[]=[];
    for await (const chunk of fh) chunks.push(Buffer.from(chunk));
    const header=Buffer.concat(chunks);
    if(header.length < 12 || header.toString('ascii',4,8)!=='ftyp'){
      res.status(400).json({error:'Invalid MP4 container'});return;
    }
    const media=await db.uploadedMedia.create({data:{ownerId:req.userId!,kind:'video',fileName:uploaded.filename}});
    res.status(201).json({mediaId:media.id,url:`/media/${media.fileName}`});
  } finally {
    if (!res.headersSent || res.statusCode >= 400) await unlink(uploaded.path).catch(()=>{});
  }
}));

app.patch('/me/avatar',auth,asyncRoute(async(req,res)=>{
  const {mediaId}=z.object({mediaId:z.string().cuid()}).parse(req.body);
  const media=await db.uploadedMedia.findFirst({where:{id:mediaId,ownerId:req.userId!,kind:'avatar'}});
  if (!media) {res.status(400).json({error:'Avatar upload not found'});return;}
  const user=await db.user.update({where:{id:req.userId!},data:{avatarUrl:`/media/${media.fileName}`},select:publicUser});
  res.json(user);
}));

app.post('/auth/register', asyncRoute(async (req,res) => {
  const input = register.parse(req.body);
  const user = await db.user.create({ data: { email: input.email, username: input.username, displayName: input.displayName, passwordHash: await argon2.hash(input.password) }, select: publicUser });
  res.status(201).json({ token: issue(user.id), user });
}));
app.post('/auth/login', asyncRoute(async (req,res) => {
  const input = credentials.parse(req.body);
  const user = await db.user.findUnique({ where: { email: input.email } });
  if (!user || !(await argon2.verify(user.passwordHash,input.password))) { res.status(401).json({ error: 'Invalid email or password' }); return; }
  res.json({ token: issue(user.id), user: { id: user.id, username: user.username, displayName: user.displayName, bio: user.bio, avatarUrl: user.avatarUrl } });
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
app.get('/reels',asyncRoute(async(req,res)=>{
  const query=z.object({cursor:z.string().optional(),limit:z.coerce.number().int().min(1).max(20).default(12)}).parse(req.query);
  const videos=await db.post.findMany({
    where:{videoUrl:{not:null}},
    orderBy:[{createdAt:'desc'},{id:'desc'}],
    take:query.limit+1,
    ...(query.cursor?{cursor:{id:query.cursor},skip:1}:{}),
    include:postInclude,
  });
  const items=videos.slice(0,query.limit);
  res.json({items,nextCursor:videos.length>query.limit?items.at(-1)?.id:null});
}));

app.post('/posts', auth, asyncRoute(async (req,res) => {
  const input = z.object({ text: z.string().trim().max(2000).default(''), mediaId: z.string().cuid().optional(), videoMediaId: z.string().cuid().optional() }).parse(req.body);
  if (!input.text && !input.mediaId && !input.videoMediaId) {res.status(400).json({error:'Text or media required'});return;}
  if (input.mediaId && input.videoMediaId) {res.status(400).json({error:'Select either an image or video'});return;}
  let imageUrl: string | undefined;
  if (input.mediaId) {
    const media = await db.uploadedMedia.findFirst({where:{id:input.mediaId,ownerId:req.userId!,kind:'post'}});
    if (!media) {res.status(400).json({error:'Image upload not found'});return;}
    imageUrl = `/media/${media.fileName}`;
  }
  let videoUrl: string | undefined;
  if (input.videoMediaId) {
    const media=await db.uploadedMedia.findFirst({where:{id:input.videoMediaId,ownerId:req.userId!,kind:'video'}});
    if(!media){res.status(400).json({error:'Video upload not found'});return;}
    videoUrl=`/media/${media.fileName}`;
  }
  const post = await db.post.create({ data: { text: input.text, imageUrl, videoUrl, authorId: req.userId! }, include: postInclude });
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
app.get('/users/search', asyncRoute(async (req,res) => {
  const { q } = z.object({ q: z.string().trim().min(1).max(80) }).parse(req.query);
  const users = await db.user.findMany({
    where: { OR: [
      { username: { contains: q, mode: 'insensitive' } },
      { displayName: { contains: q, mode: 'insensitive' } }
    ] },
    select: publicUser,
    orderBy: { username: 'asc' },
    take: 20
  });
  res.json({ items: users });
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
registerLiveRoutes(app, db, auth, asyncRoute);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError) { res.status(400).json({error:'Image upload rejected: '+err.code});return; }
  if (err instanceof ZodError) { res.status(400).json({error:'Invalid input',details:err.flatten()});return; }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') { res.status(409).json({error:'Email or username already taken'});return; }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') { res.status(404).json({error:'Resource not found'});return; }
  console.error('Request error:',err.name);
  res.status(500).json({error:'Internal server error'});
});
const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`Rivonix API listening on ${port}`));
