import assert from 'node:assert/strict';
import test from 'node:test';
import { PASSWORD_MIN, passwordChecks, passwordProblem } from './passwordPolicy';

test('minimum is five characters', () => {
  assert.equal(PASSWORD_MIN, 5);
  assert.match(passwordProblem('abcd') ?? '', /at least 5/i);
  assert.equal(passwordProblem('abcde'), null);
  assert.equal(passwordProblem('x'.repeat(1024)), null);
  assert.match(passwordProblem('x'.repeat(1025)) ?? '', /at most/i);
  assert.match(passwordProblem(undefined) ?? '', /at least 5/i);
});

test('the email address and its local part are rejected, case-insensitively', () => {
  assert.match(passwordProblem('Bala@Example.test', 'bala@example.test') ?? '', /email/i);
  assert.match(passwordProblem('  bala  ', 'bala@example.test') ?? '', /email/i);
  assert.equal(passwordProblem('bala-2026!', 'bala@example.test'), null);
  assert.equal(passwordProblem('anything', undefined), null);
});

test('the checklist reflects each rule; the email rule appears only when the email is known', () => {
  assert.deepEqual(passwordChecks('').map(check => check.ok), [false]);
  assert.deepEqual(passwordChecks('abcdef').map(check => check.id), ['length']);
  assert.deepEqual(passwordChecks('abc', 'a@b.co').map(check => check.ok), [false, true]);
  assert.deepEqual(passwordChecks('abcdef', 'a@b.co').map(check => check.ok), [true, true]);
  assert.deepEqual(passwordChecks('a@b.co', 'a@b.co').map(check => check.ok), [true, false]);
});
