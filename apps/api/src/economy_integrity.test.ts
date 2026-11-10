import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { giftLedgerBalanced, isRetryableTransactionError, sameGiftRequest, withSerializableRetry } from './economy_integrity.js';

test('idempotency replay matches the same recipient, room and gift',()=>{
  const original={roomId:'room-one',recipientId:'creator-one',giftCode:'rose'};
  assert.equal(sameGiftRequest(original,{...original}),true);
  assert.equal(sameGiftRequest(original,{...original,recipientId:'creator-two'}),false);
  assert.equal(sameGiftRequest(original,{...original,giftCode:'star'}),false);
  assert.equal(sameGiftRequest(original,{...original,roomId:'room-two'}),false);
});

test('demo gift allocation must exactly conserve the spent points',()=>{
  assert.equal(giftLedgerBalanced({costCoins:100,creatorPoints:50,agencyPoints:15,platformPoints:35}),true);
  assert.equal(giftLedgerBalanced({costCoins:100,creatorPoints:50,agencyPoints:15,platformPoints:36}),false);
  assert.equal(giftLedgerBalanced({costCoins:100,creatorPoints:50,agencyPoints:-1,platformPoints:51}),false);
  assert.equal(giftLedgerBalanced({costCoins:1.5,creatorPoints:1,agencyPoints:0,platformPoints:0.5}),false);
});

test('retry serializable transaction conflicts but not arbitrary failures',async()=>{
  let attempts=0;
  const transient=()=>new Prisma.PrismaClientKnownRequestError('serialization failure',{
    code:'P2034',clientVersion:'6.0.0'
  });
  assert.equal(isRetryableTransactionError(transient()),true);
  const result=await withSerializableRetry(async()=>{
    attempts++;
    if(attempts<3)throw transient();
    return 'committed';
  });
  assert.equal(result,'committed');
  assert.equal(attempts,3);

  let rejectedAttempts=0;
  await assert.rejects(withSerializableRetry(async()=>{
    rejectedAttempts++;
    throw new Error('invalid business operation');
  }),/invalid business operation/);
  assert.equal(rejectedAttempts,1);
});

test('serializable retry has a strict maximum attempt count',async()=>{
  let attempts=0;
  await assert.rejects(withSerializableRetry(async()=>{
    attempts++;
    throw new Prisma.PrismaClientKnownRequestError('conflict',{code:'P2034',clientVersion:'6.0.0'});
  },3));
  assert.equal(attempts,3);
});
