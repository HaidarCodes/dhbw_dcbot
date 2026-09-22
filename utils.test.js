import assert from 'node:assert/strict';
import test from 'node:test';
import { clampEmbed } from './utils.js';

test('keeps a full archive preview inside Discord embed limits', () => {
  const description = 'K'.repeat(2400);
  const fields = [
    { name: 'Erwartete Fachkategorien', value: 'E'.repeat(900) },
    { name: 'Ausnahmen', value: 'A'.repeat(900) },
    { name: 'Lokal als archiviert gespeichert', value: 'L'.repeat(900) },
    { name: 'Fachzuordnungen', value: 'F'.repeat(900) },
  ];
  const title = 'Archivierungsvorschau';
  const footer = 'DHBW Discord Bot';
  const fitted = clampEmbed({ title, description, fields, footer });

  const total = title.length
    + footer.length
    + fitted.description.length
    + fitted.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);

  assert.ok(total <= 6000);
  assert.ok(fitted.description.length <= 4096);
  assert.ok(fitted.fields.every((field) => field.value.length <= 1024));
  assert.ok(fitted.fields.every((field) => field.value.length > 0));
});
