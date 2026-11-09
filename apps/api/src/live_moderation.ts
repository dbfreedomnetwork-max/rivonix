import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';

type Authed = Request & { userId?: string };
type AsyncRoute = (handler: (req: Authed, res: Response) => Promise<void>) => RequestHandler;
type Auth = (req: Authed, res: Response, next: NextFunction) => void;
const person = { id: true, username: true, displayName: true, avatarUrl: true } as const;

export function registerLiveModeration(app: Express, db: PrismaClient, auth: Auth, asyncRoute: AsyncRoute) {
  // Authenticated participants can see room state and their own ban status.
  app.get('/live/rooms/:id/state', auth, asyncRoute(async(req,res)=>{
    const room=await db.liveRoom.findUnique({where:{id:req.params.id},
      select:{id:true,status:true,hostId:true,endedAt:true}});
    if(!room){res.status(404).json({error:'Room not found'});return;}
    const banned=await db.liveRoomBan.findUnique({where:{
      roomId_userId:{roomId:room.id,userId:req.userId!}
    }});
    res.json({...room,banned:Boolean(banned)});
  }));

  app.get('/live/rooms/:id/viewers',auth,asyncRoute(async(req,res)=>{
    const room=await db.liveRoom.findUnique({where:{id:req.params.id},select:{hostId:true,status:true}});
    if(!room || room.status!=='LIVE'){res.status(404).json({error:'Room not live'});return;}
    if(room.hostId!==req.userId){res.status(403).json({error:'Host only'});return;}
    const members=await db.liveParticipant.findMany({where:{roomId:req.params.id},
      take:100,orderBy:{joinedAt:'desc'},include:{user:{select:person}}});
    const banned=await db.liveRoomBan.findMany({where:{roomId:req.params.id},select:{userId:true}});
    const excluded=new Set(banned.map(b=>b.userId));
    res.json({items:members.filter(member=>!excluded.has(member.userId)).map(member=>({
      userId:member.userId,user:member.user,joinedAt:member.joinedAt
    }))});
  }));

  app.post('/live/rooms/:id/bans',auth,asyncRoute(async(req,res)=>{
    const input=z.object({userId:z.string().cuid(),reason:z.string().trim().max(250).optional()}).parse(req.body);
    const room=await db.liveRoom.findUnique({where:{id:req.params.id}});
    if(!room || room.status!=='LIVE'){res.status(404).json({error:'Room not live'});return;}
    if(room.hostId!==req.userId){res.status(403).json({error:'Host only'});return;}
    if(input.userId===room.hostId){res.status(400).json({error:'Cannot ban host'});return;}
    const member=await db.liveParticipant.findUnique({where:{roomId_userId:{roomId:room.id,userId:input.userId}}});
    if(!member){res.status(404).json({error:'Viewer not found'});return;}
    await db.$transaction([
      db.liveRoomBan.upsert({where:{roomId_userId:{roomId:room.id,userId:input.userId}},
        create:{roomId:room.id,userId:input.userId,reason:input.reason},update:{reason:input.reason}}),
      db.liveGuestSeat.updateMany({where:{roomId:room.id,userId:input.userId},
        data:{status:'REMOVED',seatNumber:null}})
    ]);
    res.status(204).end();
  }));

  app.delete('/live/rooms/:id/bans/:userId',auth,asyncRoute(async(req,res)=>{
    const room=await db.liveRoom.findUnique({where:{id:req.params.id}});
    if(!room){res.status(404).json({error:'Room not found'});return;}
    if(room.hostId!==req.userId){res.status(403).json({error:'Host only'});return;}
    await db.liveRoomBan.deleteMany({where:{roomId:room.id,userId:req.params.userId}});
    res.status(204).end();
  }));

  // Reports are recorded for future human review; reporting alone does not impose a ban.
  app.post('/live/rooms/:id/reports',auth,asyncRoute(async(req,res)=>{
    const input=z.object({
      subjectId:z.string().cuid().optional(),
      reason:z.string().trim().min(5).max(250)
    }).parse(req.body);
    const room=await db.liveRoom.findUnique({where:{id:req.params.id}});
    if(!room){res.status(404).json({error:'Room not found'});return;}
    const member=await db.liveParticipant.findUnique({where:{
      roomId_userId:{roomId:room.id,userId:req.userId!}}});
    if(!member){res.status(403).json({error:'Join room to report'});return;}
    const report=await db.liveReport.create({data:{
      roomId:room.id,reporterId:req.userId!,subjectId:input.subjectId,reason:input.reason
    },select:{id:true,createdAt:true}});
    res.status(201).json({reportId:report.id,createdAt:report.createdAt});
  }));
}
