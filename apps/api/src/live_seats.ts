import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';

type Authed = Request & { userId?: string };
type AsyncRoute = (handler: (req: Authed, res: Response) => Promise<void>) => RequestHandler;
type Auth = (req: Authed, res: Response, next: NextFunction) => void;
const person = { id: true, username: true, displayName: true, avatarUrl: true } as const;
const seatInclude = { user: { select: person } } as const;

// Serialize concurrent approvals/invitation acceptances, then assign a unique seat 1–8.
async function withSeatTransaction<T>(db: PrismaClient, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt=0; attempt<4; attempt++) {
    try { return await db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
    catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2034' || e.code === 'P2002') && attempt < 3) continue;
      throw e;
    }
  }
  throw new Error('Seat transaction retry limit reached');
}

class SeatError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
function respondSeatError(error: unknown, res: Response): boolean {
  if (error instanceof SeatError) { res.status(error.status).json({error:error.message}); return true; }
  return false;
}
async function activeRoom(db: PrismaClient, roomId: string) {
  const room = await db.liveRoom.findUnique({where:{id:roomId}});
  if (!room || room.status !== 'LIVE') throw new SeatError(404,'LIVE room unavailable');
  return room;
}
async function activate(tx: Prisma.TransactionClient, roomId: string, userId: string) {
  const active = await tx.liveGuestSeat.findMany({where:{roomId,status:'ACTIVE'},select:{seatNumber:true}});
  const taken = new Set(active.map(s=>s.seatNumber));
  let number: number | null = null;
  for(let i=1;i<=8;i++) if(!taken.has(i)){number=i;break;}
  if(number === null) throw new SeatError(409,'All eight guest seats are full');
  return tx.liveGuestSeat.update({
    where:{roomId_userId:{roomId,userId}},
    data:{status:'ACTIVE',seatNumber:number},
    include:seatInclude,
  });
}

export function registerSeatRoutes(app: Express, db: PrismaClient, auth: Auth, asyncRoute: AsyncRoute) {
  app.get('/live/rooms/:id/seats', auth, asyncRoute(async(req,res)=>{
    try {
      const room = await activeRoom(db,req.params.id);
      const seats = await db.liveGuestSeat.findMany({
        where:{roomId:room.id,OR:[{status:'ACTIVE'},{userId:req.userId!},...(room.hostId===req.userId ? [{status:'REQUESTED' as const},{status:'INVITED' as const}] : [])]},
        include:seatInclude,orderBy:[{seatNumber:'asc'},{createdAt:'asc'}]
      });
      res.json({hostId:room.hostId,maxParticipants:9,guestCapacity:8,seats});
    } catch(e){if(!respondSeatError(e,res))throw e;}
  }));

  // Audience member opts in to a guest seat. Host can approve; no auto-publishing.
  app.post('/live/rooms/:id/seats/request',auth,asyncRoute(async(req,res)=>{
    try{
      const room=await activeRoom(db,req.params.id);
      if(room.hostId===req.userId)throw new SeatError(400,'Host already broadcasts');
      const member=await db.liveParticipant.findUnique({where:{roomId_userId:{roomId:room.id,userId:req.userId!}}});
      if(!member)throw new SeatError(403,'Join the room first');
      const seat=await withSeatTransaction(db,async tx=>{
        const old=await tx.liveGuestSeat.findUnique({where:{roomId_userId:{roomId:room.id,userId:req.userId!}}});
        if(old?.status==='ACTIVE' || old?.status==='INVITED')return old;
        return tx.liveGuestSeat.upsert({
          where:{roomId_userId:{roomId:room.id,userId:req.userId!}},
          create:{roomId:room.id,userId:req.userId!,status:'REQUESTED'},
          update:{status:'REQUESTED',seatNumber:null},
        });
      });
      res.json(seat);
    }catch(e){if(!respondSeatError(e,res))throw e;}
  }));

  // Host may invite joined audience users by exact account ID.
  app.post('/live/rooms/:id/seats/invite',auth,asyncRoute(async(req,res)=>{
    try{
      const {userId}=z.object({userId:z.string().cuid()}).parse(req.body);
      const room=await activeRoom(db,req.params.id);
      if(room.hostId!==req.userId)throw new SeatError(403,'Only the host can invite guests');
      if(userId===room.hostId)throw new SeatError(400,'Cannot invite host');
      const member=await db.liveParticipant.findUnique({where:{roomId_userId:{roomId:room.id,userId}}});
      if(!member)throw new SeatError(404,'User has not joined this room');
      const seat=await withSeatTransaction(db,async tx=>{
        const old=await tx.liveGuestSeat.findUnique({where:{roomId_userId:{roomId:room.id,userId}}});
        if(old?.status==='ACTIVE')return old;
        return tx.liveGuestSeat.upsert({
          where:{roomId_userId:{roomId:room.id,userId}},
          create:{roomId:room.id,userId,status:'INVITED'},
          update:{status:'INVITED',seatNumber:null},
        });
      });
      res.json(seat);
    }catch(e){if(!respondSeatError(e,res))throw e;}
  }));

  // Host approves a requested seat; host approval is consent to the user's existing request.
  app.post('/live/rooms/:id/seats/:userId/approve',auth,asyncRoute(async(req,res)=>{
    try {
      const room=await activeRoom(db,req.params.id);
      if(room.hostId!==req.userId)throw new SeatError(403,'Host only');
      const seat=await withSeatTransaction(db,async tx=>{
        const current=await tx.liveGuestSeat.findUnique({where:{roomId_userId:{roomId:room.id,userId:req.params.userId}}});
        if(!current || current.status!=='REQUESTED')throw new SeatError(409,'No pending seat request');
        return activate(tx,room.id,req.params.userId);
      });
      res.json(seat);
    }catch(e){if(!respondSeatError(e,res))throw e;}
  }));

  // Invitee consents to publish by accepting the host's invitation.
  app.post('/live/rooms/:id/seats/accept',auth,asyncRoute(async(req,res)=>{
    try{
      const room=await activeRoom(db,req.params.id);
      const seat=await withSeatTransaction(db,async tx=>{
        const current=await tx.liveGuestSeat.findUnique({where:{roomId_userId:{roomId:room.id,userId:req.userId!}}});
        if(!current || current.status!=='INVITED')throw new SeatError(409,'No pending invitation');
        return activate(tx,room.id,req.userId!);
      });
      res.json(seat);
    }catch(e){if(!respondSeatError(e,res))throw e;}
  }));

  // Guest can leave; host can remove a guest or reject a pending request.
  app.delete('/live/rooms/:id/seats/:userId',auth,asyncRoute(async(req,res)=>{
    try{
      const room=await activeRoom(db,req.params.id);
      if(room.hostId!==req.userId && req.userId!==req.params.userId)throw new SeatError(403,'Not permitted');
      await db.liveGuestSeat.updateMany({
        where:{roomId:room.id,userId:req.params.userId},
        data:{status:room.hostId===req.userId?'REMOVED':'DECLINED',seatNumber:null}
      });
      res.status(204).end();
    }catch(e){if(!respondSeatError(e,res))throw e;}
  }));
}
