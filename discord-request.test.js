import assert from 'node:assert/strict';
import test from 'node:test';
import { rateLimitDelayMs } from './utils.js';

test('waits for Discord rate limits and caps the delay', () => {
  assert.equal(rateLimitDelayMs('0.25', ''), 250);
  assert.equal(rateLimitDelayMs(null, '{"retry_after":1.5}'), 1500);
  assert.equal(rateLimitDelayMs('30', ''), 10_000);
  assert.equal(rateLimitDelayMs(null, 'not-json'), 1000);
});
