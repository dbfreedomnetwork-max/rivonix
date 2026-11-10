import type { Express, Request, RequestHandler, Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { demoEconomyEnabled, GIFT_CATALOG, splitDemoGift } from './economy_policy.js';

type Authed = Request & { userId?: string };
type AsyncRoute = (handler:(req:Authed,res:Response)=>Promise<void>)=>RequestHandler;
const cuid = z.string().cuid();
const giftCode = z.enum(['rose','star','comet']);
const demoGuard: RequestHandler = (_req,res,next) => {
  if (!demoEconomyEnabled()) {
    res.status(503).json({error:'Virtual economy is disabled; no purchases or payouts are available'});
    return;
  }
  next();
};
async function wallet(db:PrismaClient,userId:string) {
  return db.rivoWallet.upsert({where:{userId},create:{userId},update:{}});
}
async function roomMember(db:PrismaClient,roomId:string,userId:string) {
  const room = await db.liveRoom.findUnique({where:{id:roomId}});
  if (!room || room.status !== 'LIVE') return null;
  const member=await db.liveParticipant.findUnique({where:{roomId_userId:{roomId,userId}}});
  const banned=await db.liveRoomBan.findUnique({where:{roomId_userId:{roomId,userId}}});
  return member && !banned ? room : null;
}

export function registerEconomyRoutes(app:Express,db:PrismaClient,auth:RequestHandler,asyncRoute:AsyncRoute) {
  // Catalog and balance do not imply purchasing, redeemability or monetary value.
  app.get('/rivo/catalog',(_req,res)=>res.json({
    currency:'DEMO_POINTS',purchasable:false,redeemable:false,
    gifts:Object.entries(GIFT_CATALOG).map(([code,g])=>({code,...g}))
  }));
  app.get('/rivo/wallet',auth,demoGuard,asyncRoute(async(req,res)=>{
    res.json({...(await wallet(db,req.userId!)),currency:'DEMO_POINTS',cashValue:null});
  }));
  app.get('/rivo/ledger',auth,demoGuard,asyncRoute(async(req,res)=>{
    const limit=z.coerce.number().int().min(1).max(50).default(20).parse(req.query.limit);
    const items=await db.rivoLedgerEntry.findMany({where:{userId:req.userId!},take:limit,
      orderBy:{createdAt:'desc'}});
    res.json({items});
  }));

  app.get('/rivo/creator/summary',auth,demoGuard,asyncRoute(async(req,res)=>{
    const userId=req.userId!;
    const [received,membership]=await Promise.all([
      db.rivoGift.aggregate({
        where:{recipientId:userId},
        _count:{_all:true},
        _sum:{creatorPoints:true,costCoins:true}
      }),
      db.rivoAgencyMember.findUnique({where:{creatorId:userId},
        include:{agency:{select:{id:true,name:true}}}})
    ]);
    res.json({
      currency:'DEMO_POINTS',cashValue:null,withdrawable:false,
      giftCount:received._count._all,
      creatorPointsEarned:received._sum.creatorPoints??0,
      coinValueOfGiftsReceived:received._sum.costCoins??0,
      agency:membership?.status==='ACTIVE'?membership.agency:null
    });
  }));

  // One-time free demo credit per account. Disabled automatically in production.
  // Unique operation ID makes retries safe.
  app.post('/rivo/demo-credit',auth,demoGuard,asyncRoute(async(req,res)=>{
    const userId=req.userId!;
    const result=await db.$transaction(async tx=>{
      const already=await tx.rivoLedgerEntry.findUnique({
        where:{userId_walletType_operationId:{userId,walletType:'coins',operationId:'demo-onboarding-v1'}}
      });
      if(already) return {credited:false};
      await tx.rivoWallet.upsert({
        where:{userId},create:{userId,coins:500},update:{coins:{increment:500}}
      });
      await tx.rivoLedgerEntry.create({data:{
        userId,walletType:'coins',delta:500,kind:'DEMO_GRANT',operationId:'demo-onboarding-v1'
      }});
      return {credited:true};
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
    res.json({...result,wallet:await wallet(db,userId)});
  }));

  // A gift can be sent only to host or an ACTIVE guest in the sender's current room.
  // The idempotency key is client generated and prevents duplicate charges on retry.
  app.post('/rivo/gifts',auth,demoGuard,asyncRoute(async(req,res)=>{
    const input=z.object({
      roomId:cuid,recipientId:cuid,giftCode,idempotencyKey:z.string().uuid()
    }).strict().parse(req.body);
    const senderId=req.userId!;
    const room=await roomMember(db,input.roomId,senderId);
    if(!room){res.status(403).json({error:'Join an active LIVE room to send a gift'});return;}
    if(senderId===input.recipientId){res.status(400).json({error:'Cannot gift yourself'});return;}
    const isHost=input.recipientId===room.hostId;
    const guest=isHost?null:await db.liveGuestSeat.findUnique({
      where:{roomId_userId:{roomId:room.id,userId:input.recipientId}}
    });
    if(!isHost && guest?.status!=='ACTIVE'){
      res.status(400).json({error:'Recipient must be the host or an approved guest'});return;
    }
    const price=GIFT_CATALOG[input.giftCode].coins;
    try {
      const gift=await db.$transaction(async tx=>{
        const existing=await tx.rivoGift.findUnique({
          where:{senderId_idempotencyKey:{senderId,idempotencyKey:input.idempotencyKey}}
        });
        if(existing){
          if(existing.roomId!==input.roomId || existing.recipientId!==input.recipientId ||
             existing.giftCode!==input.giftCode) throw new Error('IDEMPOTENCY_CONFLICT');
          return existing;
        }
        const changed=await tx.rivoWallet.updateMany({
          where:{userId:senderId,coins:{gte:price}},
          data:{coins:{decrement:price}}
        });
        if(changed.count!==1) throw new Error('INSUFFICIENT_COINS');
        const membership=await tx.rivoAgencyMember.findUnique({where:{creatorId:input.recipientId}});
        const agencyId=membership?.status==='ACTIVE'?membership.agencyId:null;
        const parts=splitDemoGift(price,Boolean(agencyId));
        await tx.rivoWallet.upsert({
          where:{userId:input.recipientId},
          create:{userId:input.recipientId,creatorPoints:parts.creator},
          update:{creatorPoints:{increment:parts.creator}}
        });
        const agency=agencyId?await tx.rivoAgency.findUnique({where:{id:agencyId}}):null;
        if(agency && parts.agency>0){
          await tx.rivoWallet.upsert({
            where:{userId:agency.ownerId},
            create:{userId:agency.ownerId,agencyPoints:parts.agency},
            update:{agencyPoints:{increment:parts.agency}}
          });
        }
        const battle=await tx.rivoBattle.findFirst({
          where:{roomId:room.id,status:'ACTIVE',endsAt:{gt:new Date()},
            OR:[{hostId:input.recipientId},{guestId:input.recipientId}]},
          orderBy:{startedAt:'desc'}
        });
        const gift=await tx.rivoGift.create({data:{
          senderId,recipientId:input.recipientId,roomId:room.id,giftCode:input.giftCode,
          costCoins:price,creatorPoints:parts.creator,agencyPoints:parts.agency,
          platformPoints:parts.platform,agencyId:agency?.id,battleId:battle?.id,
          idempotencyKey:input.idempotencyKey
        }});
        const entries=[
          {userId:senderId,walletType:'coins',delta:-price,kind:'GIFT_SENT',operationId:gift.id},
          {userId:input.recipientId,walletType:'creatorPoints',delta:parts.creator,kind:'GIFT_RECEIVED',operationId:gift.id},
        ];
        if(agency && parts.agency>0) entries.push({
          userId:agency.ownerId,walletType:'agencyPoints',delta:parts.agency,kind:'AGENCY_SHARE',operationId:gift.id
        });
        await tx.rivoLedgerEntry.createMany({data:entries});
        if(battle)await tx.rivoBattle.update({
          where:{id:battle.id},data:input.recipientId===battle.hostId?
            {hostScore:{increment:price}}:{guestScore:{increment:price}}
        });
        return gift;
      },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
      res.status(201).json({gift,currency:'DEMO_POINTS'});
    }catch(error){
      if(error instanceof Error && error.message==='INSUFFICIENT_COINS'){
        res.status(409).json({error:'Insufficient demo coins'});return;
      }
      if(error instanceof Error && error.message==='IDEMPOTENCY_CONFLICT'){
        res.status(409).json({error:'Idempotency key already used for another gift'});return;
      }
      throw error;
    }
  }));
}
