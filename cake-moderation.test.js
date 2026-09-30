import assert from 'node:assert/strict';
import test from 'node:test';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import {
  addCakeAnnouncement,
  announceCake,
  cakeAnnouncementCounts,
  canDeleteCakeAnnouncement,
  completeCakeAnnouncements,
  containsCakeCommitment,
  fetchCakeAnnouncements,
  groupCakeAnnouncements,
  handleCakeMessage,
  handleCakeReaction,
  parseCakeAmount,
  postCakeAnnouncement,
} from './cake-moderation.js';

function cakeChannel({ send, fetch } = {}) {
  return {
    type: ChannelType.GuildText,
    name: 'kuchen',
    parent: { name: 'Information' },
    send: send ?? (async () => ({ react: async () => undefined })),
    messages: {
      fetch: fetch ?? (async () => new Map()),
    },
  };
}

function guildWith(channel) {
  return { channels: { cache: [channel] } };
}

function cakeMessage(channel, {
  id,
  userId,
  authorId = 'bot',
  createdTimestamp = Number(id),
  marker = 'DHBW Kuchenmeldung',
  onDelete,
} = {}) {
  return {
    id: String(id),
    createdTimestamp,
    author: { id: authorId },
    channel,
    embeds: [{ footer: { text: marker } }],
    mentions: { users: { first: () => userId ? { id: userId } : undefined } },
    delete: onDelete ?? (async () => undefined),
  };
}

function dynamicCakeChannel(initialMessages = []) {
  const messages = new Map(initialMessages.map((message) => [message.id, message]));
  let nextId = 10_000n;
  const channel = cakeChannel({
    fetch: async () => new Map(messages),
    send: async (payload) => {
      const id = String(nextId);
      nextId += 1n;
      const userId = payload.allowedMentions.users[0];
      const message = cakeMessage(channel, {
        id,
        userId,
        createdTimestamp: Number(nextId),
        onDelete: async () => {
          messages.delete(id);
        },
      });
      message.embeds = payload.embeds;
      message.react = async () => undefined;
      messages.set(id, message);
      return message;
    },
  });
  for (const message of messages.values()) message.channel = channel;
  return { channel, messages };
}

test('matches clear cake commitments and rejects ambiguous mentions', () => {
  for (const content of [
    'Ich bringe Kuchen mit.',
    'Kuchen bring ich mit.',
    'Ich nehme einen Kuchen mit.',
    'Ich werde Kuchen mitbringen.',
    'Ich backe Kuchen.',
    'Bringe Kuchen mit.',
    'Ich habe Kuchen dabei.',
  ]) {
    assert.equal(containsCakeCommitment(content), true, content);
  }

  for (const content of [
    'Kuchen!',
    'Wer bringt Kuchen mit?',
    'Max bringt Kuchen mit.',
    'Ich bringe keinen Kuchen mit.',
    'Kuchen bring ich nicht mit.',
    'Soll ich Kuchen mitbringen?',
    'Ich kann Kuchen mitbringen.',
    'Ich bringe Teller zum Kuchen mit.',
    'Kuchenblech',
  ]) {
    assert.equal(containsCakeCommitment(content), false, content);
  }
});

test('posts automatic, manual, and self-service cake announcements', async () => {
  const sent = [];
  const reactions = [];
  const channel = cakeChannel({
    send: async (payload) => {
      sent.push(payload);
      return { react: async (emoji) => reactions.push(emoji) };
    },
  });
  const guild = guildWith(channel);

  await postCakeAnnouncement(guild, 'automatic-user', {
    sourceContent: 'Ich bringe **Kuchen** mit.',
    entryType: 'automatic',
  });
  await postCakeAnnouncement(guild, 'manual-user');
  await postCakeAnnouncement(guild, 'self-user', { entryType: 'self' });

  assert.equal(sent[0].embeds[0].title, 'Ursprüngliche Nachricht');
  assert.equal(sent[0].embeds[0].description, '> Ich bringe \\*\\*Kuchen\\*\\* mit.');
  assert.equal(sent[1].embeds[0].title, 'Manueller Eintrag');
  assert.equal(sent[2].embeds[0].title, 'Selbsteintrag');
  assert.deepEqual(reactions, ['❌', '❌', '❌']);
});

test('keeps quoted messages inside the Discord embed description limit', async () => {
  let sent;
  const channel = cakeChannel({
    send: async (payload) => {
      sent = payload;
      return { react: async () => undefined };
    },
  });
  const sourceContent = Array(1000).fill('*').join('\n');

  await postCakeAnnouncement(guildWith(channel), 'author', { sourceContent });

  assert.ok(sent.embeds[0].description.length <= 4096);
  assert.match(sent.embeds[0].description, /… gekürzt$/u);
});

test('paginates through the complete cake channel history', async () => {
  const calls = [];
  const channel = cakeChannel();
  const firstPage = new Map();
  for (let id = 101; id >= 2; id -= 1) {
    const message = cakeMessage(channel, { id, userId: 'user' });
    firstPage.set(message.id, message);
  }
  const finalMessage = cakeMessage(channel, { id: 1, userId: 'user' });
  channel.messages.fetch = async (options) => {
    calls.push(options);
    return options.before ? new Map([['1', finalMessage]]) : firstPage;
  };

  const announcements = await fetchCakeAnnouncements(channel, 'bot');

  assert.equal(announcements.length, 101);
  assert.deepEqual(calls, [
    { limit: 100 },
    { limit: 100, before: '2' },
  ]);
});

test('groups and sorts cake announcement counts', () => {
  const channel = cakeChannel();
  const messages = [
    cakeMessage(channel, { id: 1, userId: 'user-b' }),
    cakeMessage(channel, { id: 2, userId: 'user-a' }),
    cakeMessage(channel, { id: 3, userId: 'user-b' }),
    cakeMessage(channel, { id: 4, userId: 'user-a' }),
    cakeMessage(channel, { id: 5, userId: 'user-b' }),
    cakeMessage(channel, { id: 6, userId: 'ignored', authorId: 'other-bot' }),
    cakeMessage(channel, { id: 7, userId: 'ignored', marker: 'Andere Meldung' }),
    cakeMessage(channel, { id: 8, userId: 'user-c' }),
    cakeMessage(channel, { id: 9, userId: 'user-c' }),
  ];

  const grouped = groupCakeAnnouncements(messages, 'bot');
  assert.deepEqual(grouped.get('user-b').map(({ id }) => id), ['1', '3', '5']);
  assert.deepEqual(cakeAnnouncementCounts(messages, 'bot'), [
    { userId: 'user-b', count: 3 },
    { userId: 'user-a', count: 2 },
    { userId: 'user-c', count: 2 },
  ]);
});

test('parses cake completion amounts strictly', () => {
  assert.deepEqual(parseCakeAmount(), { mode: 'count', amount: 1 });
  assert.deepEqual(parseCakeAmount('1'), { mode: 'count', amount: 1 });
  assert.deepEqual(parseCakeAmount('25'), { mode: 'count', amount: 25 });
  assert.deepEqual(parseCakeAmount(' ALL '), { mode: 'all' });
  for (const value of ['0', '26', '-1', '1.5', 'foo', ' ']) {
    assert.throws(() => parseCakeAmount(value), /1 bis 25 oder all/u);
  }
});

test('completes the oldest cake announcements first', async () => {
  const deleted = [];
  const channel = cakeChannel();
  const messages = [
    cakeMessage(channel, {
      id: 30,
      userId: 'user',
      createdTimestamp: 300,
      onDelete: async () => deleted.push('30'),
    }),
    cakeMessage(channel, {
      id: 10,
      userId: 'user',
      createdTimestamp: 100,
      onDelete: async () => deleted.push('10'),
    }),
    cakeMessage(channel, {
      id: 20,
      userId: 'user',
      createdTimestamp: 200,
      onDelete: async () => deleted.push('20'),
    }),
  ];
  channel.messages.fetch = async () => new Map(messages.map((message) => [message.id, message]));

  const result = await completeCakeAnnouncements(
    guildWith(channel),
    'bot',
    'user',
    '2',
  );

  assert.deepEqual(deleted, ['10', '20']);
  assert.deepEqual(result, {
    requested: 2,
    availableBefore: 3,
    removed: 2,
    failed: [],
    remaining: 1,
  });
});

test('completes all available announcements and reports deletion failures', async () => {
  const channel = cakeChannel();
  const messages = [
    cakeMessage(channel, { id: 1, userId: 'user' }),
    cakeMessage(channel, {
      id: 2,
      userId: 'user',
      onDelete: async () => {
        throw new Error('missing permission');
      },
    }),
  ];
  channel.messages.fetch = async () => new Map(messages.map((message) => [message.id, message]));

  const result = await completeCakeAnnouncements(
    guildWith(channel),
    'bot',
    'user',
    'all',
  );

  assert.equal(result.requested, 'all');
  assert.equal(result.removed, 1);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].messageId, '2');
  assert.equal(result.remaining, 1);
});

test('enforces the active cake limit under parallel additions', async () => {
  const holder = dynamicCakeChannel();
  for (let id = 1; id <= 24; id += 1) {
    const message = cakeMessage(holder.channel, { id, userId: 'user' });
    holder.messages.set(message.id, message);
  }

  const [first, second] = await Promise.all([
    addCakeAnnouncement(guildWith(holder.channel), 'bot', 'user'),
    addCakeAnnouncement(guildWith(holder.channel), 'bot', 'user'),
  ]);

  assert.equal(first.status, 'added');
  assert.equal(first.count, 25);
  assert.equal(second.status, 'limit');
  assert.equal(second.count, 25);
  assert.equal(holder.messages.size, 25);
});

test('applies the self-service cooldown only after a successful post', async () => {
  const holder = dynamicCakeChannel();
  const guild = guildWith(holder.channel);

  const first = await addCakeAnnouncement(guild, 'bot', 'cooldown-user', {
    entryType: 'self',
    cooldownMs: 10_000,
    now: 1_000,
  });
  const blocked = await addCakeAnnouncement(guild, 'bot', 'cooldown-user', {
    entryType: 'self',
    cooldownMs: 10_000,
    now: 1_001,
  });
  const afterCooldown = await addCakeAnnouncement(guild, 'bot', 'cooldown-user', {
    entryType: 'self',
    cooldownMs: 10_000,
    now: 11_000,
  });

  assert.deepEqual(first, { status: 'added', count: 1 });
  assert.equal(blocked.status, 'cooldown');
  assert.equal(blocked.retryAfterMs, 9_999);
  assert.deepEqual(afterCooldown, { status: 'added', count: 2 });
});

test('does not set a cooldown when posting fails', async () => {
  let shouldFail = true;
  const channel = cakeChannel({
    fetch: async () => new Map(),
    send: async () => {
      if (shouldFail) throw new Error('Discord unavailable');
      return { react: async () => undefined };
    },
  });
  const guild = guildWith(channel);

  await assert.rejects(
    addCakeAnnouncement(guild, 'bot', 'retry-user', {
      entryType: 'self',
      cooldownMs: 10_000,
      now: 1_000,
    }),
    /Discord unavailable/u,
  );
  shouldFail = false;
  const retry = await addCakeAnnouncement(guild, 'bot', 'retry-user', {
    entryType: 'self',
    cooldownMs: 10_000,
    now: 1_001,
  });

  assert.equal(retry.status, 'added');
});

test('posts a recognized commitment through the shared add flow', async () => {
  const holder = dynamicCakeChannel();
  const message = {
    author: { id: 'author', bot: false },
    content: 'Ich bringe Kuchen mit.',
    guild: {
      id: 'guild',
      channels: { cache: [holder.channel] },
    },
  };

  assert.equal(await handleCakeMessage(message, 'guild', 'bot'), true);
  assert.equal(holder.messages.size, 1);
});

test('rejects an invalid user for manual cake announcements', async () => {
  await assert.rejects(announceCake('invalid'), /valid Discord user/u);
});

test('requires a different administrator to delete a cake announcement', async () => {
  assert.equal(canDeleteCakeAnnouncement(true, 'admin', 'author'), true);
  assert.equal(canDeleteCakeAnnouncement(true, 'author', 'author'), false);
  assert.equal(canDeleteCakeAnnouncement(false, 'member', 'author'), false);

  let deleted = false;
  const channel = cakeChannel();
  const message = cakeMessage(channel, {
    id: 1,
    userId: 'author',
    authorId: 'bot',
    onDelete: async () => {
      deleted = true;
    },
  });
  message.partial = false;
  message.guild = {
    members: {
      fetch: async () => ({
        permissions: {
          has: (permission) => permission === PermissionFlagsBits.Administrator,
        },
      }),
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
