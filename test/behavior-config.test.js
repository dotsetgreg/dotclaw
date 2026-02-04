import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { distPath, importFresh, withTempHome } from './test-helpers.js';

test('loadBehaviorConfig clamps values and validates style', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotclaw-behavior-'));
  await withTempHome(tempDir, async () => {
    const configDir = path.join(tempDir, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'behavior.json'), JSON.stringify({
      tool_calling_bias: 5,
      memory_importance_threshold: -1,
      response_style: 'wild',
      caution_bias: Number.NaN,
      last_updated: '2026-02-02T00:00:00.000Z'
    }));

    const { loadBehaviorConfig, adjustBehaviorConfig } = await importFresh(distPath('behavior-config.js'));
    const config = loadBehaviorConfig();

    assert.equal(config.tool_calling_bias, 1);
    assert.equal(config.memory_importance_threshold, 0);
    assert.equal(config.caution_bias, 0.5);
    assert.equal(config.response_style, 'balanced');
    assert.equal(config.last_updated, '2026-02-02T00:00:00.000Z');

    const next = adjustBehaviorConfig(config, {
      tool_calling_bias: -0.25,
      response_style: 'concise'
    });

    assert.equal(next.tool_calling_bias, 0);
    assert.equal(next.response_style, 'concise');
  });
});

test('loadBehaviorConfig returns valid config structure', async () => {
  const { loadBehaviorConfig } = await importFresh(distPath('behavior-config.js'));
  const config = loadBehaviorConfig();

  // Check that config has required fields with valid types
  assert.ok(typeof config.tool_calling_bias === 'number', 'tool_calling_bias should be number');
  assert.ok(typeof config.memory_importance_threshold === 'number', 'memory_importance_threshold should be number');
  assert.ok(typeof config.caution_bias === 'number', 'caution_bias should be number');
  assert.ok(['concise', 'balanced', 'detailed'].includes(config.response_style), 'response_style should be valid');

  // Check values are within valid ranges
  assert.ok(config.tool_calling_bias >= 0 && config.tool_calling_bias <= 1, 'tool_calling_bias in range');
  assert.ok(config.memory_importance_threshold >= 0 && config.memory_importance_threshold <= 1, 'memory_importance_threshold in range');
  assert.ok(config.caution_bias >= 0 && config.caution_bias <= 1, 'caution_bias in range');
});
