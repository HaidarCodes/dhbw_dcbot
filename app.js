import 'dotenv/config';
import express from 'express';
import {
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
  verifyKeyMiddleware,
} from 'discord-interactions';
import {
  addCourseAlias,
  addExceptions,
  archiveAllOldCategories,
  archiveCategory,
  createMissingCourseCategories,
  listExceptions,
  listCourseAliases,
  listExpectedCourseNames,
  previewArchivedCategories,
  previewMissingCourseCategories,
  removeException,
  removeCourseAlias,
} from './archive-sync.js';
import { DiscordApiError, DiscordRequest } from './utils.js';

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

function selectedCourseName(options) {
  return options?.find((option) => option.name === 'fach')?.value;
}

function focusedOption(data) {
  return data.options?.[0]?.options?.find((option) => option.focused);
}

function autocompleteChoices(names, query) {
  const normalizedQuery = query.trim().toLocaleLowerCase('de-DE');
  return names
    .filter((name) => name.toLocaleLowerCase('de-DE').includes(normalizedQuery))
    .slice(0, 25)
    .map((name) => ({ name, value: name }));
}

async function autocompleteCourseAlias(data) {
  const subcommand = data.options?.[0];
  const option = focusedOption(data);
  if (data.name !== 'coursealias' || option?.name !== 'fach') {
    return [];
  }

  const names = subcommand.name === 'remove'
    ? (await listCourseAliases()).map((alias) => alias.expectedName)
    : await listExpectedCourseNames();
  return autocompleteChoices(names, String(option.value || ''));
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

function findDiscordApiError(error) {
  let current = error;
  while (current) {
    if (current instanceof DiscordApiError) {
      return current;
    }
    current = current.cause;
  }
  return undefined;
}

function logCommandError(commandName, error) {
  const discordError = findDiscordApiError(error);
  console.error(JSON.stringify({
    event: 'command_failed',
    command: commandName,
    message: error.message,
    discord: discordError
      ? {
        method: discordError.method,
        endpoint: discordError.endpoint,
        httpStatus: discordError.status,
        code: discordError.code,
        message: discordError.message,
      }
      : undefined,
  }));
}

function formatArchiveWarnings(warnings) {
  if (warnings.length === 0) {
    return [];
  }

  for (const warning of warnings) {
    const discordError = findDiscordApiError(warning.error);
    console.warn(JSON.stringify({
      event: 'archive_warning',
      action: warning.action,
      category: warning.categoryName,
      channel: warning.channelName,
      channelId: warning.channelId,
      discord: discordError
        ? {
          method: discordError.method,
          endpoint: discordError.endpoint,
          httpStatus: discordError.status,
          code: discordError.code,
          message: discordError.message,
        }
        : { message: warning.error.message },
    }));
  }

  return [
    {
      name: `Nicht vollständig schreibgeschützt (${warnings.length})`,
      value: warnings
        .map((warning) => {
          const discordError = findDiscordApiError(warning.error);
          const reason = discordError?.code === 50013
            ? 'Discord-Berechtigung fehlt'
            : discordError?.message || warning.error.message;
          return `- **${warning.categoryName} / ${warning.channelName}**: ${reason}`;
        })
        .join('\n'),
    },
  ];
}

function exceptionSelectResponse() {
  return {
    ...responseEmbed(
      'Archivierungsausnahmen hinzufügen',
      'Wähle bis zu 25 Kategorien aus, die nie automatisch archiviert werden sollen.',
    ),
    components: [
      {
        type: 1,
        components: [
          {
            type: 8,
            custom_id: 'archiveexception:add',
            channel_types: [4],
            min_values: 1,
            max_values: 25,
            placeholder: 'Kategorien auswählen',
          },
        ],
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
    : ['Keine Kategorien würden archiviert werden.'];
  const exceptionNames = result.exceptions.map((exception) => exception.name);
  const archivedNames = result.archivedCategories.map((category) => category.name);
  const aliasNames = result.courseAliases.map(
    (alias) => `${alias.expectedName} → ${alias.categoryName}`,
  );

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
      { name: 'Fachzuordnungen', value: formatList(aliasNames) },
    ],
  );
}

async function executeCommand(data) {
  switch (data.name) {
    case 'archive': {
      const result = await archiveCategory(selectedCategoryId(data.options));
      const failed = !result.archived && result.warnings?.length > 0;
      return responseEmbed(
        result.archived
          ? 'Kategorie archiviert'
          : failed
            ? 'Archivierung fehlgeschlagen'
            : 'Bereits archiviert',
        result.archived
          ? `**${result.name}** wurde archiviert.`
          : failed
            ? `**${result.name}** konnte nicht archiviert werden.`
            : `**${result.name}** war bereits archiviert.`,
        failed
          ? COLORS.error
          : result.warnings?.length > 0
            ? COLORS.warning
            : result.archived
              ? COLORS.success
              : COLORS.info,
        formatArchiveWarnings(result.warnings || []),
      );
    }
    case 'archiveall': {
      const result = await archiveAllOldCategories();
      const failed = result.categories.length === 0 && result.warnings.length > 0;
      return responseEmbed(
        'Automatische Archivierung',
        result.categories.length > 0
          ? result.categories.map((name) => `- **${name}**`).join('\n')
          : failed
            ? 'Keine Kategorie konnte archiviert werden.'
            : 'Keine alten Fachkategorien gefunden.',
        result.warnings.length > 0
          ? failed
            ? COLORS.error
            : COLORS.warning
          : result.categories.length > 0
            ? COLORS.success
            : COLORS.info,
        formatArchiveWarnings(result.warnings),
      );
    }
    case 'archivepreview':
      return formatPreview(await previewArchivedCategories());
    case 'archiveexception': {
      const subcommand = data.options?.[0];
      if (subcommand?.name === 'add') {
        return exceptionSelectResponse();
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
    case 'coursealias': {
      const subcommand = data.options?.[0];
      if (subcommand?.name === 'add') {
        const result = await addCourseAlias(
          selectedCourseName(subcommand.options),
          selectedCategoryId(subcommand.options),
        );
        return responseEmbed(
          result.added ? 'Fachzuordnung hinzugefügt' : 'Fachzuordnung aktualisiert',
          `**${result.expectedName}** → **${result.category.name}**`,
          COLORS.success,
        );
      }
      if (subcommand?.name === 'remove') {
        const courseName = selectedCourseName(subcommand.options);
        const removed = await removeCourseAlias(courseName);
        return responseEmbed(
          removed ? 'Fachzuordnung entfernt' : 'Keine Zuordnung gefunden',
          removed
            ? `Die Zuordnung für **${courseName}** wurde entfernt.`
            : `Für **${courseName}** war keine Zuordnung gespeichert.`,
          removed ? COLORS.success : COLORS.info,
        );
      }
      if (subcommand?.name === 'list') {
        const aliases = await listCourseAliases();
        return responseEmbed(
          'Fachzuordnungen',
          aliases.length > 0
            ? aliases
              .map(
                (alias) =>
                  `- **${alias.expectedName}** → **${alias.categoryName}**`,
              )
              .join('\n')
            : 'Keine Fachzuordnungen gespeichert.',
        );
      }
      throw new Error('Unknown coursealias subcommand');
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
    if (type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE) {
      if (!isAdministrator(member)) {
        return res.send({
          type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
          data: { choices: [] },
        });
      }

      try {
        const choices = await autocompleteCourseAlias(data);
        return res.send({
          type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
          data: { choices },
        });
      } catch (error) {
        console.error('Course alias autocomplete failed', error);
        return res.send({
          type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
          data: { choices: [] },
        });
      }
    }
    if (
      type === InteractionType.MESSAGE_COMPONENT &&
      data.custom_id === 'archiveexception:add'
    ) {
      if (!isAdministrator(member)) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            ...responseEmbed(
              'Keine Berechtigung',
              'Nur Administratoren dürfen diesen Bot verwenden.',
              COLORS.error,
            ),
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }

      res.send({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
      try {
        const result = await addExceptions(data.values || []);
        const lines = [
          ...result.added.map((name) => `- **${name}** hinzugefügt`),
          ...result.existing.map((name) => `- **${name}** war bereits gespeichert`),
        ];
        await DiscordRequest(`webhooks/${applicationId}/${token}/messages/@original`, {
          method: 'PATCH',
          body: {
            ...responseEmbed(
              'Archivierungsausnahmen gespeichert',
              lines.join('\n'),
              COLORS.success,
            ),
            components: [],
          },
        });
      } catch (error) {
        console.error('Adding archive exceptions failed', error);
        await DiscordRequest(`webhooks/${applicationId}/${token}/messages/@original`, {
          method: 'PATCH',
          body: {
            ...responseEmbed(
              'Ausnahmen konnten nicht gespeichert werden',
              'Details stehen im Bot-Log.',
              COLORS.error,
            ),
            components: [],
          },
        });
      }
      return;
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
    });

    try {
      const response = await executeCommand(data);
      await DiscordRequest(`webhooks/${applicationId}/${token}/messages/@original`, {
        method: 'PATCH',
        body: response,
      });
    } catch (error) {
      logCommandError(data.name, error);
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
