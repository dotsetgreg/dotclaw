import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { distPath, importFresh, withTempHome } from './test-helpers.js';

/**
 * Tests for the process-registry module (Sprint 1) and new tool policies.
 */

function makeTempHome() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotclaw-proc-'));
  const configDir = path.join(tempDir, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  // No tool-policy.json — will use DEFAULT_POLICY as-is
  return tempDir;
}

test('Process and AnalyzeImage are in DEFAULT_POLICY allow list', async () => {
  const tempDir = makeTempHome();
  await withTempHome(tempDir, async () => {
    const { getEffectiveToolPolicy } = await importFresh(distPath('tool-policy.js'));
    const policy = getEffectiveToolPolicy({ groupFolder: 'main' });
    assert.ok(policy.allow.includes('Process'), 'Process should be in allow list');
    assert.ok(policy.allow.includes('AnalyzeImage'), 'AnalyzeImage should be in allow list');
  });
});

test('Process has per-run limit of 128', async () => {
  const tempDir = makeTempHome();
  await withTempHome(tempDir, async () => {
    const { getEffectiveToolPolicy } = await importFresh(distPath('tool-policy.js'));
    const policy = getEffectiveToolPolicy({ groupFolder: 'main' });
    assert.equal(policy.max_per_run.Process, 128);
  });
});

test('AnalyzeImage has per-run limit of 16', async () => {
  const tempDir = makeTempHome();
  await withTempHome(tempDir, async () => {
    const { getEffectiveToolPolicy } = await importFresh(distPath('tool-policy.js'));
    const policy = getEffectiveToolPolicy({ groupFolder: 'main' });
    assert.equal(policy.max_per_run.AnalyzeImage, 16);
  });
});

test('mcp__dotclaw__subagent has per-run limit of 8', async () => {
  const tempDir = makeTempHome();
  await withTempHome(tempDir, async () => {
    const { getEffectiveToolPolicy } = await importFresh(distPath('tool-policy.js'));
    const policy = getEffectiveToolPolicy({ groupFolder: 'main' });
    assert.equal(policy.max_per_run.mcp__dotclaw__subagent, 8);
  });
});

test('config tools are in DEFAULT_POLICY allow list', async () => {
  const tempDir = makeTempHome();
  await withTempHome(tempDir, async () => {
    const { getEffectiveToolPolicy } = await importFresh(distPath('tool-policy.js'));
    const policy = getEffectiveToolPolicy({ groupFolder: 'main' });
    assert.ok(policy.allow.includes('mcp__dotclaw__get_config'));
    assert.ok(policy.allow.includes('mcp__dotclaw__set_tool_policy'));
    assert.ok(policy.allow.includes('mcp__dotclaw__set_behavior'));
    assert.ok(policy.allow.includes('mcp__dotclaw__set_mcp_config'));
    assert.ok(policy.allow.includes('mcp__dotclaw__subagent'));
  });
});
