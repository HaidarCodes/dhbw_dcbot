import 'dotenv/config';
import express from 'express';
import {
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
  verifyKeyMiddleware,
} from 'discord-interactions';
import {
  addException,
  archiveAllOldCategories,
  archiveCategory,
  createMissingCourseCategories,
  listExceptions,
  previewArchivedCategories,
  removeException,
} from './archive-sync.js';
import { DiscordRequest } from './utils.js';

const app = express();
const PORT = process.env.PORT || 3000;
const ADMINISTRATOR_PERMISSION = 8n;

function selectedCategoryId(options) {
  return options?.find((option) => option.name === 'kategorie')?.value;
}

function formatList(values) {
  return values.length > 0 ? values.join(', ') : 'keine';
}

function truncateMessage(message) {
  return message.length <= 2000
    ? message
    : `${message.slice(0, 1960)}\n… Ausgabe gekürzt`;
}

function isAdministrator(member) {
  return (
    member?.permissions !== undefined &&
    (BigInt(member.permissions) & ADMINISTRATOR_PERMISSION) === ADMINISTRATOR_PERMISSION
  );
}

function formatPreview(result) {
  const archiveLines = result.categories.length > 0
    ? result.categories.map(
      ({ name, channels }) =>
        `- **${name}**: ${formatList(channels)}`,
    )
    : ['Keine Kategorien würden archiviert.'];
  const exceptionNames = result.exceptions.map((exception) => exception.name);
  const archivedNames = result.archivedCategories.map((category) => category.name);

  return truncateMessage([
    `**Erwartete Fachkategorien:** ${formatList(result.expectedCategories)}`,
    `**Ausnahmen:** ${formatList(exceptionNames)}`,
    `**Lokal als archiviert gespeichert:** ${formatList(archivedNames)}`,
    '**Würde archiviert:**',
    ...archiveLines,
  ].join('\n'));
}

async function executeCommand(data) {
  switch (data.name) {
    case 'archive': {
      const result = await archiveCategory(selectedCategoryId(data.options));
      return result.archived
        ? `Kategorie **${result.name}** wurde archiviert.`
        : `Kategorie **${result.name}** war bereits archiviert.`;
    }
    case 'archiveall': {
      const result = await archiveAllOldCategories();
      return result.categories.length > 0
        ? `Archiviert: ${result.categories.map((name) => `**${name}**`).join(', ')}`
        : 'Keine alten Fachkategorien gefunden.';
    }
    case 'archivepreview':
      return formatPreview(await previewArchivedCategories());
    case 'archiveexception': {
      const subcommand = data.options?.[0];
      if (subcommand?.name === 'add') {
        const result = await addException(selectedCategoryId(subcommand.options));
        return result.added
          ? `**${result.category.name}** wird nie automatisch archiviert.`
          : `**${result.category.name}** ist bereits eine Ausnahme.`;
      }
      if (subcommand?.name === 'remove') {
        const categoryId = selectedCategoryId(subcommand.options);
        return await removeException(categoryId)
          ? 'Ausnahme wurde entfernt.'
          : 'Für diese Kategorie war keine Ausnahme gespeichert.';
      }
      if (subcommand?.name === 'list') {
        const exceptions = await listExceptions();
        return `**Ausnahmen:** ${formatList(exceptions.map((item) => item.name))}`;
      }
      throw new Error('Unknown archiveexception subcommand');
    }
    case 'createcourses': {
      const result = await createMissingCourseCategories();
      return result.categories.length > 0
        ? `Erstellt: ${result.categories.map((name) => `**${name}**`).join(', ')}`
        : 'Alle erwarteten Fachkategorien existieren bereits.';
    }
    default:
      throw new Error(`Unknown command: ${data.name}`);
  }
}

app.post(
  '/interactions',
  verifyKeyMiddleware(process.env.PUBLIC_KEY),
  async (req, res) => {
    const {
      application_id: applicationId,
      token,
      type,
      data,
      member,
    } = req.body;

    if (type === InteractionType.PING) {
      return res.send({ type: InteractionResponseType.PONG });
    }
    if (type !== InteractionType.APPLICATION_COMMAND) {
      return res.status(400).json({ error: 'unknown interaction type' });
    }
    if (!isAdministrator(member)) {
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: 'Nur Administratoren dürfen diesen Bot verwenden.',
          flags: InteractionResponseFlags.EPHEMERAL,
        },
      });
    }

    res.send({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      data: { flags: InteractionResponseFlags.EPHEMERAL },
    });

    try {
      const content = await executeCommand(data);
      await DiscordRequest(`webhooks/${applicationId}/${token}/messages/@original`, {
        method: 'PATCH',
        body: { content },
      });
    } catch (error) {
      console.error(`Command ${data.name} failed`, error);
      await DiscordRequest(`webhooks/${applicationId}/${token}/messages/@original`, {
        method: 'PATCH',
        body: { content: 'Befehl fehlgeschlagen. Details stehen im Bot-Log.' },
      });
    }
  },
);

app.listen(PORT, () => {
  console.log('Listening on port', PORT);
});
