import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EMPTY_STATE = {
  exceptions: [],
  archivedCategories: [],
  courseAliases: [],
  pendingCategoryOrderIds: [],
};

test('normalizes state and serializes concurrent mutations atomically', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dcbot-state-'));
  const stateFile = join(directory, 'archive-state.json');
  process.env.ARCHIVE_STATE_FILE = stateFile;
  const store = await import(`./state-store.js?test=${Date.now()}`);

  try {
    assert.deepEqual(await store.readState(), EMPTY_STATE);

    await writeFile(stateFile, JSON.stringify({
      exceptions: 'invalid',
      archivedCategories: null,
      courseAliases: [{ normalizedExpectedName: 'valid' }],
      pendingCategoryOrderIds: {},
    }));
    assert.deepEqual(await store.readState(), {
      ...EMPTY_STATE,
      courseAliases: [{ normalizedExpectedName: 'valid' }],
    });

    await writeFile(stateFile, JSON.stringify(EMPTY_STATE));
    await Promise.all([
      store.addArchiveExceptions([{ id: '1', name: 'One' }]),
      store.addArchiveExceptions([{ id: '2', name: 'Two' }]),
      store.addArchiveExceptions([{ id: '3', name: 'Three' }]),
      store.rememberCategoryOrder(['1']),
      store.rememberCategoryOrder(['2']),
    ]);

    const state = await store.readState();
    assert.deepEqual(
      state.exceptions.map(({ id }) => id).sort(),
      ['1', '2', '3'],
    );
    assert.deepEqual(state.pendingCategoryOrderIds.sort(), ['1', '2']);
    const serializedState = await readFile(stateFile, 'utf8');
    assert.doesNotThrow(() => JSON.parse(serializedState));
    assert.deepEqual(
      (await readdir(directory)).filter((name) => name.endsWith('.tmp')),
      [],
    );
  } finally {
    delete process.env.ARCHIVE_STATE_FILE;
    await rm(directory, { recursive: true, force: true });
  }
});
