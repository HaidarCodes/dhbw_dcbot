import assert from 'node:assert/strict';
import test from 'node:test';
import {
  archiveCategoryAction,
  buildArchivePlan,
  getExpectedCategories,
  getMissingCategoryNames,
  normalizeName,
  orderCreatedCategories,
  presentArchiveAll,
  presentSingleArchive,
} from './archive-sync.js';

test('normalizes Discord and Rapla category names consistently', () => {
  assert.equal(normalizeName('  Formale Sprachen  '), 'formale-sprachen');
  assert.equal(normalizeName('Angewandte-Mathematik'), 'angewandte-mathematik');
});

test('finds expected categories that do not exist yet', () => {
  const channels = [
    { id: '1', type: 4, name: 'Datenbanken' },
    { id: '2', type: 4, name: 'archived-Netztechnik' },
  ];
  const expected = new Map([
    ['datenbanken', 'Datenbanken'],
    ['netztechnik', 'Netztechnik'],
    ['data-science', 'Data Science'],
  ]);

  assert.deepEqual(getMissingCategoryNames(channels, expected), ['Data Science']);
});

test('treats an aliased category as the expected course', () => {
  const channels = [{ id: '1', type: 4, name: 'Informatik 2', position: 0 }];
  const expected = new Map([
    ['software-engineering', 'Software Engineering'],
  ]);
  const aliases = [
    {
      normalizedExpectedName: 'software-engineering',
      expectedName: 'Software Engineering',
      categoryId: '1',
      categoryName: 'Informatik 2',
    },
  ];

  assert.deepEqual(getMissingCategoryNames(channels, expected, aliases), []);
  assert.deepEqual(buildArchivePlan(channels, expected, new Set(), aliases), []);
});

test('uses only future lecture events as expected categories', () => {
  const events = [
    {
      entityType: 'LECTURE',
      name: ' Datenbanken ',
      endTime: '2026-09-19T10:00:00.000Z',
    },
    {
      entityType: 'EVENT',
      name: 'Studieninformation',
      endTime: '2026-09-19T10:00:00.000Z',
    },
    {
      entityType: 'BLOCKER',
      name: 'Blocker',
      endTime: '2026-09-19T10:00:00.000Z',
    },
    {
      entityType: 'LECTURE',
      name: ' Aufbau StudiInfoTag - VL nur online ',
      endTime: '2026-09-19T10:00:00.000Z',
    },
    {
      entityType: 'LECTURE',
      name: ' geblockt für Klausur ',
      endTime: '2026-09-19T10:00:00.000Z',
    },
    {
      entityType: 'LECTURE',
      name: 'Altes Fach',
      endTime: '2026-09-17T10:00:00.000Z',
    },
  ];

  assert.deepEqual(
    [...getExpectedCategories(events, new Date('2026-09-18T00:00:00.000Z'))],
    [['datenbanken', 'Datenbanken']],
  );
});

test('plans only inactive, non-exempt, non-archived categories', () => {
  const channels = [
    { id: '1', type: 4, name: 'Datenbanken', position: 0 },
    { id: '2', type: 4, name: 'Organisation', position: 1 },
    { id: '3', type: 4, name: 'Altes Fach', position: 2 },
    { id: '4', type: 4, name: 'archived-Netztechnik', position: 3 },
    { id: '5', type: 0, name: 'general', parent_id: '3', position: 4 },
    { id: '6', type: 0, name: 'bilder', parent_id: '3', position: 5 },
  ];
  const expected = new Map([['datenbanken', 'Datenbanken']]);

  assert.deepEqual(buildArchivePlan(
    channels,
    expected,
    new Set(['2']),
    [],
    new Set(['4']),
  ), [
    {
      category: channels[2],
      children: [channels[4], channels[5]],
    },
  ]);
});

test('distinguishes a finished archive from a failed or unfinished one', () => {
  const prefixed = { id: '1', name: 'archived-Altes Fach' };
  assert.equal(archiveCategoryAction(prefixed, new Set(['1'])), 'already');
  assert.equal(archiveCategoryAction(prefixed, new Set()), 'run');
  assert.equal(
    archiveCategoryAction({ id: '2', name: 'Altes Fach' }, new Set()),
    'run',
  );

  assert.equal(
    presentSingleArchive({ outcome: 'failed', name: 'Altes Fach' }).title,
    'Archivierung fehlgeschlagen',
  );
  assert.equal(
    presentSingleArchive({ outcome: 'already', name: 'Altes Fach' }).title,
    'Bereits archiviert',
  );
  assert.equal(
    presentArchiveAll({ categories: [], warnings: [{ channelName: 'general' }] }).description,
    'Keine Kategorie konnte archiviert werden.',
  );
  assert.equal(
    presentArchiveAll({ categories: [], warnings: [] }).description,
    'Keine alten Fachkategorien gefunden.',
  );
});

test('retries prefixed categories that were not recorded as completed', () => {
  const channels = [
    { id: '1', type: 4, name: 'archived-Altes Fach', position: 0 },
    { id: '2', type: 4, name: 'archived-Fertig', position: 1 },
  ];

  assert.deepEqual(
    buildArchivePlan(
      channels,
      new Map(),
      new Set(),
      [],
      new Set(['2']),
    ).map(({ category }) => category.id),
    ['1'],
  );
});

test('places created courses after four fixed categories and before archives', () => {
  const categories = [
    { id: 'hidden', name: 'Admin' },
    { id: 'general', name: 'Allgemein' },
    { id: 'info', name: 'Information' },
    { id: 'voice', name: 'Sprachkanäle' },
    { id: 'old-course', name: 'Datenbanken' },
    { id: 'archive', name: 'archived-Altes Fach' },
    { id: 'new-1', name: 'Software Engineering' },
    { id: 'new-2', name: 'Netztechnik' },
  ];

  assert.deepEqual(
    orderCreatedCategories(categories, ['new-1', 'new-2']).map(({ id }) => id),
    [
      'hidden',
      'general',
      'info',
      'voice',
      'new-1',
      'new-2',
      'old-course',
      'archive',
    ],
  );
});
