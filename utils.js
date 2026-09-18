import 'dotenv/config';

export async function DiscordRequest(endpoint, options) {
  const url = 'https://discord.com/api/v10/' + endpoint;
  if (options.body) options.body = JSON.stringify(options.body);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'User-Agent': 'DiscordBot (https://github.com/HaidarCodes/dhbw_dcbot, 1.0.0)',
    },
    ...options
  });
  if (!res.ok) {
    const data = await res.text();
    throw new Error(`Discord API returned HTTP ${res.status}: ${data}`);
  }
  return res;
}

export async function installGuildCommands(appId, guildId, commands) {
  const endpoint = `applications/${appId}/guilds/${guildId}/commands`;
  await DiscordRequest(endpoint, { method: 'PUT', body: commands });
}
