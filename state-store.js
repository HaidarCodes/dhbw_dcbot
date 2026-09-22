import 'dotenv/config';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const stateFile = resolve(process.env.ARCHIVE_STATE_FILE || 'data/archive-state.json');
let mutationQueue = Promise.resolve();

function emptyState() {
  return {
    exceptions: [],
    archivedCategories: [],
    courseAliases: [],
    pendingCategoryOrderIds: [],
  };
}

export async function readState() {
  try {
    const state = JSON.parse(await readFile(stateFile, 'utf8'));
    return {
      exceptions: Array.isArray(state.exceptions) ? state.exceptions : [],
      archivedCategories: Array.isArray(state.archivedCategories)
        ? state.archivedCategories
        : [],
      courseAliases: Array.isArray(state.courseAliases) ? state.courseAliases : [],
      pendingCategoryOrderIds: Array.isArray(state.pendingCategoryOrderIds)
        ? state.pendingCategoryOrderIds
        : [],
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return emptyState();
    }
    throw error;
  }
}

async function writeState(state) {
  await mkdir(dirname(stateFile), { recursive: true });
  const temporaryFile = `${stateFile}.${process.pid}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(temporaryFile, stateFile);
}

function mutateState(mutator) {
  const mutation = mutationQueue.then(async () => {
    const state = await readState();
    const result = mutator(state);
    await writeState(state);
    return result;
  });
  mutationQueue = mutation.catch(() => {});
  return mutation;
}

export function addArchiveExceptions(categories) {
  return mutateState((state) => {
    const existingById = new Map(
      state.exceptions.map((exception) => [exception.id, exception]),
    );
    const added = [];
    const existing = [];

    for (const category of categories) {
      const saved = existingById.get(category.id);
      if (saved) {
        saved.name = category.name;
        existing.push(category.name);
        continue;
      }
      const exception = { id: category.id, name: category.name };
      state.exceptions.push(exception);
      existingById.set(category.id, exception);
      added.push(category.name);
    }

    return { added, existing };
  });
}

export function removeArchiveException(categoryId) {
  return mutateState((state) => {
    const previousLength = state.exceptions.length;
    state.exceptions = state.exceptions.filter((item) => item.id !== categoryId);
    return state.exceptions.length !== previousLength;
  });
}

export function recordArchivedCategories(categories) {
  return mutateState((state) => {
    const archivedById = new Map(
      state.archivedCategories.map((category) => [category.id, category]),
    );
    const archivedAt = new Date().toISOString();
    for (const category of categories) {
      archivedById.set(category.id, {
        id: category.id,
        name: category.name,
        archivedAt,
      });
    }
    state.archivedCategories = [...archivedById.values()];
  });
}

export function saveCourseAlias(alias) {
  return mutateState((state) => {
    const normalizedExpectedName = alias.normalizedExpectedName;
    const existing = state.courseAliases.find(
      (item) => item.normalizedExpectedName === normalizedExpectedName,
    );
    if (existing) {
      Object.assign(existing, alias);
      return false;
    }
    state.courseAliases.push(alias);
    return true;
  });
}

export function deleteCourseAlias(normalizedExpectedName) {
  return mutateState((state) => {
    const previousLength = state.courseAliases.length;
    state.courseAliases = state.courseAliases.filter(
      (item) => item.normalizedExpectedName !== normalizedExpectedName,
    );
    return state.courseAliases.length !== previousLength;
  });
}

export function rememberCategoryOrder(categoryIds) {
  return mutateState((state) => {
    const pending = new Set(state.pendingCategoryOrderIds);
    for (const categoryId of categoryIds) pending.add(categoryId);
    state.pendingCategoryOrderIds = [...pending];
  });
}

export function forgetCategoryOrder(categoryIds) {
  const remove = new Set(categoryIds);
  return mutateState((state) => {
    state.pendingCategoryOrderIds = state.pendingCategoryOrderIds.filter(
      (categoryId) => !remove.has(categoryId),
    );
  });
}
