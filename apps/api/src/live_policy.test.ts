import test from 'node:test';
import assert from 'node:assert/strict';
import { canBan, canModerate, canPublish, validReportReason } from './live_policy.js';

test('only the host may moderate a room', () => {
  assert.equal(canModerate('host', 'host'), true);
  assert.equal(canModerate('host', 'viewer'), false);
  assert.equal(canModerate('', ''), false);
});

test('host cannot ban themselves and viewer cannot ban someone else', () => {
  assert.equal(canBan('host', 'host', 'host'), false);
  assert.equal(canBan('host', 'viewer', 'guest'), false);
  assert.equal(canBan('host', 'host', 'guest'), true);
});

test('only current active guests on seats 1 through 8 can publish', () => {
  assert.equal(canPublish('host', 'host', false, null, null), true);
  assert.equal(canPublish('host', 'viewer', false, null, null), false);
  assert.equal(canPublish('host', 'guest', false, 'INVITED', 1), false);
  assert.equal(canPublish('host', 'guest', false, 'REQUESTED', 1), false);
  assert.equal(canPublish('host', 'guest', false, 'ACTIVE', 1), true);
  assert.equal(canPublish('host', 'guest', false, 'ACTIVE', 8), true);
  assert.equal(canPublish('host', 'guest', false, 'ACTIVE', 9), false);
  assert.equal(canPublish('host', 'guest', false, 'ACTIVE', null), false);
  assert.equal(canPublish('host', 'guest', true, 'ACTIVE', 2), false);
  assert.equal(canPublish('host', 'host', true, null, null), false);
});

test('reports require a non-empty, bounded reason', () => {
  assert.equal(validReportReason('spam'), false);
  assert.equal(validReportReason('Harassment in chat'), true);
  assert.equal(validReportReason('x'.repeat(251)), false);
});
