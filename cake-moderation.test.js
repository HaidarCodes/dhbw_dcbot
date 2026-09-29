import assert from 'node:assert/strict';
import test from 'node:test';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import {
  announceCake,
  canDeleteCakeAnnouncement,
  containsCakeWord,
  handleCakeMessage,
  handleCakeReaction,
  postCakeAnnouncement,
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

test('rejects an invalid user for manual cake announcements', async () => {
  await assert.rejects(announceCake('invalid'), /valid Discord user/);
});

test('posts a manual cake announcement for a selected user', async () => {
  const sent = [];
  const target = cakeChannel(async (payload) => {
    sent.push(payload);
    return { react: async () => undefined };
  });

  await postCakeAnnouncement({ channels: { cache: [target] } }, 'selected-user');

  assert.equal(sent[0].content, '<@selected-user> bringt kuchen mit! 🎉');
  assert.equal(
    sent[0].embeds[0].description,
    'Manuell von einem Administrator eingetragen.',
  );
  assert.deepEqual(sent[0].allowedMentions, { users: ['selected-user'] });
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
