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

const MAX_RATE_LIMIT_RETRIES = 5;
const MAX_RATE_LIMIT_DELAY_MS = 10_000;

export function rateLimitDelayMs(retryAfterHeader, bodyText) {
  if (retryAfterHeader !== null && retryAfterHeader !== undefined && retryAfterHeader !== '') {
    const headerSeconds = Number(retryAfterHeader);
    if (Number.isFinite(headerSeconds) && headerSeconds >= 0) {
      return Math.min(headerSeconds * 1000, MAX_RATE_LIMIT_DELAY_MS);
    }
  }

  try {
    const bodySeconds = Number(JSON.parse(bodyText).retry_after);
    if (Number.isFinite(bodySeconds) && bodySeconds >= 0) {
      return Math.min(bodySeconds * 1000, MAX_RATE_LIMIT_DELAY_MS);
    }
  } catch {
    // Discord sometimes returns a non-JSON rate-limit body.
  }
  return 1000;
}

export async function DiscordRequest(endpoint, options = {}, attempt = 0) {
  const url = 'https://discord.com/api/v10/' + endpoint;
  const { body, headers, ...rest } = options;
  const res = await fetch(url, {
    ...rest,
    headers: {
      ...headers,
      Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'User-Agent': 'DHBWDiscordBot/1.0.0',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
    const rawData = await res.text();
    await new Promise((resolve) => {
      setTimeout(resolve, rateLimitDelayMs(res.headers.get('retry-after'), rawData));
    });
    return DiscordRequest(endpoint, options, attempt + 1);
  }
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
