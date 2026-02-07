import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { distPath, importFresh, withTempHome } from './test-helpers.js';

test('routeRequest returns flat config from defaults', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotclaw-router-'));
  await withTempHome(tempDir, async () => {
    const { routeRequest } = await importFresh(distPath('request-router.js'));
    const decision = routeRequest();
    assert.equal(typeof decision.model, 'string');
    assert.ok(decision.model.length > 0);
    assert.equal(typeof decision.maxOutputTokens, 'number');
    assert.equal(typeof decision.maxToolSteps, 'number');
    assert.ok(decision.maxToolSteps > 0);
    assert.equal(typeof decision.recallMaxResults, 'number');
    assert.equal(typeof decision.recallMaxTokens, 'number');
  });
});

test('routeRequest respects runtime.json overrides', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotclaw-router-'));
  const configDir = path.join(tempDir, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'runtime.json'), JSON.stringify({
    host: {
      routing: {
        model: 'test/model-123',
        maxOutputTokens: 8192,
        maxToolSteps: 10
      }
    }
  }, null, 2));
  await withTempHome(tempDir, async () => {
    const { routeRequest } = await importFresh(distPath('request-router.js'));
    const decision = routeRequest();
    assert.equal(decision.model, 'test/model-123');
    assert.equal(decision.maxOutputTokens, 8192);
    assert.equal(decision.maxToolSteps, 10);
  });
});

test('routeRequest filters fallbacks with allowedModels', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotclaw-router-'));
  const configDir = path.join(tempDir, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'runtime.json'), JSON.stringify({
    host: {
      routing: {
        model: 'primary/model',
        fallbacks: ['allowed/model', 'blocked/model', 'also-allowed/model'],
        allowedModels: ['allowed/model', 'also-allowed/model']
      }
    }
  }, null, 2));
  await withTempHome(tempDir, async () => {
    const { routeRequest } = await importFresh(distPath('request-router.js'));
    const decision = routeRequest();
    // Primary model always kept even if not in allowlist
    assert.equal(decision.model, 'primary/model');
    // Fallbacks filtered to only allowed models
    assert.deepEqual(decision.fallbacks, ['allowed/model', 'also-allowed/model']);
  });
});

test('routeRequest keeps all fallbacks when allowedModels is empty', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotclaw-router-'));
  const configDir = path.join(tempDir, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'runtime.json'), JSON.stringify({
    host: {
      routing: {
        model: 'primary/model',
        fallbacks: ['a/model', 'b/model'],
        allowedModels: []
      }
    }
  }, null, 2));
  await withTempHome(tempDir, async () => {
    const { routeRequest } = await importFresh(distPath('request-router.js'));
    const decision = routeRequest();
    assert.deepEqual(decision.fallbacks, ['a/model', 'b/model']);
  });
});
