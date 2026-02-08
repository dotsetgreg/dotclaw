import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractFunctionCallsForReplay,
  toReplayFunctionCallItems,
} from '../dist/openrouter-followup.js';

test('extractFunctionCallsForReplay keeps only replayable function calls from mixed output', () => {
  const response = {
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Draft response' }]
      },
      {
        type: 'reasoning',
        id: 'rs_1',
        content: [{ type: 'reasoning_summary', text: 'hidden reasoning' }]
      },
      {
        type: 'function_call',
        callId: 'call_write_1',
        name: 'Write',
        arguments: '{"path":"inbox/demo.txt","content":"hello"}'
      },
      {
        type: 'function_call',
        id: 'item_read_1',
        name: 'Read',
        arguments: { path: 'inbox/demo.txt' }
      },
      {
        type: 'function_call',
        name: 'MissingCallId',
        arguments: '{}'
      },
      {
        type: 'function_call',
        callId: 'call_missing_name',
        arguments: '{}'
      }
    ]
  };

  const calls = extractFunctionCallsForReplay(response);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].id, 'call_write_1');
  assert.equal(calls[0].name, 'Write');
  assert.deepEqual(calls[0].arguments, { path: 'inbox/demo.txt', content: 'hello' });
  assert.equal(calls[0].argumentsText, '{"path":"inbox/demo.txt","content":"hello"}');

  assert.equal(calls[1].id, 'item_read_1');
  assert.equal(calls[1].itemId, 'item_read_1');
  assert.equal(calls[1].name, 'Read');
  assert.deepEqual(calls[1].arguments, { path: 'inbox/demo.txt' });
});

test('toReplayFunctionCallItems emits canonical function_call payloads only', () => {
  const calls = [
    {
      id: 'call_bash_1',
      name: 'Bash',
      arguments: 'ls -la',
      argumentsText: 'ls -la'
    },
    {
      id: 'call_read_2',
      itemId: 'fc_item_2',
      name: 'Read',
      arguments: { path: 'inbox/demo.txt' },
      argumentsText: '{"path":"inbox/demo.txt"}'
    }
  ];

  const replay = toReplayFunctionCallItems(calls);
  assert.deepEqual(replay, [
    {
      type: 'function_call',
      id: 'call_bash_1',
      callId: 'call_bash_1',
      name: 'Bash',
      arguments: 'ls -la'
    },
    {
      type: 'function_call',
      id: 'fc_item_2',
      callId: 'call_read_2',
      name: 'Read',
      arguments: '{"path":"inbox/demo.txt"}'
    }
  ]);

  assert.equal(replay.every((item) => item.type === 'function_call'), true);
});
