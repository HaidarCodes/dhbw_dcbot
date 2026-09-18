import 'dotenv/config';
import { DiscordRequest } from './utils.js';
import {
  addArchiveException,
  readState,
  recordArchivedCategories,
  removeArchiveException,
} from './state-store.js';

const CATEGORY_TYPE = 4;
const TEXT_CHANNEL_TYPE = 0;
const ARCHIVED_PREFIX = process.env.ARCHIVED_PREFIX || 'archived-';
const DEFAULT_LECTURES_URL =
  'https://api.dhbw.app/rapla/lectures/STG-TINF25F-CS/events';
const VIEW_CHANNEL = 1024n;
const SEND_MESSAGES = 2048n;
const READ_MESSAGE_HISTORY = 65536n;
const CREATE_PUBLIC_THREADS = 34359738368n;
const CREATE_PRIVATE_THREADS = 68719476736n;
const SEND_MESSAGES_IN_THREADS = 274877906944n;
const READ_ONLY_ALLOW = VIEW_CHANNEL | READ_MESSAGE_HISTORY;
const READ_ONLY_DENY =
  SEND_MESSAGES |
  CREATE_PUBLIC_THREADS |
  CREATE_PRIVATE_THREADS |
  SEND_MESSAGES_IN_THREADS;

export function normalizeName(value) {
  return value
    .trim()
    .toLocaleLowerCase('de-DE')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function fetchLectures() {
  const headers = {};
  if (process.env.LECTURES_API_TOKEN) {
    headers.Authorization = `Bearer ${process.env.LECTURES_API_TOKEN}`;
  }

  const response = await fetch(process.env.LECTURES_API_URL || DEFAULT_LECTURES_URL, {
    headers,
  });
  if (!response.ok) {
    throw new Error(`DHBW lectures API returned HTTP ${response.status}`);
  }

  const events = await response.json();
  if (!Array.isArray(events)) {
    throw new Error('DHBW lectures API response must be an array');
  }
  return events;
}

async function fetchGuildChannels() {
  const response = await DiscordRequest(`guilds/${process.env.DISCORD_GUILD_ID}/channels`, {
    method: 'GET',
  });
  return response.json();
}

export function getExpectedCategories(events, now = new Date()) {
  const expected = new Map();

  for (const event of events) {
    if (
      event.entityType !== 'LECTURE' ||
      typeof event.name !== 'string' ||
      Number.isNaN(Date.parse(event.endTime)) ||
      new Date(event.endTime) <= now
    ) {
      continue;
    }

    const displayName = event.name.trim();
    expected.set(normalizeName(displayName), displayName);
  }
  return expected;
}

function isArchivedCategory(category) {
  return category.name.startsWith(ARCHIVED_PREFIX);
}

function originalCategoryName(category) {
  return isArchivedCategory(category)
    ? category.name.slice(ARCHIVED_PREFIX.length)
    : category.name;
}

function requireConfiguration() {
  if (!process.env.DISCORD_GUILD_ID) {
    throw new Error('DISCORD_GUILD_ID is required');
  }
}

async function loadContext() {
  requireConfiguration();
  const [events, channels, state] = await Promise.all([
    fetchLectures(),
    fetchGuildChannels(),
    readState(),
  ]);
  return {
    channels,
    state,
    expectedCategories: getExpectedCategories(events),
  };
}

export function buildArchivePlan(channels, expectedCategories, exceptionIds) {
  return channels
    .filter((channel) => channel.type === CATEGORY_TYPE)
    .filter(
      (category) =>
        !isArchivedCategory(category) &&
        !exceptionIds.has(category.id) &&
        !expectedCategories.has(normalizeName(category.name)),
    )
    .map((category) => ({
      category,
      children: channels
        .filter((channel) => channel.parent_id === category.id)
        .sort((a, b) => a.position - b.position),
    }));
}

async function setCategoryReadOnly(category) {
  const currentOverwrite = category.permission_overwrites?.find(
    (overwrite) =>
      overwrite.id === process.env.DISCORD_GUILD_ID && overwrite.type === 0,
  );
  const currentAllow = BigInt(currentOverwrite?.allow || 0);
  const currentDeny = BigInt(currentOverwrite?.deny || 0);

  await DiscordRequest(
    `channels/${category.id}/permissions/${process.env.DISCORD_GUILD_ID}`,
    {
      method: 'PUT',
      body: {
        type: 0,
        allow: ((currentAllow | READ_ONLY_ALLOW) & ~READ_ONLY_DENY).toString(),
        deny: ((currentDeny | READ_ONLY_DENY) & ~READ_ONLY_ALLOW).toString(),
      },
    },
  );
}

async function moveCategoriesToBottom(categoryIds, channels) {
  const archivedIds = new Set(categoryIds);
  const orderedCategories = channels
    .filter((channel) => channel.type === CATEGORY_TYPE)
    .sort((a, b) => a.position - b.position);
  const reorderedCategories = [
    ...orderedCategories.filter(
      (category) => !archivedIds.has(category.id) && !isArchivedCategory(category),
    ),
    ...orderedCategories.filter(
      (category) => archivedIds.has(category.id) || isArchivedCategory(category),
    ),
  ];
  const positions = orderedCategories.map((category) => category.position);

  await DiscordRequest(`guilds/${process.env.DISCORD_GUILD_ID}/channels`, {
    method: 'PATCH',
    body: reorderedCategories.map((category, index) => ({
      id: category.id,
      position: positions[index],
    })),
  });
}

async function archiveCategories(categories, channels) {
  await Promise.all(
    categories.map(async (category) => {
      await DiscordRequest(`channels/${category.id}`, {
        method: 'PATCH',
        body: { name: `${ARCHIVED_PREFIX}${category.name}` },
      });
      await setCategoryReadOnly(category);
    }),
  );
  await moveCategoriesToBottom(categories.map((category) => category.id), channels);
  await recordArchivedCategories(categories);
}

export async function previewArchivedCategories() {
  const { channels, state, expectedCategories } = await loadContext();
  const exceptionIds = new Set(state.exceptions.map((item) => item.id));
  const plan = buildArchivePlan(channels, expectedCategories, exceptionIds);

  return {
    expectedCategories: [...expectedCategories.values()].sort((a, b) =>
      a.localeCompare(b, 'de'),
    ),
    exceptions: state.exceptions,
    archivedCategories: state.archivedCategories,
    categories: plan.map(({ category, children }) => ({
      name: category.name,
      channels: children.map((channel) => channel.name),
    })),
  };
}

export async function archiveCategory(categoryId) {
  requireConfiguration();
  const channels = await fetchGuildChannels();
  const category = channels.find(
    (channel) => channel.id === categoryId && channel.type === CATEGORY_TYPE,
  );
  if (!category) {
    throw new Error('The selected category does not exist');
  }
  if (isArchivedCategory(category)) {
    return { archived: false, name: category.name };
  }

  await archiveCategories([category], channels);
  return { archived: true, name: category.name };
}

export async function archiveAllOldCategories() {
  const { channels, state, expectedCategories } = await loadContext();
  const exceptionIds = new Set(state.exceptions.map((item) => item.id));
  const plan = buildArchivePlan(channels, expectedCategories, exceptionIds);
  const categories = plan.map(({ category }) => category);

  if (categories.length > 0) {
    await archiveCategories(categories, channels);
  }
  return { categories: categories.map((category) => category.name) };
}

export async function addException(categoryId) {
  requireConfiguration();
  const channels = await fetchGuildChannels();
  const category = channels.find(
    (channel) => channel.id === categoryId && channel.type === CATEGORY_TYPE,
  );
  if (!category) {
    throw new Error('The selected category does not exist');
  }

  const added = await addArchiveException({ id: category.id, name: category.name });
  return { added, category };
}

export async function removeException(categoryId) {
  return removeArchiveException(categoryId);
}

export async function listExceptions() {
  const state = await readState();
  return state.exceptions;
}

export function getMissingCategoryNames(channels, expectedCategories) {
  const existingNames = new Set(
    channels
      .filter((channel) => channel.type === CATEGORY_TYPE)
      .map((category) => normalizeName(originalCategoryName(category))),
  );
  return [...expectedCategories.entries()]
    .filter(([normalizedName]) => !existingNames.has(normalizedName))
    .map(([, displayName]) => displayName);
}

export async function previewMissingCourseCategories() {
  const { channels, expectedCategories } = await loadContext();
  return {
    categories: getMissingCategoryNames(channels, expectedCategories),
  };
}

export async function createMissingCourseCategories() {
  const { channels, expectedCategories } = await loadContext();
  const missingNames = getMissingCategoryNames(channels, expectedCategories);
  const created = [];

  for (const categoryName of missingNames) {
    const categoryResponse = await DiscordRequest(
      `guilds/${process.env.DISCORD_GUILD_ID}/channels`,
      {
        method: 'POST',
        body: { name: categoryName, type: CATEGORY_TYPE },
      },
    );
    const category = await categoryResponse.json();

    for (const name of ['general', 'bilder']) {
      await DiscordRequest(`guilds/${process.env.DISCORD_GUILD_ID}/channels`, {
          method: 'POST',
          body: {
            name,
            type: TEXT_CHANNEL_TYPE,
            parent_id: category.id,
          },
      });
    }
    created.push(categoryName);
  }

  return { categories: created };
}
