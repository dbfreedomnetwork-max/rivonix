import test from 'node:test';
import assert from 'node:assert/strict';
import { demoEconomyEnabled, GIFT_CATALOG, splitDemoGift } from './economy_policy.js';

test('demo economy is disabled by default and always disabled in production',()=>{
  assert.equal(demoEconomyEnabled({NODE_ENV:'production',RIVONIX_DEMO_ECONOMY:'true'}),false);
  assert.equal(demoEconomyEnabled({NODE_ENV:'development'}),false);
  assert.equal(demoEconomyEnabled({NODE_ENV:'test',RIVONIX_DEMO_ECONOMY:'true'}),true);
});

test('catalog costs are positive integer points',()=>{
  for(const gift of Object.values(GIFT_CATALOG)){
    assert.ok(Number.isSafeInteger(gift.coins));
    assert.ok(gift.coins>0);
  }
});

test('splits retain every point without creating extra value',()=>{
  for(const amount of [1,10,50,100,101,10000]){
    for(const hasAgency of [true,false]){
      const result=splitDemoGift(amount,hasAgency);
      assert.equal(result.creator+result.agency+result.platform,amount);
      assert.ok(result.creator>=0 && result.agency>=0 && result.platform>=0);
      if(!hasAgency)assert.equal(result.agency,0);
    }
  }
});
test('invalid demo prices are rejected',()=>{
  assert.throws(()=>splitDemoGift(-1,true));
  assert.throws(()=>splitDemoGift(1.5,true));
});
