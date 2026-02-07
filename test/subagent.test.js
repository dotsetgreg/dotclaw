import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { distPath, importFresh, withTempHome } from './test-helpers.js';

/**
 * Tests for Sprint 3 sub-agent orchestration.
 */

function makeTempHome() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotclaw-sub-'));
  const configDir = path.join(tempDir, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  return tempDir;
}

test('mcp__dotclaw__subagent is in DEFAULT_POLICY allow list', async () => {
  const tempDir = makeTempHome();
  await withTempHome(tempDir, async () => {
    const { getEffectiveToolPolicy } = await importFresh(distPath('tool-policy.js'));
    const policy = getEffectiveToolPolicy({ groupFolder: 'main' });
    assert.ok(policy.allow.includes('mcp__dotclaw__subagent'));
  });
});

test('mcp__dotclaw__subagent has max_per_run of 8', async () => {
  const tempDir = makeTempHome();
  await withTempHome(tempDir, async () => {
    const { getEffectiveToolPolicy } = await importFresh(distPath('tool-policy.js'));
    const policy = getEffectiveToolPolicy({ groupFolder: 'main' });
    assert.equal(policy.max_per_run.mcp__dotclaw__subagent, 8);
  });
});

test('new config tools are allowed by default policy', async () => {
  const tempDir = makeTempHome();
  await withTempHome(tempDir, async () => {
    const { getEffectiveToolPolicy } = await importFresh(distPath('tool-policy.js'));
    const policy = getEffectiveToolPolicy({ groupFolder: 'main' });
    const expected = [
      'mcp__dotclaw__get_config',
      'mcp__dotclaw__set_tool_policy',
      'mcp__dotclaw__set_behavior',
      'mcp__dotclaw__set_mcp_config',
      'mcp__dotclaw__subagent',
      'Process',
      'AnalyzeImage',
    ];
    for (const tool of expected) {
      assert.ok(policy.allow.includes(tool), `${tool} should be in allow list`);
    }
  });
});

test('effective policy deny list starts empty', async () => {
  const tempDir = makeTempHome();
  await withTempHome(tempDir, async () => {
    const { getEffectiveToolPolicy } = await importFresh(distPath('tool-policy.js'));
    const policy = getEffectiveToolPolicy({ groupFolder: 'test-group' });
    assert.deepEqual(policy.deny, []);
  });
});
