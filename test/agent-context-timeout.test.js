import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { distPath, importFresh, withTempHome } from './test-helpers.js';

test('buildAgentContext times out stalled memory recall and continues without recall', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotclaw-agent-context-timeout-'));
  const configDir = path.join(tempDir, 'config');
  fs.mkdirSync(configDir, { recursive: true });

  fs.writeFileSync(path.join(configDir, 'runtime.json'), JSON.stringify({
    host: {
      memory: {
        recall: {
          timeoutMs: 50
        },
        backend: {
          strategy: 'module',
          modulePath: 'stalled-memory-backend.mjs'
        }
      }
    }
  }, null, 2));

  fs.writeFileSync(path.join(tempDir, 'stalled-memory-backend.mjs'), `
export default {
  async buildRecall() { return await new Promise(() => {}); },
  buildUserProfile() { return null; },
  getStats() { return { total: 0, user: 0, group: 0, global: 0 }; }
};
`);

  const originalApiKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;

  try {
    await withTempHome(tempDir, async () => {
      const { resetMemoryBackendCacheForTests } = await importFresh(distPath('memory-backend.js'));
      resetMemoryBackendCacheForTests();
      const { buildAgentContext } = await importFresh(distPath('agent-context.js'));

      const startedAt = Date.now();
      const context = await buildAgentContext({
        groupFolder: 'main',
        userId: 'u-1',
        recallQuery: 'remember my preference from our last chat',
        recallMaxResults: 8,
        recallMaxTokens: 1000,
        recallEnabled: true,
        messageText: 'remember my preference from our last chat'
      });
      const elapsed = Date.now() - startedAt;

      assert.deepEqual(context.memoryRecall, []);
      assert.equal(context.memoryRecallAttempted, true);
      assert.ok((context.timings.memory_recall_ms || 0) >= 40, 'memory recall timing should reflect timeout path');
      assert.ok(elapsed < 1200, `context build should fail-open quickly, elapsed=${elapsed}ms`);
    });
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalApiKey;
    }
  }
});
