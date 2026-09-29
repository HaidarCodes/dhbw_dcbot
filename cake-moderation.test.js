import assert from 'node:assert/strict';
import test from 'node:test';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import {
  canDeleteCakeAnnouncement,
  containsCakeWord,
  handleCakeMessage,
  handleCakeReaction,
} from './cake-moderation.js';

function cakeChannel(send) {
  return {
    type: ChannelType.GuildText,
    name: 'kuchen',
    parent: { name: 'Information' },
    send,
  };
}

test('matches kuchen as a word without matching longer words', () => {
  assert.equal(containsCakeWord('Wer bringt Kuchen mit?'), true);
  assert.equal(containsCakeWord('KUCHEN!'), true);
  assert.equal(containsCakeWord('Kuchenblech'), false);
});

test('posts a persistent cake quote and reacts with a cross', async () => {
  const reactions = [];
  const sent = [];
  const target = cakeChannel(async (payload) => {
    sent.push(payload);
    return { react: async (emoji) => reactions.push(emoji) };
  });
  const message = {
    author: { id: 'author', bot: false },
    content: 'Ich bringe **Kuchen** mit.',
    guild: {
      id: 'guild',
      channels: { cache: [target] },
    },
  };

  assert.equal(await handleCakeMessage(message, 'guild'), true);
  assert.equal(sent[0].content, '<@author> bringt kuchen mit! 🎉');
  assert.equal(sent[0].embeds[0].description, '> Ich bringe \\*\\*Kuchen\\*\\* mit.');
  assert.deepEqual(sent[0].allowedMentions, { users: ['author'] });
  assert.deepEqual(reactions, ['❌']);
});

test('requires a different administrator to delete a cake announcement', async () => {
  assert.equal(canDeleteCakeAnnouncement(true, 'admin', 'author'), true);
  assert.equal(canDeleteCakeAnnouncement(true, 'author', 'author'), false);
  assert.equal(canDeleteCakeAnnouncement(false, 'member', 'author'), false);

  let deleted = false;
  const channel = cakeChannel(async () => undefined);
  const message = {
    partial: false,
    author: { id: 'bot' },
    channel,
    embeds: [{ footer: { text: 'DHBW Kuchenmeldung' } }],
    mentions: { users: { first: () => ({ id: 'author' }) } },
    guild: {
      members: {
        fetch: async () => ({
          permissions: {
            has: (permission) => permission === PermissionFlagsBits.Administrator,
          },
        }),
      },
    },
    delete: async () => {
      deleted = true;
    },
  };
  const reaction = {
    partial: false,
    emoji: { name: '❌' },
    message,
  };

  assert.equal(await handleCakeReaction(reaction, { id: 'admin', bot: false }, 'bot'), true);
  assert.equal(deleted, true);
});
