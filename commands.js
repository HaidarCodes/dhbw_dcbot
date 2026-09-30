import 'dotenv/config';
import { COMMANDS } from './command-definitions.js';
import { installGuildCommands } from './utils.js';

if (!process.env.APP_ID || !process.env.DISCORD_GUILD_ID) {
  throw new Error('APP_ID and DISCORD_GUILD_ID are required');
}

await installGuildCommands(
  process.env.APP_ID,
  process.env.DISCORD_GUILD_ID,
  COMMANDS,
);

console.log(
  `${COMMANDS.length} Slash-Commands für Server ${process.env.DISCORD_GUILD_ID} registriert.`,
);
