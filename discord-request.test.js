import assert from 'node:assert/strict';
import test from 'node:test';
import { discordApiUrl, DiscordRequest, rateLimitDelayMs } from './utils.js';

test('builds Discord API URLs from validated path segments', () => {
  assert.equal(
    discordApiUrl('webhooks/123/token.value/messages/@original').href,
    'https://discord.com/api/v10/webhooks/123/token.value/messages/%40original',
  );
});

test('rejects Discord API endpoints that can escape or alter the path', () => {
  const invalidEndpoints = [
    '',
    'https://example.com',
    '//example.com/path',
    '../channels/123',
    'channels/../guilds',
    'channels\\123',
    'channels/123?with=query',
    'channels/123#fragment',
  ];

  for (const endpoint of invalidEndpoints) {
    assert.throws(() => discordApiUrl(endpoint), TypeError);
  }
  assert.throws(() => discordApiUrl(null), TypeError);
});

test('rejects an unsafe endpoint before making a Discord request', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error('fetch must not be called');
  };

  try {
    await assert.rejects(
      DiscordRequest('../channels/123', { method: 'GET' }),
      TypeError,
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('waits for Discord rate limits and caps the delay', () => {
  assert.equal(rateLimitDelayMs('0.25', ''), 250);
  assert.equal(rateLimitDelayMs(null, '{"retry_after":1.5}'), 1500);
  assert.equal(rateLimitDelayMs('30', ''), 10_000);
  assert.equal(rateLimitDelayMs(null, 'not-json'), 1000);
});
