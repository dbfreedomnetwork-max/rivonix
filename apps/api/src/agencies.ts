import type { Express, Request, RequestHandler, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { demoEconomyEnabled } from './economy_policy.js';

type Authed=Request & {userId?:string};
type AsyncRoute=(handler:(req:Authed,res:Response)=>Promise<void>)=>RequestHandler;
const cuid=z.string().cuid();
const guard:RequestHandler=(_req,res,next)=>{
  if(!demoEconomyEnabled()){res.status(503).json({error:'Demo agencies are disabled'});return;}
  next();
};
export function registerAgencyRoutes(app:Express,db:PrismaClient,auth:RequestHandler,asyncRoute:AsyncRoute) {
  app.get('/rivo/agencies/mine',auth,guard,asyncRoute(async(req,res)=>{
    const owned=await db.rivoAgency.findMany({where:{ownerId:req.userId!},
      include:{members:true},take:25});
    const membership=await db.rivoAgencyMember.findUnique({where:{creatorId:req.userId!},
      include:{agency:true}});
    res.json({owned,membership});
  }));
  app.get('/rivo/agencies/:id/summary',auth,guard,asyncRoute(async(req,res)=>{
    const agency=await db.rivoAgency.findUnique({where:{id:req.params.id}});
    if(!agency){res.status(404).json({error:'Agency not found'});return;}
    if(agency.ownerId!==req.userId){res.status(403).json({error:'Agency owner only'});return;}
    const [gifts,members]=await Promise.all([
      db.rivoGift.aggregate({where:{agencyId:agency.id},
        _count:{_all:true},_sum:{agencyPoints:true}}),
      db.rivoAgencyMember.findMany({where:{agencyId:agency.id},
        select:{creatorId:true,status:true,joinedAt:true},take:100})
    ]);
    res.json({
      agency:{id:agency.id,name:agency.name},
      giftCount:gifts._count._all,
      demoAgencyPoints:gifts._sum.agencyPoints??0,
      members,
      currency:'DEMO_POINTS',cashValue:null,withdrawable:false
    });
  }));

  app.post('/rivo/agencies',auth,guard,asyncRoute(async(req,res)=>{
    const {name}=z.object({name:z.string().trim().min(3).max(100)}).strict().parse(req.body);
    const agency=await db.rivoAgency.create({data:{ownerId:req.userId!,name}});
    res.status(201).json({agency});
  }));
  // Agencies can invite a creator, but creators opt-in before association or shares.
  app.post('/rivo/agencies/:id/invite',auth,guard,asyncRoute(async(req,res)=>{
    const {creatorId}=z.object({creatorId:cuid}).strict().parse(req.body);
    const agency=await db.rivoAgency.findUnique({where:{id:req.params.id}});
    if(!agency){res.status(404).json({error:'Agency not found'});return;}
    if(agency.ownerId!==req.userId){res.status(403).json({error:'Agency owner only'});return;}
    if(creatorId===agency.ownerId){res.status(400).json({error:'Cannot invite yourself'});return;}
    const creator=await db.user.findUnique({where:{id:creatorId},select:{id:true}});
    if(!creator){res.status(404).json({error:'Creator not found'});return;}
    const existing=await db.rivoAgencyMember.findUnique({where:{creatorId}});
    if(existing){res.status(409).json({error:'Creator already has an agency membership or invitation'});return;}
    const invitation=await db.rivoAgencyMember.create({data:{creatorId,agencyId:agency.id,status:'INVITED'}});
    res.status(201).json({invitation});
  }));
  app.post('/rivo/agencies/invitations/accept',auth,guard,asyncRoute(async(req,res)=>{
    const member=await db.rivoAgencyMember.findUnique({where:{creatorId:req.userId!}});
    if(!member || member.status!=='INVITED'){res.status(409).json({error:'No pending invitation'});return;}
    const accepted=await db.rivoAgencyMember.update({
      where:{creatorId:req.userId!},data:{status:'ACTIVE',joinedAt:new Date()}});
    res.json({membership:accepted});
  }));
  app.delete('/rivo/agencies/membership',auth,guard,asyncRoute(async(req,res)=>{
    await db.rivoAgencyMember.deleteMany({where:{creatorId:req.userId!}});
    res.status(204).end();
  }));
}
