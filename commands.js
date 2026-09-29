import 'dotenv/config';
import { installGuildCommands } from './utils.js';

const GUILD_COMMAND = {
  type: 1,
  integration_types: [0],
  contexts: [0],
  default_member_permissions: '8',
};

const CATEGORY_OPTION = {
  type: 7,
  name: 'kategorie',
  description: 'Discord-Kategorie',
  channel_types: [4],
  required: true,
};

const COMMANDS = [
  {
    ...GUILD_COMMAND,
    name: 'cake',
    description: 'Trägt ein, wer Kuchen mitbringt',
    options: [
      {
        type: 6,
        name: 'username',
        description: 'Person, die Kuchen mitbringt',
        required: true,
      },
    ],
  },
  {
    ...GUILD_COMMAND,
    name: 'archive',
    description: 'Archiviert eine Kategorie',
    options: [CATEGORY_OPTION],
  },
  {
    ...GUILD_COMMAND,
    name: 'archiveall',
    description: 'Archiviert alle Fächer ohne zukünftige Vorlesungen',
  },
  {
    ...GUILD_COMMAND,
    name: 'archivepreview',
    description: 'Zeigt die geplante automatische Archivierung',
  },
  {
    ...GUILD_COMMAND,
    name: 'archiveexception',
    description: 'Verwaltet Kategorien, die nie archiviert werden',
    options: [
      {
        type: 1,
        name: 'add',
        description: 'Fügt eine oder mehrere Ausnahmen hinzu',
      },
      {
        type: 1,
        name: 'remove',
        description: 'Entfernt eine Ausnahme',
        options: [CATEGORY_OPTION],
      },
      {
        type: 1,
        name: 'list',
        description: 'Zeigt alle Ausnahmen',
      },
    ],
  },
  {
    ...GUILD_COMMAND,
    name: 'createcourses',
    description: 'Erstellt fehlende Fachkategorien mit general und bilder',
  },
  {
    ...GUILD_COMMAND,
    name: 'createcoursespreview',
    description: 'Zeigt fehlende Fachkategorien ohne sie zu erstellen',
  },
  {
    ...GUILD_COMMAND,
    name: 'coursealias',
    description: 'Ordnet Rapla-Fächer anders benannten Kategorien zu',
    options: [
      {
        type: 1,
        name: 'add',
        description: 'Fügt eine Fachzuordnung hinzu oder aktualisiert sie',
        options: [
          {
            type: 3,
            name: 'fach',
            description: 'Erwarteter Fachname aus Rapla',
            required: true,
            autocomplete: true,
          },
          CATEGORY_OPTION,
        ],
      },
      {
        type: 1,
        name: 'remove',
        description: 'Entfernt eine Fachzuordnung',
        options: [
          {
            type: 3,
            name: 'fach',
            description: 'Erwarteter Fachname aus Rapla',
            required: true,
            autocomplete: true,
          },
        ],
      },
      {
        type: 1,
        name: 'list',
        description: 'Zeigt alle Fachzuordnungen',
      },
    ],
  },
];

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
