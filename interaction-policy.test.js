import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canExecuteCommand,
  isAdministrator,
  isPublicCommand,
} from './interaction-policy.js';

test('recognizes the Discord administrator permission bit', () => {
  assert.equal(isAdministrator({ permissions: '8' }), true);
  assert.equal(isAdministrator({ permissions: '40' }), true);
  assert.equal(isAdministrator({ permissions: '32' }), false);
  assert.equal(isAdministrator(undefined), false);
});

test('keeps only kuchen public', () => {
  assert.equal(isPublicCommand('kuchen'), true);
  for (const command of ['cake', 'archive', 'archiveall', 'coursealias']) {
    assert.equal(isPublicCommand(command), false, command);
  }
});

test('allows public commands and protects administrative commands', () => {
  const member = { permissions: '0' };
  const administrator = { permissions: '8' };

  assert.equal(canExecuteCommand('kuchen', member), true);
  assert.equal(canExecuteCommand('cake', member), false);
  assert.equal(canExecuteCommand('cake', administrator), true);
});
