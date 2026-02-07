import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { distPath, importFresh, withTempHome } from './test-helpers.js';

/**
 * Helper: create a temp DOTCLAW_HOME with optional config files.
 */
function makeTempHome({ runtimeJson, modelJson } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotclaw-model-'));
  const configDir = path.join(tempDir, 'config');
  fs.mkdirSync(configDir, { recursive: true });

  if (runtimeJson) {
    fs.writeFileSync(path.join(configDir, 'runtime.json'), JSON.stringify(runtimeJson, null, 2));
  }
  if (modelJson) {
    fs.writeFileSync(path.join(configDir, 'model.json'), JSON.stringify(modelJson, null, 2));
  }
  return tempDir;
}

// ─── resolveModel cascade ────────────────────────────────────────────────

test('resolveModel falls back to defaultModel when model.json is absent', async () => {
  const tempDir = makeTempHome();
  await withTempHome(tempDir, async () => {
    const { resolveModel } = await importFresh(distPath('model-registry.js'));
    const result = resolveModel({ groupFolder: 'g1', defaultModel: 'fallback/model' });
    assert.equal(result.model, 'fallback/model');
  });
});

test('resolveModel uses model.json global model over defaultModel', async () => {
  const tempDir = makeTempHome({
    modelJson: { model: 'custom/global-model', allowlist: [] }
  });
  await withTempHome(tempDir, async () => {
    const { resolveModel } = await importFresh(distPath('model-registry.js'));
    const result = resolveModel({ groupFolder: 'g1', defaultModel: 'fallback/model' });
    assert.equal(result.model, 'custom/global-model');
  });
});

test('resolveModel per_group override takes priority over global', async () => {
  const tempDir = makeTempHome({
    modelJson: {
      model: 'custom/global-model',
      allowlist: [],
      per_group: { 'my-group': { model: 'group/override-model' } }
    }
  });
  await withTempHome(tempDir, async () => {
    const { resolveModel } = await importFresh(distPath('model-registry.js'));
    // Matching group gets override
    const result = resolveModel({ groupFolder: 'my-group', defaultModel: 'fallback/model' });
    assert.equal(result.model, 'group/override-model');
    // Non-matching group gets global
    const result2 = resolveModel({ groupFolder: 'other-group', defaultModel: 'fallback/model' });
    assert.equal(result2.model, 'custom/global-model');
  });
});

test('resolveModel per_user override takes priority over per_group', async () => {
  const tempDir = makeTempHome({
    modelJson: {
      model: 'custom/global-model',
      allowlist: [],
      per_group: { 'my-group': { model: 'group/override-model' } },
      per_user: { 'user123': { model: 'user/preferred-model' } }
    }
  });
  await withTempHome(tempDir, async () => {
    const { resolveModel } = await importFresh(distPath('model-registry.js'));
    // User override beats group and global
    const result = resolveModel({ groupFolder: 'my-group', userId: 'user123', defaultModel: 'fallback/model' });
    assert.equal(result.model, 'user/preferred-model');
    // Different user in same group gets group override
    const result2 = resolveModel({ groupFolder: 'my-group', userId: 'user456', defaultModel: 'fallback/model' });
    assert.equal(result2.model, 'group/override-model');
  });
});

test('resolveModel allowlist enforces permitted models', async () => {
  const tempDir = makeTempHome({
    modelJson: {
      model: 'safe/global-model',
      allowlist: ['safe/global-model', 'safe/alt-model'],
      per_user: { 'rogue': { model: 'expensive/forbidden-model' } }
    }
  });
  await withTempHome(tempDir, async () => {
    const { resolveModel } = await importFresh(distPath('model-registry.js'));
    // User override with a disallowed model gets reverted to global
    const result = resolveModel({ groupFolder: 'g1', userId: 'rogue', defaultModel: 'fallback/model' });
    assert.equal(result.model, 'safe/global-model');
    // Allowed user override works
    const tempDir2 = makeTempHome({
      modelJson: {
        model: 'safe/global-model',
        allowlist: ['safe/global-model', 'safe/alt-model'],
        per_user: { 'good-user': { model: 'safe/alt-model' } }
      }
    });
    await withTempHome(tempDir2, async () => {
      const { resolveModel: rm2 } = await importFresh(distPath('model-registry.js'));
      const result2 = rm2({ groupFolder: 'g1', userId: 'good-user', defaultModel: 'fallback/model' });
      assert.equal(result2.model, 'safe/alt-model');
    });
  });
});

test('resolveModel empty allowlist permits all models', async () => {
  const tempDir = makeTempHome({
    modelJson: {
      model: 'any/global-model',
      allowlist: [],
      per_user: { 'user1': { model: 'anything/goes' } }
    }
  });
  await withTempHome(tempDir, async () => {
    const { resolveModel } = await importFresh(distPath('model-registry.js'));
    const result = resolveModel({ groupFolder: 'g1', userId: 'user1', defaultModel: 'fallback/model' });
    assert.equal(result.model, 'anything/goes');
  });
});

// ─── saveModelRegistry + set_model simulation ────────────────────────────

test('saveModelRegistry persists and loadModelRegistry reads it back', async () => {
  const tempDir = makeTempHome();
  await withTempHome(tempDir, async () => {
    const { saveModelRegistry, loadModelRegistry } = await importFresh(distPath('model-registry.js'));
    saveModelRegistry({
      model: 'saved/model',
      allowlist: [],
      per_user: { 'u1': { model: 'user/model' } },
      updated_at: new Date().toISOString()
    });
    const config = loadModelRegistry('fallback/model');
    assert.equal(config.model, 'saved/model');
    assert.deepEqual(config.per_user, { 'u1': { model: 'user/model' } });
  });
});

test('set_model global scope updates model.json and resolveModel reflects it', async () => {
  const tempDir = makeTempHome({
    modelJson: { model: 'old/model', allowlist: [] }
  });
  await withTempHome(tempDir, async () => {
    const { saveModelRegistry, loadModelRegistry, resolveModel } = await importFresh(distPath('model-registry.js'));

    // Simulate set_model IPC (global scope)
    const config = loadModelRegistry('fallback');
    config.model = 'new/global-model';
    config.updated_at = new Date().toISOString();
    saveModelRegistry(config);

    // Verify resolveModel picks up the change
    const result = resolveModel({ groupFolder: 'g1', defaultModel: 'fallback' });
    assert.equal(result.model, 'new/global-model');
  });
});

test('set_model user scope updates per_user and resolveModel reflects it', async () => {
  const tempDir = makeTempHome({
    modelJson: { model: 'base/model', allowlist: [] }
  });
  await withTempHome(tempDir, async () => {
    const { saveModelRegistry, loadModelRegistry, resolveModel } = await importFresh(distPath('model-registry.js'));

    // Simulate set_model IPC (user scope)
    const config = loadModelRegistry('fallback');
    config.per_user = config.per_user || {};
    config.per_user['telegram:12345'] = { model: 'openai/codex-5.2' };
    config.updated_at = new Date().toISOString();
    saveModelRegistry(config);

    // User gets their override
    const result = resolveModel({ groupFolder: 'g1', userId: 'telegram:12345', defaultModel: 'fallback' });
    assert.equal(result.model, 'openai/codex-5.2');

    // Other users still get global
    const result2 = resolveModel({ groupFolder: 'g1', userId: 'telegram:99999', defaultModel: 'fallback' });
    assert.equal(result2.model, 'base/model');
  });
});

test('set_model group scope updates per_group and resolveModel reflects it', async () => {
  const tempDir = makeTempHome({
    modelJson: { model: 'base/model', allowlist: [] }
  });
  await withTempHome(tempDir, async () => {
    const { saveModelRegistry, loadModelRegistry, resolveModel } = await importFresh(distPath('model-registry.js'));

    // Simulate set_model IPC (group scope)
    const config = loadModelRegistry('fallback');
    config.per_group = config.per_group || {};
    config.per_group['dev-team'] = { model: 'anthropic/claude-sonnet-4-5' };
    config.updated_at = new Date().toISOString();
    saveModelRegistry(config);

    // Dev-team group gets override
    const result = resolveModel({ groupFolder: 'dev-team', defaultModel: 'fallback' });
    assert.equal(result.model, 'anthropic/claude-sonnet-4-5');

    // Other groups get global
    const result2 = resolveModel({ groupFolder: 'personal', defaultModel: 'fallback' });
    assert.equal(result2.model, 'base/model');
  });
});

// ─── Interaction with routing.model ──────────────────────────────────────

test('routing.model serves as base when model.json is absent', async () => {
  const tempDir = makeTempHome({
    runtimeJson: {
      host: {
        routing: { model: 'configured/routing-model' }
      }
    }
  });
  await withTempHome(tempDir, async () => {
    const { loadRuntimeConfig } = await importFresh(distPath('runtime-config.js'));
    const { resolveModel } = await importFresh(distPath('model-registry.js'));
    const runtime = loadRuntimeConfig();
    const defaultModel = runtime.host.routing.model || runtime.host.defaultModel;
    const result = resolveModel({ groupFolder: 'g1', defaultModel });
    assert.equal(result.model, 'configured/routing-model');
  });
});

test('model.json global overrides routing.model', async () => {
  const tempDir = makeTempHome({
    runtimeJson: {
      host: {
        routing: { model: 'configured/routing-model' }
      }
    },
    modelJson: { model: 'agent-set/model', allowlist: [] }
  });
  await withTempHome(tempDir, async () => {
    const { loadRuntimeConfig } = await importFresh(distPath('runtime-config.js'));
    const { resolveModel } = await importFresh(distPath('model-registry.js'));
    const runtime = loadRuntimeConfig();
    const defaultModel = runtime.host.routing.model || runtime.host.defaultModel;
    const result = resolveModel({ groupFolder: 'g1', defaultModel });
    assert.equal(result.model, 'agent-set/model');
  });
});

test('per_user override beats routing.model and model.json global', async () => {
  const tempDir = makeTempHome({
    runtimeJson: {
      host: {
        routing: { model: 'configured/routing-model' }
      }
    },
    modelJson: {
      model: 'agent-set/global',
      allowlist: [],
      per_user: { 'user42': { model: 'user42/preferred' } }
    }
  });
  await withTempHome(tempDir, async () => {
    const { loadRuntimeConfig } = await importFresh(distPath('runtime-config.js'));
    const { resolveModel } = await importFresh(distPath('model-registry.js'));
    const runtime = loadRuntimeConfig();
    const defaultModel = runtime.host.routing.model || runtime.host.defaultModel;
    const result = resolveModel({ groupFolder: 'g1', userId: 'user42', defaultModel });
    assert.equal(result.model, 'user42/preferred');
  });
});

// ─── matchRoutingRule ─────────────────────────────────────────────────────

test('matchRoutingRule returns null for empty/undefined rules', async () => {
  const tempDir = makeTempHome();
  await withTempHome(tempDir, async () => {
    const { matchRoutingRule } = await importFresh(distPath('model-registry.js'));
    assert.equal(matchRoutingRule(undefined, 'hello'), null);
    assert.equal(matchRoutingRule([], 'hello'), null);
  });
});

test('matchRoutingRule matches case-insensitively', async () => {
  const tempDir = makeTempHome();
  await withTempHome(tempDir, async () => {
    const { matchRoutingRule } = await importFresh(distPath('model-registry.js'));
    const rules = [{ task_type: 'code', model: 'openai/codex', keywords: ['debug', 'function'] }];
    const result = matchRoutingRule(rules, 'Can you DEBUG this?');
    assert.equal(result.task_type, 'code');
    assert.equal(result.model, 'openai/codex');
  });
});

test('matchRoutingRule respects priority ordering', async () => {
  const tempDir = makeTempHome();
  await withTempHome(tempDir, async () => {
    const { matchRoutingRule } = await importFresh(distPath('model-registry.js'));
    const rules = [
      { task_type: 'research', model: 'google/gemini', keywords: ['search'], priority: 1 },
      { task_type: 'code', model: 'openai/codex', keywords: ['search'], priority: 5 }
    ];
    // Both match "search" but code has higher priority
    const result = matchRoutingRule(rules, 'search for this');
    assert.equal(result.task_type, 'code');
  });
});

test('matchRoutingRule uses insertion order for equal priority', async () => {
  const tempDir = makeTempHome();
  await withTempHome(tempDir, async () => {
    const { matchRoutingRule } = await importFresh(distPath('model-registry.js'));
    const rules = [
      { task_type: 'first', model: 'model/a', keywords: ['hello'] },
      { task_type: 'second', model: 'model/b', keywords: ['hello'] }
    ];
    const result = matchRoutingRule(rules, 'hello world');
    assert.equal(result.task_type, 'first');
  });
});

test('matchRoutingRule matches multi-word phrases', async () => {
  const tempDir = makeTempHome();
  await withTempHome(tempDir, async () => {
    const { matchRoutingRule } = await importFresh(distPath('model-registry.js'));
    const rules = [{ task_type: 'code', model: 'openai/codex', keywords: ['fix bug', 'syntax error'] }];
    assert.notEqual(matchRoutingRule(rules, 'can you fix bug in login?'), null);
    assert.equal(matchRoutingRule(rules, 'fix the login'), null);
  });
});

test('matchRoutingRule skips empty keywords', async () => {
  const tempDir = makeTempHome();
  await withTempHome(tempDir, async () => {
    const { matchRoutingRule } = await importFresh(distPath('model-registry.js'));
    const rules = [{ task_type: 'code', model: 'openai/codex', keywords: ['', 'debug'] }];
    // Empty keyword should not match everything
    const result = matchRoutingRule(rules, 'something random');
    assert.equal(result, null);
    // "debug" still matches
    const result2 = matchRoutingRule(rules, 'debug this');
    assert.notEqual(result2, null);
  });
});

// ─── resolveModel with routing rules ──────────────────────────────────────

test('resolveModel applies user routing rules when messageText matches', async () => {
  const tempDir = makeTempHome({
    modelJson: {
      model: 'default/model',
      allowlist: [],
      per_user: {
        'user1': {
          model: 'user/base-model',
          routing_rules: [
            { task_type: 'code', model: 'openai/codex', keywords: ['debug', 'function'] }
          ]
        }
      }
    }
  });
  await withTempHome(tempDir, async () => {
    const { resolveModel } = await importFresh(distPath('model-registry.js'));
    const result = resolveModel({
      groupFolder: 'g1', userId: 'user1', defaultModel: 'fallback',
      messageText: 'Can you debug this function?'
    });
    assert.equal(result.model, 'openai/codex');
    assert.equal(result.matchedRule.task_type, 'code');
  });
});

test('resolveModel applies group routing rules when no user rules match', async () => {
  const tempDir = makeTempHome({
    modelJson: {
      model: 'default/model',
      allowlist: [],
      per_group: {
        'dev-team': {
          model: 'group/base',
          routing_rules: [
            { task_type: 'research', model: 'google/gemini', keywords: ['research', 'search'] }
          ]
        }
      }
    }
  });
  await withTempHome(tempDir, async () => {
    const { resolveModel } = await importFresh(distPath('model-registry.js'));
    const result = resolveModel({
      groupFolder: 'dev-team', defaultModel: 'fallback',
      messageText: 'research the latest news'
    });
    assert.equal(result.model, 'google/gemini');
  });
});

test('resolveModel user rules take precedence over group rules', async () => {
  const tempDir = makeTempHome({
    modelJson: {
      model: 'default/model',
      allowlist: [],
      per_group: {
        'g1': {
          model: 'group/base',
          routing_rules: [
            { task_type: 'code', model: 'group/code-model', keywords: ['code'] }
          ]
        }
      },
      per_user: {
        'user1': {
          model: 'user/base',
          routing_rules: [
            { task_type: 'code', model: 'user/code-model', keywords: ['code'] }
          ]
        }
      }
    }
  });
  await withTempHome(tempDir, async () => {
    const { resolveModel } = await importFresh(distPath('model-registry.js'));
    const result = resolveModel({
      groupFolder: 'g1', userId: 'user1', defaultModel: 'fallback',
      messageText: 'write some code'
    });
    assert.equal(result.model, 'user/code-model');
  });
});

test('resolveModel allowlist blocks routing rule model', async () => {
  const tempDir = makeTempHome({
    modelJson: {
      model: 'safe/default',
      allowlist: ['safe/default', 'safe/alt'],
      per_user: {
        'user1': {
          model: 'safe/default',
          routing_rules: [
            { task_type: 'code', model: 'forbidden/model', keywords: ['code'] }
          ]
        }
      }
    }
  });
  await withTempHome(tempDir, async () => {
    const { resolveModel } = await importFresh(distPath('model-registry.js'));
    const result = resolveModel({
      groupFolder: 'g1', userId: 'user1', defaultModel: 'fallback',
      messageText: 'write some code'
    });
    // Rule model blocked by allowlist — falls back to static model
    assert.equal(result.model, 'safe/default');
    assert.equal(result.matchedRule, undefined);
  });
});

test('resolveModel no keyword match falls back to static model', async () => {
  const tempDir = makeTempHome({
    modelJson: {
      model: 'default/model',
      allowlist: [],
      per_user: {
        'user1': {
          model: 'user/static',
          routing_rules: [
            { task_type: 'code', model: 'openai/codex', keywords: ['debug'] }
          ]
        }
      }
    }
  });
  await withTempHome(tempDir, async () => {
    const { resolveModel } = await importFresh(distPath('model-registry.js'));
    const result = resolveModel({
      groupFolder: 'g1', userId: 'user1', defaultModel: 'fallback',
      messageText: 'what is the weather today?'
    });
    assert.equal(result.model, 'user/static');
    assert.equal(result.matchedRule, undefined);
  });
});

test('resolveModel without messageText skips routing rules', async () => {
  const tempDir = makeTempHome({
    modelJson: {
      model: 'default/model',
      allowlist: [],
      per_user: {
        'user1': {
          model: 'user/static',
          routing_rules: [
            { task_type: 'code', model: 'openai/codex', keywords: ['debug'] }
          ]
        }
      }
    }
  });
  await withTempHome(tempDir, async () => {
    const { resolveModel } = await importFresh(distPath('model-registry.js'));
    // No messageText — rules skipped even though "debug" would match
    const result = resolveModel({
      groupFolder: 'g1', userId: 'user1', defaultModel: 'fallback'
    });
    assert.equal(result.model, 'user/static');
    assert.equal(result.matchedRule, undefined);
  });
});
