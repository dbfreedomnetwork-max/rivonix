import type { Express, Request, RequestHandler, Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { demoEconomyEnabled } from './economy_policy.js';

type Authed=Request & {userId?:string};
type AsyncRoute=(handler:(req:Authed,res:Response)=>Promise<void>)=>RequestHandler;
const cuid=z.string().cuid();
const guard:RequestHandler=(_req,res,next)=>{
  if(!demoEconomyEnabled()){res.status(503).json({error:'Demo battles are disabled'});return;}
  next();
};

export function registerBattleRoutes(app:Express,db:PrismaClient,auth:RequestHandler,asyncRoute:AsyncRoute) {
  app.get('/rivo/rooms/:roomId/battle',auth,guard,asyncRoute(async(req,res)=>{
    const room=await db.liveRoom.findUnique({where:{id:req.params.roomId},select:{status:true}});
    if(!room){res.status(404).json({error:'Room not found'});return;}
    const battle=await db.rivoBattle.findFirst({where:{roomId:req.params.roomId,status:'ACTIVE'},
      orderBy:{startedAt:'desc'}});
    if(battle && battle.endsAt<=new Date()){
      const ended=await db.rivoBattle.update({where:{id:battle.id},data:{status:'ENDED',endedAt:new Date()}});
      res.json({battle:ended});
      return;
    }
    res.json({battle});
  }));

  // MVP: host challenges an already active cohost, max one battle per room.
  app.post('/rivo/rooms/:roomId/battles',auth,guard,asyncRoute(async(req,res)=>{
    const {guestId,durationSeconds}=z.object({
      guestId:cuid,durationSeconds:z.number().int().min(60).max(300).default(180)
    }).strict().parse(req.body);
    try {
      const battle=await db.$transaction(async tx=>{
        // Serialize same-room battle creation to prevent two concurrent active battles.
        // Parameterized SQL uses PostgreSQL's transaction-scoped advisory lock.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${req.params.roomId}))`;
        const room=await tx.liveRoom.findUnique({where:{id:req.params.roomId}});
        if(!room || room.status!=='LIVE')throw new Error('ROOM_NOT_LIVE');
        if(room.hostId!==req.userId)throw new Error('HOST_ONLY');
        if(guestId===room.hostId)throw new Error('BAD_GUEST');
        const seat=await tx.liveGuestSeat.findUnique({
          where:{roomId_userId:{roomId:room.id,userId:guestId}}
        });
        if(seat?.status!=='ACTIVE')throw new Error('BAD_GUEST');
        // Expired battles cannot block the next round.
        await tx.rivoBattle.updateMany({
          where:{roomId:room.id,status:'ACTIVE',endsAt:{lte:new Date()}},
          data:{status:'ENDED',endedAt:new Date()}
        });
        const existing=await tx.rivoBattle.findFirst({where:{roomId:room.id,status:'ACTIVE'}});
        if(existing)throw new Error('BATTLE_EXISTS');
        const now=new Date();
        return tx.rivoBattle.create({data:{
          roomId:room.id,hostId:room.hostId,guestId,
          endsAt:new Date(now.getTime()+durationSeconds*1000)
        }});
      },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
      res.status(201).json({battle});
    }catch(e){
      if(e instanceof Error && ['ROOM_NOT_LIVE','HOST_ONLY','BAD_GUEST','BATTLE_EXISTS'].includes(e.message)){
        res.status(e.message==='HOST_ONLY'?403:409).json({error:e.message});return;
      }
      throw e;
    }
  }));
  app.post('/rivo/battles/:id/end',auth,guard,asyncRoute(async(req,res)=>{
    const battle=await db.rivoBattle.findUnique({where:{id:req.params.id}});
    if(!battle){res.status(404).json({error:'Battle not found'});return;}
    if(battle.hostId!==req.userId){res.status(403).json({error:'Host only'});return;}
    const result=await db.rivoBattle.update({
      where:{id:battle.id},data:{status:'ENDED',endedAt:battle.endedAt??new Date()}
    });
    res.json({battle:result});
  }));
}
