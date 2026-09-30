import assert from 'node:assert/strict';
import test from 'node:test';
import { COMMANDS } from './command-definitions.js';

function command(name) {
  return COMMANDS.find((item) => item.name === name);
}

function subcommand(commandName, subcommandName) {
  return command(commandName).options.find((item) => item.name === subcommandName);
}

test('registers unique guild-only command names', () => {
  assert.equal(new Set(COMMANDS.map(({ name }) => name)).size, COMMANDS.length);
  for (const item of COMMANDS) {
    assert.equal(item.type, 1);
    assert.deepEqual(item.integration_types, [0]);
    assert.deepEqual(item.contexts, [0]);
    assert.ok(item.name.length >= 1 && item.name.length <= 32);
    assert.ok(item.description.length >= 1 && item.description.length <= 100);
  }
});

test('keeps only the self-service kuchen command public', () => {
  assert.equal(command('kuchen').default_member_permissions, undefined);
  for (const item of COMMANDS.filter(({ name }) => name !== 'kuchen')) {
    assert.equal(item.default_member_permissions, '8', item.name);
  }
});

test('defines cake done with a required user and optional amount', () => {
  const done = subcommand('cake', 'done');
  assert.equal(done.type, 1);
  assert.deepEqual(done.options, [
    {
      type: 6,
      name: 'username',
      description: 'Person, deren Kuchen erledigt ist',
      required: true,
    },
    {
      type: 3,
      name: 'amount',
      description: 'Anzahl von 1 bis 25 oder all',
      required: false,
    },
  ]);
});
