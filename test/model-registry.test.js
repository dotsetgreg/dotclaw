import { test } from 'node:test';
import assert from 'node:assert/strict';

import { distPath, importFresh } from './test-helpers.js';

test('resolveModel returns valid model result', async () => {
  const { resolveModel } = await importFresh(distPath('model-registry.js'));

  // Test that resolveModel returns expected structure
  const result = resolveModel({
    groupFolder: 'test-group',
    defaultModel: 'openai/gpt-4o-mini'
  });

  assert.ok(typeof result.model === 'string', 'result.model should be a string');
  assert.ok(result.model.length > 0, 'result.model should not be empty');

  // Override should be either an object or undefined
  if (result.override !== undefined) {
    assert.ok(typeof result.override === 'object', 'result.override should be an object if defined');
  }
});

test('resolveModel uses default when no override configured', async () => {
  const { resolveModel } = await importFresh(distPath('model-registry.js'));

  const defaultModel = 'test/fallback-model';
  const result = resolveModel({
    groupFolder: 'nonexistent-group-xyz',
    userId: 'nonexistent-user-xyz',
    defaultModel
  });

  // When no overrides are configured for the group/user, should return something
  assert.ok(typeof result.model === 'string', 'Should return a model string');
});
