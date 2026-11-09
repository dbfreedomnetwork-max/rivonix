import test from 'node:test';
import assert from 'node:assert/strict';
import { canReviewReports } from './admin_policy.js';

test('only an explicit database ADMIN role grants review access', () => {
  assert.equal(canReviewReports('ADMIN'), true);
  for (const role of ['USER', '', 'admin', 'MODERATOR', 'HOST']) {
    assert.equal(canReviewReports(role), false);
  }
  assert.equal(canReviewReports(null), false);
  assert.equal(canReviewReports(undefined), false);
});
