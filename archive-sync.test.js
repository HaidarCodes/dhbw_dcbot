import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildArchivePlan,
  getExpectedCategories,
  normalizeName,
} from './archive-sync.js';

test('normalizes Discord and Rapla category names consistently', () => {
  assert.equal(normalizeName('  Formale Sprachen  '), 'formale-sprachen');
  assert.equal(normalizeName('Angewandte-Mathematik'), 'angewandte-mathematik');
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

  assert.deepEqual(buildArchivePlan(channels, expected, new Set(['2'])), [
    {
      category: channels[2],
      children: [channels[4], channels[5]],
    },
  ]);
});
