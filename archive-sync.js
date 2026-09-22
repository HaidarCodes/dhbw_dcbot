import 'dotenv/config';
import { DiscordRequest } from './utils.js';
import {
  addArchiveExceptions,
  deleteCourseAlias,
  readState,
  recordArchivedCategories,
  removeArchiveException,
  saveCourseAlias,
} from './state-store.js';

const CATEGORY_TYPE = 4;
const TEXT_CHANNEL_TYPE = 0;
const FIXED_TOP_CATEGORY_COUNT = 4;
const ARCHIVED_PREFIX = process.env.ARCHIVED_PREFIX || 'archived-';
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
const DEFAULT_IGNORED_LECTURE_NAMES = [
  'Aufbau StudiInfoTag - VL nur online',
  'StudiInfoTag - VL nur online',
  'geblockt für Klausur',
];
let expectedCourseNameCache = { expiresAt: 0, names: [] };

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
  if (!process.env.LECTURES_API_URL) {
    throw new Error('LECTURES_API_URL is required');
  }

  const headers = {};
  if (process.env.LECTURES_API_TOKEN) {
    headers.Authorization = `Bearer ${process.env.LECTURES_API_TOKEN}`;
  }

  const response = await fetch(process.env.LECTURES_API_URL, {
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
  const ignoredNames = new Set(DEFAULT_IGNORED_LECTURE_NAMES.map(normalizeName));

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
    if (ignoredNames.has(normalizeName(displayName))) {
      continue;
    }
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

function getActiveAliasCategoryIds(channels, expectedCategories, aliases) {
  const categoryIds = new Set(
    channels
      .filter((channel) => channel.type === CATEGORY_TYPE)
      .map((category) => category.id),
  );

  return new Set(
    aliases
      .filter(
        (alias) =>
          expectedCategories.has(alias.normalizedExpectedName) &&
          categoryIds.has(alias.categoryId),
      )
      .map((alias) => alias.categoryId),
  );
}

export function buildArchivePlan(
  channels,
  expectedCategories,
  exceptionIds,
  aliases = [],
  archivedCategoryIds = new Set(),
) {
  const activeAliasCategoryIds = getActiveAliasCategoryIds(
    channels,
    expectedCategories,
    aliases,
  );
  return channels
    .filter((channel) => channel.type === CATEGORY_TYPE)
    .filter(
      (category) =>
        !archivedCategoryIds.has(category.id) &&
        !exceptionIds.has(category.id) &&
        !activeAliasCategoryIds.has(category.id) &&
        !expectedCategories.has(normalizeName(originalCategoryName(category))),
    )
    .map((category) => ({
      category,
      children: channels
        .filter((channel) => channel.parent_id === category.id)
        .sort((a, b) => a.position - b.position),
    }));
}

async function setChannelReadOnly(channel) {
  const currentOverwrite = channel.permission_overwrites?.find(
    (overwrite) =>
      overwrite.id === process.env.DISCORD_GUILD_ID && overwrite.type === 0,
  );
  const currentAllow = BigInt(currentOverwrite?.allow || 0);
  const currentDeny = BigInt(currentOverwrite?.deny || 0);

  await DiscordRequest(
    `channels/${channel.id}/permissions/${process.env.DISCORD_GUILD_ID}`,
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
  const completed = [];
  const warnings = [];

  for (const category of categories) {
    if (!isArchivedCategory(category)) {
      try {
        await DiscordRequest(`channels/${category.id}`, {
          method: 'PATCH',
          body: { name: `${ARCHIVED_PREFIX}${category.name}` },
        });
      } catch (error) {
        warnings.push({
          action: 'Kategorie umbenennen',
          categoryName: originalCategoryName(category),
          channelName: category.name,
          channelId: category.id,
          error,
        });
        continue;
      }
    }

    const categoryChannels = [
      category,
      ...channels.filter((channel) => channel.parent_id === category.id),
    ];
    for (const channel of categoryChannels) {
      try {
        await setChannelReadOnly(channel);
      } catch (error) {
        warnings.push({
          action: 'Schreibschutz setzen',
          categoryName: originalCategoryName(category),
          channelName: channel.name,
          channelId: channel.id,
          error,
        });
      }
    }
    completed.push(category);
  }

  if (completed.length > 0) {
    await moveCategoriesToBottom(
      completed.map((category) => category.id),
      channels,
    );
    await recordArchivedCategories(completed);
  }

  return { completed, warnings };
}

export async function previewArchivedCategories() {
  const { channels, state, expectedCategories } = await loadContext();
  const exceptionIds = new Set(state.exceptions.map((item) => item.id));
  const plan = buildArchivePlan(
    channels,
    expectedCategories,
    exceptionIds,
    state.courseAliases,
    new Set(state.archivedCategories.map((category) => category.id)),
  );

  return {
    expectedCategories: [...expectedCategories.values()].sort((a, b) =>
      a.localeCompare(b, 'de'),
    ),
    exceptions: state.exceptions,
    archivedCategories: state.archivedCategories,
    courseAliases: state.courseAliases,
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

  const result = await archiveCategories([category], channels);
  return {
    archived: result.completed.length === 1,
    name: category.name,
    warnings: result.warnings,
  };
}

export async function archiveAllOldCategories() {
  const { channels, state, expectedCategories } = await loadContext();
  const exceptionIds = new Set(state.exceptions.map((item) => item.id));
  const plan = buildArchivePlan(
    channels,
    expectedCategories,
    exceptionIds,
    state.courseAliases,
    new Set(state.archivedCategories.map((category) => category.id)),
  );
  const categories = plan.map(({ category }) => category);

  const result = categories.length > 0
    ? await archiveCategories(categories, channels)
    : { completed: [], warnings: [] };
  return {
    categories: result.completed.map((category) => category.name),
    warnings: result.warnings,
  };
}

export async function addExceptions(categoryIds) {
  requireConfiguration();
  const channels = await fetchGuildChannels();
  const requestedIds = new Set(categoryIds);
  const categories = channels.filter(
    (channel) =>
      channel.type === CATEGORY_TYPE && requestedIds.has(channel.id),
  );
  if (categories.length !== requestedIds.size) {
    throw new Error('At least one selected category does not exist');
  }

  return addArchiveExceptions(categories);
}

export async function removeException(categoryId) {
  return removeArchiveException(categoryId);
}

export async function listExceptions() {
  const state = await readState();
  return state.exceptions;
}

export function getMissingCategoryNames(channels, expectedCategories, aliases = []) {
  const existingNames = new Set(
    channels
      .filter((channel) => channel.type === CATEGORY_TYPE)
      .map((category) => normalizeName(originalCategoryName(category))),
  );
  const aliasedExpectedNames = new Set(
    aliases
      .filter((alias) =>
        channels.some(
          (channel) =>
            channel.type === CATEGORY_TYPE && channel.id === alias.categoryId,
        ))
      .map((alias) => alias.normalizedExpectedName),
  );
  return [...expectedCategories.entries()]
    .filter(
      ([normalizedName]) =>
        !existingNames.has(normalizedName) &&
        !aliasedExpectedNames.has(normalizedName),
    )
    .map(([, displayName]) => displayName);
}

export function orderCreatedCategories(
  categories,
  createdCategoryIds,
  fixedTopCount = FIXED_TOP_CATEGORY_COUNT,
) {
  const createdIds = new Set(createdCategoryIds);
  const createdCategories = [];
  const activeCategories = [];
  const archivedCategories = [];

  for (const category of categories) {
    if (createdIds.has(category.id)) {
      createdCategories.push(category);
      continue;
    }
    if (isArchivedCategory(category)) {
      archivedCategories.push(category);
      continue;
    }
    activeCategories.push(category);
  }

  return [
    ...activeCategories.slice(0, fixedTopCount),
    ...createdCategories,
    ...activeCategories.slice(fixedTopCount),
    ...archivedCategories,
  ];
}

export async function previewMissingCourseCategories() {
  const { channels, expectedCategories, state } = await loadContext();
  return {
    categories: getMissingCategoryNames(
      channels,
      expectedCategories,
      state.courseAliases,
    ),
  };
}

export async function createMissingCourseCategories() {
  const { channels, expectedCategories, state } = await loadContext();
  const missingNames = getMissingCategoryNames(
    channels,
    expectedCategories,
    state.courseAliases,
  );
  const created = [];
  const createdCategoryIds = [];

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
    createdCategoryIds.push(category.id);
  }

  if (created.length > 0) {
    const updatedChannels = await fetchGuildChannels();
    const orderedCategories = updatedChannels
      .filter((channel) => channel.type === CATEGORY_TYPE)
      .sort((a, b) => a.position - b.position);
    const reorderedCategories = orderCreatedCategories(
      orderedCategories,
      createdCategoryIds,
    );
    const positions = orderedCategories.map((category) => category.position);

    await DiscordRequest(`guilds/${process.env.DISCORD_GUILD_ID}/channels`, {
      method: 'PATCH',
      body: reorderedCategories.map((category, index) => ({
        id: category.id,
        position: positions[index],
      })),
    });
  }

  return { categories: created };
}

export async function addCourseAlias(expectedName, categoryId) {
  const { channels, expectedCategories } = await loadContext();
  const normalizedExpectedName = normalizeName(expectedName);
  const canonicalExpectedName = expectedCategories.get(normalizedExpectedName);
  if (!canonicalExpectedName) {
    throw new Error(`Unknown expected course: ${expectedName}`);
  }

  const category = channels.find(
    (channel) => channel.type === CATEGORY_TYPE && channel.id === categoryId,
  );
  if (!category) {
    throw new Error('The selected category does not exist');
  }

  const added = await saveCourseAlias({
    normalizedExpectedName,
    expectedName: canonicalExpectedName,
    categoryId: category.id,
    categoryName: category.name,
  });
  return { added, expectedName: canonicalExpectedName, category };
}

export async function removeCourseAlias(expectedName) {
  return deleteCourseAlias(normalizeName(expectedName));
}

export async function listCourseAliases() {
  const state = await readState();
  return state.courseAliases;
}

export async function listExpectedCourseNames() {
  if (expectedCourseNameCache.expiresAt > Date.now()) {
    return expectedCourseNameCache.names;
  }

  const events = await fetchLectures();
  const names = [...getExpectedCategories(events).values()].sort((a, b) =>
    a.localeCompare(b, 'de'),
  );
  expectedCourseNameCache = {
    expiresAt: Date.now() + 5 * 60 * 1000,
    names,
  };
  return names;
}
