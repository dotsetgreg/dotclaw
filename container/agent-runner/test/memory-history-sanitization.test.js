import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createSessionContext,
  loadHistory,
  saveSessionMeta,
} from '../dist/memory.js';

test('loadHistory sanitizes malformed legacy entries and rewrites poisoned history', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dotclaw-memory-history-'));
  try {
    const { ctx } = createSessionContext(tempRoot, 'session-poisoned');
    const poisoned = [
      JSON.stringify({ role: 'user', content: 'hello', timestamp: '2026-02-08T00:00:00.000Z', seq: 1 }),
      '{bad-json-line',
      JSON.stringify({
        role: 'assistant',
        content: [
          { type: 'output_text', text: 'legacy output' },
          { type: 'refusal', refusal: 'legacy refusal' }
        ],
        timestamp: '2026-02-08T00:00:01.000Z',
        seq: 2
      }),
      JSON.stringify({ role: 'tool', content: 'skip invalid role', timestamp: '2026-02-08T00:00:02.000Z', seq: 3 }),
      JSON.stringify({
        role: 'assistant',
        content: { output: 'object payload' },
        timestamp: '2026-02-08T00:00:03.000Z',
        seq: 4
      })
    ].join('\n');
    fs.writeFileSync(ctx.historyPath, `${poisoned}\n`);
    ctx.meta.nextSeq = 1;
    saveSessionMeta(ctx);

    const history = loadHistory(ctx);
    assert.equal(history.length, 3);
    assert.deepEqual(history.map((entry) => entry.role), ['user', 'assistant', 'assistant']);
    assert.deepEqual(history.map((entry) => entry.content), [
      'hello',
      'legacy output\nlegacy refusal',
      'object payload'
    ]);
    assert.equal(history.every((entry) => typeof entry.content === 'string'), true);
    assert.equal(ctx.meta.nextSeq, 5);

    const rewritten = fs.readFileSync(ctx.historyPath, 'utf-8').trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(rewritten.length, 3);
    assert.equal(rewritten.every((entry) => typeof entry.content === 'string'), true);
    assert.equal(rewritten.every((entry) => entry.role === 'user' || entry.role === 'assistant'), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
