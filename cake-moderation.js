import {
  ChannelType,
  Client,
  Events,
  escapeMarkdown,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
} from 'discord.js';

const CAKE_REACTION = '❌';
const CAKE_MARKER = 'DHBW Kuchenmeldung';
const CAKE_WORD = /\bkuchen\b/iu;

export function containsCakeWord(content) {
  return CAKE_WORD.test(content);
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
  const trimmed = escapeMarkdown(content.trim().slice(0, 1000));
  return trimmed
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

export async function handleCakeMessage(message, guildId) {
  if (
    message.author.bot ||
    message.guild?.id !== guildId ||
    !containsCakeWord(message.content)
  ) {
    return false;
  }

  const channel = findCakeChannel(message.guild);
  if (!channel) {
    throw new Error('Discord channel Information/kuchen was not found');
  }

  const announcement = await channel.send({
    content: `<@${message.author.id}> bringt kuchen mit! 🎉`,
    embeds: [
      {
        description: quoteMessage(message.content),
        footer: { text: CAKE_MARKER },
      },
    ],
    allowedMentions: { users: [message.author.id] },
  });
  await announcement.react(CAKE_REACTION);
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

export function startCakeModeration() {
  const client = createCakeClient();
  return client.login(process.env.DISCORD_TOKEN);
}
