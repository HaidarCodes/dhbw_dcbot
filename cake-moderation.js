import {
  ChannelType,
  Client,
  Events,
  escapeMarkdown,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
} from 'discord.js';
import { truncateText } from './utils.js';

const CAKE_REACTION = '❌';
const CAKE_MARKER = 'DHBW Kuchenmeldung';
const CAKE_QUOTE_LIMIT = 4096;
const MAX_ACTIVE_CAKES = 25;
const SELF_CAKE_COOLDOWN_MS = 10_000;
const CAKE_WORD = /\bkuchen\b/iu;
const UNCERTAIN_CAKE = /[?]|\b(?:vielleicht|eventuell|könnte|würde|soll|kann)\b/iu;
const NEGATED_CAKE = /\b(?:kein(?:e|en|em|er|es)?\s+kuchen|nicht)\b/iu;
const INCIDENTAL_CAKE = /\b(?:zum|zu dem|für den|für einen)\s+kuchen\b/iu;
const CAKE_COMMITMENTS = [
  /\bich\b[^.!?\n]{0,80}\b(?:bring(?:e)?|mitbring(?:e|en)?|nehm(?:e)?|hole|backe|besorge)\b/iu,
  /\b(?:bring(?:e)?|nehm(?:e)?|hole|backe|besorge)\b[^.!?\n]{0,80}\bich\b/iu,
  /\bbring(?:e)?\b[^.!?\n]{0,80}\bkuchen\b[^.!?\n]{0,20}\bmit\b/iu,
  /\bich\b[^.!?\n]{0,80}\bkuchen\b[^.!?\n]{0,30}\b(?:dabei|mit)\b/iu,
];
let cakeClient;
let cakeMutationQueue = Promise.resolve();
const selfCakeCooldowns = new Map();

export class CakeInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CakeInputError';
  }
}

export function containsCakeCommitment(content) {
  return (
    CAKE_WORD.test(content) &&
    !UNCERTAIN_CAKE.test(content) &&
    !NEGATED_CAKE.test(content) &&
    !INCIDENTAL_CAKE.test(content) &&
    CAKE_COMMITMENTS.some((pattern) => pattern.test(content))
  );
}

export function isCakeChannel(channel) {
  return (
    channel?.type === ChannelType.GuildText &&
    channel.name.toLocaleLowerCase('de-DE') === 'kuchen' &&
    channel.parent?.name.toLocaleLowerCase('de-DE') === 'information'
  );
}

export function findCakeChannel(guild) {
  return guild.channels.cache.find(isCakeChannel);
}

export function isCakeAnnouncement(message) {
  return (
    isCakeChannel(message.channel) &&
    message.embeds?.some((embed) => embed.footer?.text === CAKE_MARKER)
  );
}

export function canDeleteCakeAnnouncement(isAdministrator, reactorId, authorId) {
  return isAdministrator && reactorId !== authorId;
}

function quoteMessage(content) {
  const quoted = escapeMarkdown(content.trim())
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return truncateText(quoted, CAKE_QUOTE_LIMIT);
}

function compareSnowflakes(left, right) {
  try {
    const leftId = BigInt(left);
    const rightId = BigInt(right);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  } catch {
    return String(left).localeCompare(String(right));
  }
}

function compareAnnouncementAge(left, right) {
  const timestampDifference = (left.createdTimestamp ?? 0) - (right.createdTimestamp ?? 0);
  return timestampDifference || compareSnowflakes(left.id, right.id);
}

function announcementUserId(message) {
  return message.mentions?.users?.first()?.id;
}

function collectionValues(collection) {
  return [...collection.values()];
}

export function groupCakeAnnouncements(messages, clientUserId) {
  const grouped = new Map();
  for (const message of collectionValues(messages)) {
    if (message.author?.id !== clientUserId || !isCakeAnnouncement(message)) continue;
    const userId = announcementUserId(message);
    if (!userId) continue;
    const announcements = grouped.get(userId) ?? [];
    announcements.push(message);
    grouped.set(userId, announcements);
  }
  for (const announcements of grouped.values()) {
    announcements.sort(compareAnnouncementAge);
  }
  return grouped;
}

export function cakeAnnouncementCounts(messages, clientUserId) {
  return [...groupCakeAnnouncements(messages, clientUserId)]
    .map(([userId, announcements]) => ({ userId, count: announcements.length }))
    .sort((left, right) => right.count - left.count || left.userId.localeCompare(right.userId));
}

export function parseCakeAmount(value) {
  if (value === undefined || value === null || value === '') {
    return { mode: 'count', amount: 1 };
  }
  const normalized = String(value).trim().toLocaleLowerCase('de-DE');
  if (normalized === 'all') {
    return { mode: 'all' };
  }
  if (!/^(?:[1-9]|1\d|2[0-5])$/.test(normalized)) {
    throw new CakeInputError('Nutze für amount eine Zahl von 1 bis 25 oder all.');
  }
  return { mode: 'count', amount: Number(normalized) };
}

function oldestMessageId(messages) {
  return collectionValues(messages)
    .map((message) => message.id)
    .sort(compareSnowflakes)[0];
}

export async function fetchCakeAnnouncements(channel, clientUserId) {
  const announcements = [];
  let before;
  while (true) {
    const page = await channel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {}),
    });
    for (const message of collectionValues(page)) {
      if (message.author?.id === clientUserId && isCakeAnnouncement(message)) {
        announcements.push(message);
      }
    }
    if (page.size < 100) break;
    const nextBefore = oldestMessageId(page);
    if (!nextBefore || nextBefore === before) break;
    before = nextBefore;
  }
  return announcements;
}

async function sendCakeAnnouncement(channel, userId, sourceContent, entryType) {
  const title = sourceContent
    ? 'Ursprüngliche Nachricht'
    : entryType === 'self'
      ? 'Selbsteintrag'
      : 'Manueller Eintrag';
  const description = sourceContent
    ? quoteMessage(sourceContent)
    : entryType === 'self'
      ? 'Von der Person selbst eingetragen.'
      : 'Manuell von einem Administrator eingetragen.';
  const announcement = await channel.send({
    content: `<@${userId}> bringt kuchen mit! 🎉`,
    embeds: [
      {
        title,
        description,
        footer: { text: CAKE_MARKER },
      },
    ],
    allowedMentions: { users: [userId] },
  });
  try {
    await announcement.react(CAKE_REACTION);
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'cake_reaction_failed',
      messageId: announcement.id,
      message: error.message,
    }));
  }
  return announcement;
}

export async function postCakeAnnouncement(
  guild,
  userId,
  { sourceContent, entryType = 'manual' } = {},
) {
  const channel = findCakeChannel(guild);
  if (!channel) {
    throw new Error('Discord channel Information/kuchen was not found');
  }
  return sendCakeAnnouncement(channel, userId, sourceContent, entryType);
}

function withCakeMutation(mutator) {
  const mutation = cakeMutationQueue.then(mutator);
  cakeMutationQueue = mutation.catch(() => {});
  return mutation;
}

function cleanupCooldowns(now) {
  for (const [userId, nextAllowedAt] of selfCakeCooldowns) {
    if (nextAllowedAt <= now) selfCakeCooldowns.delete(userId);
  }
}

export async function addCakeAnnouncement(
  guild,
  clientUserId,
  userId,
  {
    sourceContent,
    entryType = 'manual',
    cooldownMs = 0,
    now,
  } = {},
) {
  return withCakeMutation(async () => {
    const currentTime = now ?? Date.now();
    cleanupCooldowns(currentTime);
    const nextAllowedAt = selfCakeCooldowns.get(userId) ?? 0;
    if (cooldownMs > 0 && nextAllowedAt > currentTime) {
      return {
        status: 'cooldown',
        count: 0,
        retryAfterMs: nextAllowedAt - currentTime,
      };
    }

    const channel = findCakeChannel(guild);
    if (!channel) {
      throw new Error('Discord channel Information/kuchen was not found');
    }
    const announcements = await fetchCakeAnnouncements(channel, clientUserId);
    const currentCount = groupCakeAnnouncements(announcements, clientUserId)
      .get(userId)?.length ?? 0;
    if (currentCount >= MAX_ACTIVE_CAKES) {
      return { status: 'limit', count: currentCount };
    }

    await sendCakeAnnouncement(channel, userId, sourceContent, entryType);
    if (cooldownMs > 0) {
      selfCakeCooldowns.set(userId, currentTime + cooldownMs);
    }
    return { status: 'added', count: currentCount + 1 };
  });
}

export async function completeCakeAnnouncements(
  guild,
  clientUserId,
  userId,
  amountValue,
) {
  const amount = parseCakeAmount(amountValue);
  return withCakeMutation(async () => {
    const channel = findCakeChannel(guild);
    if (!channel) {
      throw new Error('Discord channel Information/kuchen was not found');
    }
    const announcements = await fetchCakeAnnouncements(channel, clientUserId);
    const userAnnouncements = groupCakeAnnouncements(announcements, clientUserId)
      .get(userId) ?? [];
    const targets = amount.mode === 'all'
      ? userAnnouncements
      : userAnnouncements.slice(0, amount.amount);
    let removed = 0;
    const failed = [];
    for (const message of targets) {
      try {
        await message.delete();
        removed += 1;
      } catch (error) {
        failed.push({ messageId: message.id, error });
      }
    }
    return {
      requested: amount.mode === 'all' ? 'all' : amount.amount,
      availableBefore: userAnnouncements.length,
      removed,
      failed,
      remaining: userAnnouncements.length - removed,
    };
  });
}

export async function handleCakeMessage(message, guildId, clientUserId) {
  if (
    message.author.bot ||
    message.guild?.id !== guildId ||
    !containsCakeCommitment(message.content)
  ) {
    return false;
  }

  const result = await addCakeAnnouncement(
    message.guild,
    clientUserId,
    message.author.id,
    { sourceContent: message.content, entryType: 'automatic' },
  );
  if (result.status === 'limit') {
    console.warn(JSON.stringify({
      event: 'cake_limit_reached',
      userId: message.author.id,
      count: result.count,
    }));
  }
  return result.status === 'added';
}

export async function handleCakeReaction(reaction, user, clientUserId) {
  if (user.bot || reaction.emoji.name !== CAKE_REACTION) {
    return false;
  }
  if (reaction.partial) {
    await reaction.fetch();
  }
  if (reaction.message.partial) {
    await reaction.message.fetch();
  }

  const { message } = reaction;
  if (message.author?.id !== clientUserId || !isCakeAnnouncement(message)) {
    return false;
  }

  const originalAuthor = message.mentions.users.first();
  if (!originalAuthor) {
    return false;
  }

  const member = await message.guild.members.fetch(user.id);
  const canDelete = canDeleteCakeAnnouncement(
    member.permissions.has(PermissionFlagsBits.Administrator),
    user.id,
    originalAuthor.id,
  );
  if (!canDelete) {
    return false;
  }

  await withCakeMutation(() => message.delete());
  return true;
}

export function createCakeClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction],
  });

  client.on(Events.MessageCreate, (message) => {
    handleCakeMessage(
      message,
      process.env.DISCORD_GUILD_ID,
      client.user.id,
    ).catch((error) => {
      console.error('Cake message handling failed', error);
    });
  });
  client.on(Events.MessageReactionAdd, (reaction, user) => {
    handleCakeReaction(reaction, user, client.user.id).catch((error) => {
      console.error('Cake reaction handling failed', error);
    });
  });
  return client;
}

async function getCakeGuild() {
  if (!cakeClient?.isReady()) {
    throw new Error('Cake moderation gateway is not ready');
  }
  const guild = cakeClient.guilds.cache.get(process.env.DISCORD_GUILD_ID);
  if (!guild) {
    throw new Error('Configured Discord guild was not found');
  }
  await guild.channels.fetch();
  return guild;
}

function requireDiscordUserId(userId) {
  if (!/^\d{17,20}$/.test(userId)) {
    throw new Error('A valid Discord user is required');
  }
}

export async function announceCake(userId) {
  requireDiscordUserId(userId);
  const guild = await getCakeGuild();
  return addCakeAnnouncement(guild, cakeClient.user.id, userId);
}

export async function announceOwnCake(userId, now) {
  requireDiscordUserId(userId);
  const guild = await getCakeGuild();
  return addCakeAnnouncement(
    guild,
    cakeClient.user.id,
    userId,
    {
      entryType: 'self',
      cooldownMs: SELF_CAKE_COOLDOWN_MS,
      now,
    },
  );
}

export async function completeCake(userId, amount) {
  requireDiscordUserId(userId);
  const guild = await getCakeGuild();
  return completeCakeAnnouncements(
    guild,
    cakeClient.user.id,
    userId,
    amount,
  );
}

export async function listCakeUsers() {
  const guild = await getCakeGuild();
  const channel = findCakeChannel(guild);
  if (!channel) {
    throw new Error('Discord channel Information/kuchen was not found');
  }
  const announcements = await fetchCakeAnnouncements(channel, cakeClient.user.id);
  return cakeAnnouncementCounts(announcements, cakeClient.user.id);
}

export async function startCakeModeration() {
  cakeClient = createCakeClient();
  await cakeClient.login(process.env.DISCORD_TOKEN);
  return cakeClient;
}
