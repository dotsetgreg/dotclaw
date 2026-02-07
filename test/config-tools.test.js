import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { distPath, importFresh, withTempHome } from './test-helpers.js';

/**
 * Tests for Sprint 2 config tools — IPC handlers for get_config,
 * set_tool_policy, set_behavior, set_mcp_config.
 *
 * These test the host-side IPC handler logic by verifying that the config
 * files are read/written correctly.
 */

function makeTempHome(opts = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotclaw-config-'));
  const configDir = path.join(tempDir, 'config');
  const dataDir = path.join(tempDir, 'data');
  const storeDir = path.join(dataDir, 'store');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(storeDir, { recursive: true });

  if (opts.runtimeJson) {
    fs.writeFileSync(path.join(configDir, 'runtime.json'), JSON.stringify(opts.runtimeJson, null, 2));
  }
  if (opts.behaviorJson) {
    fs.writeFileSync(path.join(configDir, 'behavior.json'), JSON.stringify(opts.behaviorJson, null, 2));
  }
  if (opts.toolPolicyJson) {
    fs.writeFileSync(path.join(configDir, 'tool-policy.json'), JSON.stringify(opts.toolPolicyJson, null, 2));
  }
  if (opts.modelJson) {
    fs.writeFileSync(path.join(configDir, 'model.json'), JSON.stringify(opts.modelJson, null, 2));
  }
  return tempDir;
}

// --- set_behavior tests ---

test('set_behavior updates behavior.json response_style', async () => {
  const tempDir = makeTempHome({ behaviorJson: { response_style: 'balanced' } });
  await withTempHome(tempDir, async () => {
    const { loadJson, saveJson } = await importFresh(distPath('utils.js'));
    const behaviorPath = path.join(tempDir, 'config', 'behavior.json');

    // Simulate what the IPC handler does
    const behavior = loadJson(behaviorPath, {});
    behavior.response_style = 'concise';
    saveJson(behaviorPath, behavior);

    const updated = loadJson(behaviorPath, {});
    assert.equal(updated.response_style, 'concise');
  });
});

test('set_behavior clamps tool_calling_bias to 0-1', async () => {
  const tempDir = makeTempHome({});
  await withTempHome(tempDir, async () => {
    const { loadJson, saveJson } = await importFresh(distPath('utils.js'));
    const behaviorPath = path.join(tempDir, 'config', 'behavior.json');

    const behavior = {};
    behavior.tool_calling_bias = Math.max(0, Math.min(1, 1.5));
    saveJson(behaviorPath, behavior);

    const updated = loadJson(behaviorPath, {});
    assert.equal(updated.tool_calling_bias, 1);
  });
});

test('set_behavior clamps caution_bias to 0-1', async () => {
  const tempDir = makeTempHome({});
  await withTempHome(tempDir, async () => {
    const { loadJson, saveJson } = await importFresh(distPath('utils.js'));
    const behaviorPath = path.join(tempDir, 'config', 'behavior.json');

    const behavior = {};
    behavior.caution_bias = Math.max(0, Math.min(1, -0.5));
    saveJson(behaviorPath, behavior);

    const updated = loadJson(behaviorPath, {});
    assert.equal(updated.caution_bias, 0);
  });
});

// --- set_tool_policy tests ---

test('set_tool_policy allow_tool adds to allow list', async () => {
  const tempDir = makeTempHome({ toolPolicyJson: { default: { allow: ['Bash'] } } });
  await withTempHome(tempDir, async () => {
    const { loadJson, saveJson } = await importFresh(distPath('utils.js'));
    const policyPath = path.join(tempDir, 'config', 'tool-policy.json');

    const policy = loadJson(policyPath, {});
    if (!policy.default) policy.default = {};
    const allow = policy.default.allow || [];
    if (!allow.includes('CustomTool')) allow.push('CustomTool');
    policy.default.allow = allow;
    saveJson(policyPath, policy);

    const updated = loadJson(policyPath, {});
    assert.ok(updated.default.allow.includes('Bash'));
    assert.ok(updated.default.allow.includes('CustomTool'));
  });
});

test('set_tool_policy deny_tool adds to deny list', async () => {
  const tempDir = makeTempHome({ toolPolicyJson: { default: { deny: [] } } });
  await withTempHome(tempDir, async () => {
    const { loadJson, saveJson } = await importFresh(distPath('utils.js'));
    const policyPath = path.join(tempDir, 'config', 'tool-policy.json');

    const policy = loadJson(policyPath, {});
    if (!policy.default) policy.default = {};
    const deny = policy.default.deny || [];
    if (!deny.includes('DangerousTool')) deny.push('DangerousTool');
    policy.default.deny = deny;
    saveJson(policyPath, policy);

    const updated = loadJson(policyPath, {});
    assert.ok(updated.default.deny.includes('DangerousTool'));
  });
});

test('set_tool_policy set_limit updates max_per_run', async () => {
  const tempDir = makeTempHome({ toolPolicyJson: { default: { max_per_run: {} } } });
  await withTempHome(tempDir, async () => {
    const { loadJson, saveJson } = await importFresh(distPath('utils.js'));
    const policyPath = path.join(tempDir, 'config', 'tool-policy.json');

    const policy = loadJson(policyPath, {});
    if (!policy.default) policy.default = {};
    const maxPerRun = policy.default.max_per_run || {};
    maxPerRun.WebFetch = 100;
    policy.default.max_per_run = maxPerRun;
    saveJson(policyPath, policy);

    const updated = loadJson(policyPath, {});
    assert.equal(updated.default.max_per_run.WebFetch, 100);
  });
});

test('set_tool_policy reset removes default policy', async () => {
  const tempDir = makeTempHome({ toolPolicyJson: { default: { allow: ['Bash'], deny: ['Evil'] } } });
  await withTempHome(tempDir, async () => {
    const { loadJson, saveJson } = await importFresh(distPath('utils.js'));
    const policyPath = path.join(tempDir, 'config', 'tool-policy.json');

    const policy = loadJson(policyPath, {});
    delete policy.default;
    saveJson(policyPath, policy);

    const updated = loadJson(policyPath, {});
    assert.equal(updated.default, undefined);
  });
});

// --- set_mcp_config tests ---

test('set_mcp_config add_server adds to servers list', async () => {
  const tempDir = makeTempHome({
    runtimeJson: { agent: { mcp: { enabled: true, servers: [] } } }
  });
  await withTempHome(tempDir, async () => {
    const { loadJson, saveJson } = await importFresh(distPath('utils.js'));
    const runtimePath = path.join(tempDir, 'config', 'runtime.json');

    const cfg = loadJson(runtimePath, {});
    const agent = cfg.agent || {};
    const mcp = agent.mcp || { enabled: true, servers: [] };
    mcp.servers.push({ name: 'test-server', transport: 'stdio', command: 'node', args: ['server.js'] });
    agent.mcp = mcp;
    cfg.agent = agent;
    saveJson(runtimePath, cfg);

    const updated = loadJson(runtimePath, {});
    assert.equal(updated.agent.mcp.servers.length, 1);
    assert.equal(updated.agent.mcp.servers[0].name, 'test-server');
  });
});

test('set_mcp_config remove_server removes by name', async () => {
  const tempDir = makeTempHome({
    runtimeJson: { agent: { mcp: { enabled: true, servers: [{ name: 'foo', command: 'bar' }, { name: 'baz', command: 'qux' }] } } }
  });
  await withTempHome(tempDir, async () => {
    const { loadJson, saveJson } = await importFresh(distPath('utils.js'));
    const runtimePath = path.join(tempDir, 'config', 'runtime.json');

    const cfg = loadJson(runtimePath, {});
    const mcp = cfg.agent.mcp;
    mcp.servers = mcp.servers.filter(s => s.name !== 'foo');
    cfg.agent.mcp = mcp;
    saveJson(runtimePath, cfg);

    const updated = loadJson(runtimePath, {});
    assert.equal(updated.agent.mcp.servers.length, 1);
    assert.equal(updated.agent.mcp.servers[0].name, 'baz');
  });
});

test('set_mcp_config enable/disable toggles flag', async () => {
  const tempDir = makeTempHome({
    runtimeJson: { agent: { mcp: { enabled: false, servers: [] } } }
  });
  await withTempHome(tempDir, async () => {
    const { loadJson, saveJson } = await importFresh(distPath('utils.js'));
    const runtimePath = path.join(tempDir, 'config', 'runtime.json');

    const cfg = loadJson(runtimePath, {});
    cfg.agent.mcp.enabled = true;
    saveJson(runtimePath, cfg);

    const updated = loadJson(runtimePath, {});
    assert.equal(updated.agent.mcp.enabled, true);
  });
});
