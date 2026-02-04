import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTraceBase } from '../dist/agent-execution.js';

test('createTraceBase returns expected fields', () => {
  const trace = createTraceBase({
    chatId: 'chat-1',
    groupFolder: 'main',
    userId: 'user-1',
    inputText: 'hello',
    source: 'dotclaw'
  });

  assert.ok(trace.trace_id);
  assert.ok(trace.timestamp);
  assert.equal(trace.chat_id, 'chat-1');
  assert.equal(trace.group_folder, 'main');
  assert.equal(trace.user_id, 'user-1');
  assert.equal(trace.input_text, 'hello');
  assert.equal(trace.source, 'dotclaw');
});
