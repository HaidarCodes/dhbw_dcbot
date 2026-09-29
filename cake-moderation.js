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
    message.embeds.some((embed) => embed.footer?.text === CAKE_MARKER)
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

export async function postCakeAnnouncement(guild, userId, sourceContent) {
  const channel = findCakeChannel(guild);
  if (!channel) {
    throw new Error('Discord channel Information/kuchen was not found');
  }

  const embed = {
    title: sourceContent ? 'Ursprüngliche Nachricht' : 'Manueller Eintrag',
    description: sourceContent
      ? quoteMessage(sourceContent)
      : 'Manuell von einem Administrator eingetragen.',
    footer: { text: CAKE_MARKER },
  };
  const announcement = await channel.send({
    content: `<@${userId}> bringt kuchen mit! 🎉`,
    embeds: [embed],
    allowedMentions: { users: [userId] },
  });
  await announcement.react(CAKE_REACTION);
  return announcement;
}

export async function handleCakeMessage(message, guildId) {
  if (
    message.author.bot ||
    message.guild?.id !== guildId ||
    !containsCakeCommitment(message.content)
  ) {
    return false;
  }

  await postCakeAnnouncement(message.guild, message.author.id, message.content);
  return true;
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

  await message.delete();
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
    handleCakeMessage(message, process.env.DISCORD_GUILD_ID).catch((error) => {
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

export function cakeAnnouncementUserIds(messages, clientUserId) {
  const userIds = new Set();
  for (const message of messages.values()) {
    if (message.author?.id !== clientUserId || !isCakeAnnouncement(message)) continue;
    const user = message.mentions.users.first();
    if (user) userIds.add(user.id);
  }
  return [...userIds];
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

export async function announceCake(userId) {
  if (!/^\d{17,20}$/.test(userId)) {
    throw new Error('A valid Discord user is required');
  }
  await postCakeAnnouncement(await getCakeGuild(), userId);
}

export async function listCakeUsers() {
  const guild = await getCakeGuild();
  const channel = findCakeChannel(guild);
  if (!channel) {
    throw new Error('Discord channel Information/kuchen was not found');
  }
  const messages = await channel.messages.fetch({ limit: 100 });
  return cakeAnnouncementUserIds(messages, cakeClient.user.id);
}

export async function startCakeModeration() {
  cakeClient = createCakeClient();
  await cakeClient.login(process.env.DISCORD_TOKEN);
  return cakeClient;
}
