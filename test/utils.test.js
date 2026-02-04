import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isSafeGroupFolder } from '../dist/utils.js';

test('isSafeGroupFolder rejects invalid names and traversal', () => {
  const base = '/tmp/groups';
  assert.equal(isSafeGroupFolder('valid-name', base), true);
  assert.equal(isSafeGroupFolder('INVALID', base), false);
  assert.equal(isSafeGroupFolder('../escape', base), false);
});

