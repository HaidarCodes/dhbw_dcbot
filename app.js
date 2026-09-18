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
  previewMissingCourseCategories,
  removeException,
} from './archive-sync.js';
import { DiscordRequest } from './utils.js';

const app = express();
const PORT = process.env.PORT || 3000;
const ADMINISTRATOR_PERMISSION = 8n;
const COLORS = {
  info: 0x5865f2,
  success: 0x57f287,
  warning: 0xfee75c,
  error: 0xed4245,
};

function selectedCategoryId(options) {
  return options?.find((option) => option.name === 'kategorie')?.value;
}

function formatList(values) {
  return values.length > 0 ? values.join(', ') : 'keine';
}

function truncate(value, limit = 900) {
  return value.length <= limit ? value : `${value.slice(0, limit - 15)}\n… gekürzt`;
}

function responseEmbed(title, description, color = COLORS.info, fields = []) {
  return {
    embeds: [
      {
        title,
        description: truncate(description, 2400),
        color,
        fields: fields.map((field) => ({
          ...field,
          value: truncate(field.value),
        })),
        footer: { text: 'DHBW Discord Bot' },
        timestamp: new Date().toISOString(),
      },
    ],
  };
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

  return responseEmbed(
    'Archivierungsvorschau',
    archiveLines.join('\n'),
    result.categories.length > 0 ? COLORS.warning : COLORS.success,
    [
      {
        name: 'Erwartete Fachkategorien',
        value: formatList(result.expectedCategories),
      },
      { name: 'Ausnahmen', value: formatList(exceptionNames) },
      {
        name: 'Lokal als archiviert gespeichert',
        value: formatList(archivedNames),
      },
    ],
  );
}

async function executeCommand(data) {
  switch (data.name) {
    case 'archive': {
      const result = await archiveCategory(selectedCategoryId(data.options));
      return responseEmbed(
        result.archived ? 'Kategorie archiviert' : 'Bereits archiviert',
        `**${result.name}** ${result.archived ? 'wurde archiviert.' : 'war bereits archiviert.'}`,
        result.archived ? COLORS.success : COLORS.info,
      );
    }
    case 'archiveall': {
      const result = await archiveAllOldCategories();
      return responseEmbed(
        'Automatische Archivierung',
        result.categories.length > 0
          ? result.categories.map((name) => `- **${name}**`).join('\n')
          : 'Keine alten Fachkategorien gefunden.',
        result.categories.length > 0 ? COLORS.success : COLORS.info,
      );
    }
    case 'archivepreview':
      return formatPreview(await previewArchivedCategories());
    case 'archiveexception': {
      const subcommand = data.options?.[0];
      if (subcommand?.name === 'add') {
        const result = await addException(selectedCategoryId(subcommand.options));
        return responseEmbed(
          result.added ? 'Ausnahme hinzugefügt' : 'Ausnahme vorhanden',
          `**${result.category.name}** ${
            result.added
              ? 'wird nie automatisch archiviert.'
              : 'ist bereits eine Ausnahme.'
          }`,
          result.added ? COLORS.success : COLORS.info,
        );
      }
      if (subcommand?.name === 'remove') {
        const categoryId = selectedCategoryId(subcommand.options);
        const removed = await removeException(categoryId);
        return responseEmbed(
          removed ? 'Ausnahme entfernt' : 'Keine Ausnahme gefunden',
          removed
            ? 'Die Kategorie kann wieder automatisch archiviert werden.'
            : 'Für diese Kategorie war keine Ausnahme gespeichert.',
          removed ? COLORS.success : COLORS.info,
        );
      }
      if (subcommand?.name === 'list') {
        const exceptions = await listExceptions();
        return responseEmbed(
          'Archivierungsausnahmen',
          exceptions.length > 0
            ? exceptions.map((item) => `- **${item.name}**`).join('\n')
            : 'Keine Ausnahmen gespeichert.',
        );
      }
      throw new Error('Unknown archiveexception subcommand');
    }
    case 'createcourses': {
      const result = await createMissingCourseCategories();
      return responseEmbed(
        'Fachkategorien erstellt',
        result.categories.length > 0
          ? result.categories
            .map((name) => `- **${name}** mit \`general\` und \`bilder\``)
            .join('\n')
          : 'Alle erwarteten Fachkategorien existieren bereits.',
        result.categories.length > 0 ? COLORS.success : COLORS.info,
      );
    }
    case 'createcoursespreview': {
      const result = await previewMissingCourseCategories();
      return responseEmbed(
        'Vorschau: fehlende Fachkategorien',
        result.categories.length > 0
          ? result.categories
            .map((name) => `- **${name}**\n  └ \`general\`, \`bilder\``)
            .join('\n')
          : 'Es fehlen keine Fachkategorien.',
        result.categories.length > 0 ? COLORS.warning : COLORS.success,
      );
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
          embeds: [
            {
              title: 'Keine Berechtigung',
              description: 'Nur Administratoren dürfen diesen Bot verwenden.',
              color: COLORS.error,
            },
          ],
          flags: InteractionResponseFlags.EPHEMERAL,
        },
      });
    }

    res.send({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      data: { flags: InteractionResponseFlags.EPHEMERAL },
    });

    try {
      const response = await executeCommand(data);
      await DiscordRequest(`webhooks/${applicationId}/${token}/messages/@original`, {
        method: 'PATCH',
        body: response,
      });
    } catch (error) {
      console.error(`Command ${data.name} failed`, error);
      await DiscordRequest(`webhooks/${applicationId}/${token}/messages/@original`, {
        method: 'PATCH',
        body: responseEmbed(
          'Befehl fehlgeschlagen',
          'Details stehen im Bot-Log.',
          COLORS.error,
        ),
      });
    }
  },
);

app.listen(PORT, () => {
  console.log('Listening on port', PORT);
});
