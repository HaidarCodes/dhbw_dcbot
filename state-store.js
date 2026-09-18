import 'dotenv/config';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const stateFile = resolve(process.env.ARCHIVE_STATE_FILE || 'data/archive-state.json');
let mutationQueue = Promise.resolve();

function emptyState() {
  return {
    exceptions: [],
    archivedCategories: [],
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

export function addArchiveException(category) {
  return mutateState((state) => {
    const existing = state.exceptions.find((item) => item.id === category.id);
    if (existing) {
      existing.name = category.name;
      return false;
    }
    state.exceptions.push({ id: category.id, name: category.name });
    return true;
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
