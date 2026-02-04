import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { distPath, importFresh, withTempHome } from './test-helpers.js';

test('applyToolBudgets denies tools that exceed daily limits', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotclaw-budgets-'));
  await withTempHome(tempDir, async () => {
    const configDir = path.join(tempDir, 'config');
    const dataDir = path.join(tempDir, 'data');
    const storeDir = path.join(dataDir, 'store');
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(storeDir, { recursive: true });
    const budgetsPath = path.join(configDir, 'tool-budgets.json');
    fs.writeFileSync(budgetsPath, JSON.stringify({
      default: {
        per_day: {
          WebFetch: 1
        }
      }
    }));

    fs.writeFileSync(path.join(configDir, 'runtime.json'), JSON.stringify({
      host: {
        toolBudgets: {
          enabled: true,
          path: budgetsPath
        }
      }
    }));

    const { initDatabase, logToolCalls } = await importFresh(distPath('db.js'));
    const { applyToolBudgets } = await importFresh(distPath('tool-budgets.js'));

    initDatabase();

    const basePolicy = { allow: ['WebFetch', 'WebSearch'], deny: [] };
    const before = applyToolBudgets({ groupFolder: 'main', userId: 'user-1', toolPolicy: basePolicy });
    assert.equal(before.deny?.length || 0, 0);

    logToolCalls({
      traceId: 'trace-1',
      chatJid: 'chat-1',
      groupFolder: 'main',
      userId: 'user-1',
      toolCalls: [{ name: 'WebFetch', ok: true }],
      source: 'test'
    });

    const after = applyToolBudgets({ groupFolder: 'main', userId: 'user-1', toolPolicy: basePolicy });
    assert.ok(after.deny?.includes('webfetch'));
  });
});
