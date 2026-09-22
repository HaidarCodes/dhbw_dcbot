import 'dotenv/config';

export class DiscordApiError extends Error {
  constructor({ endpoint, method, status, code, message }) {
    super(message);
    this.name = 'DiscordApiError';
    this.endpoint = endpoint;
    this.method = method;
    this.status = status;
    this.code = code;
  }
}

export async function DiscordRequest(endpoint, options) {
  const url = 'https://discord.com/api/v10/' + endpoint;
  if (options.body) options.body = JSON.stringify(options.body);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'User-Agent': 'DHBWDiscordBot/1.0.0',
    },
    ...options
  });
  if (!res.ok) {
    const rawData = await res.text();
    let data;
    try {
      data = JSON.parse(rawData);
    } catch {
      data = { message: rawData };
    }
    throw new DiscordApiError({
      endpoint,
      method: options.method,
      status: res.status,
      code: data.code,
      message: data.message || 'Unknown Discord API error',
    });
  }
  return res;
}

export async function installGuildCommands(appId, guildId, commands) {
  const endpoint = `applications/${appId}/guilds/${guildId}/commands`;
  await DiscordRequest(endpoint, { method: 'PUT', body: commands });
}

const EMBED_TOTAL_LIMIT = 6000;
const EMBED_DESCRIPTION_LIMIT = 4096;
const EMBED_FIELD_VALUE_LIMIT = 1024;
const TRUNCATION_MARKER = '\n… gekürzt';

export function truncateText(value, limit) {
  const text = String(value ?? '');
  if (limit <= 0) return '';
  if (text.length <= limit) return text;
  if (limit <= TRUNCATION_MARKER.length) return text.slice(0, limit);
  return `${text.slice(0, limit - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
}

export function clampEmbed({ title = '', description = '', fields = [], footer = '' }) {
  const clampedFields = fields.map((field) => ({
    name: field.name,
    value: truncateText(field.value ?? '', EMBED_FIELD_VALUE_LIMIT),
  }));
  let descriptionText = truncateText(description ?? '', EMBED_DESCRIPTION_LIMIT);
  const fixedLength = title.length
    + footer.length
    + clampedFields.reduce((sum, field) => sum + field.name.length, 0);
  const budget = Math.max(0, EMBED_TOTAL_LIMIT - fixedLength);

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const values = [descriptionText, ...clampedFields.map((field) => field.value)];
    const total = values.reduce((sum, value) => sum + value.length, 0);
    if (total <= budget) break;

    let longest = 0;
    for (let index = 1; index < values.length; index += 1) {
      if (values[index].length > values[longest].length) longest = index;
    }

    const nextLimit = values[longest].length - (total - budget);
    const shortened = truncateText(values[longest], Math.max(0, nextLimit));
    const replacement = shortened.length < values[longest].length
      ? shortened
      : truncateText(values[longest], Math.max(0, values[longest].length - 1));
    if (longest === 0) descriptionText = replacement;
    else clampedFields[longest - 1].value = replacement;
  }

  return {
    description: descriptionText,
    fields: clampedFields,
  };
}
