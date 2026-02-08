import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  coerceInputContentToText,
  injectImagesIntoContextInput,
  loadImageAttachmentsForInput,
  messagesToOpenRouterInput,
  sanitizeConversationInputForResponses,
} from '../dist/openrouter-input.js';

function makeTempImage(name, contents = 'image-binary-data') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotclaw-openrouter-input-'));
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, contents);
  return {
    path: filePath,
    cleanup() {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  };
}

test('messagesToOpenRouterInput coerces malformed structured content to text', () => {
  const input = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'first line' },
        { type: 'input_text', text: 'second line' }
      ]
    },
    {
      role: 'assistant',
      content: { output: 'tool output summary' }
    }
  ];

  const result = messagesToOpenRouterInput(input);
  assert.equal(result[0].content, 'first line\nsecond line');
  assert.equal(result[1].content, 'tool output summary');
});

test('loadImageAttachmentsForInput converts Telegram-style photo attachments', () => {
  const image = makeTempImage('telegram.jpg');
  try {
    const parts = loadImageAttachmentsForInput([
      {
        type: 'photo',
        path: image.path,
        file_name: 'telegram.jpg',
        mime_type: 'image/jpeg'
      }
    ]);

    assert.equal(parts.length, 1);
    assert.equal(parts[0].type, 'input_image');
    assert.equal(parts[0].detail, 'auto');
    assert.match(parts[0].imageUrl, /^data:image\/jpeg;base64,/);
  } finally {
    image.cleanup();
  }
});

test('loadImageAttachmentsForInput handles Discord-style photo with missing mime via extension fallback', () => {
  const image = makeTempImage('discord.png');
  try {
    const parts = loadImageAttachmentsForInput([
      {
        type: 'photo',
        path: image.path,
        file_name: 'discord.png'
      }
    ]);

    assert.equal(parts.length, 1);
    assert.equal(parts[0].type, 'input_image');
    assert.match(parts[0].imageUrl, /^data:image\/png;base64,/);
  } finally {
    image.cleanup();
  }
});

test('injectImagesIntoContextInput uses input_text + input_image schema for last user message', () => {
  const contextInput = [
    { role: 'assistant', content: 'previous reply' },
    { role: 'user', content: 'latest prompt' }
  ];

  injectImagesIntoContextInput(contextInput, [
    {
      type: 'input_image',
      detail: 'auto',
      imageUrl: 'data:image/jpeg;base64,abc123'
    }
  ]);

  assert.ok(Array.isArray(contextInput[1].content));
  const parts = contextInput[1].content;
  assert.equal(parts[0].type, 'input_text');
  assert.equal(parts[0].text, 'latest prompt');
  assert.equal(parts[1].type, 'input_image');
  assert.equal(parts[1].detail, 'auto');
  assert.equal(parts[1].imageUrl, 'data:image/jpeg;base64,abc123');
});

test('coerceInputContentToText preserves useful text from mixed array payloads', () => {
  const text = coerceInputContentToText([
    { type: 'output_text', text: 'answer text' },
    { type: 'refusal', refusal: 'cannot do that' },
    { text: 'plain text fallback' }
  ]);
  assert.equal(text, 'answer text\ncannot do that\nplain text fallback');
});

test('loadImageAttachmentsForInput ignores non-photo media types safely', () => {
  const parts = loadImageAttachmentsForInput([
    { type: 'video', path: '/tmp/video.mp4', mime_type: 'video/mp4' },
    { type: 'audio', path: '/tmp/audio.mp3', mime_type: 'audio/mpeg' },
    { type: 'document', path: '/tmp/doc.pdf', mime_type: 'application/pdf' },
    { type: 'voice', path: '/tmp/voice.ogg', mime_type: 'audio/ogg' }
  ]);
  assert.deepEqual(parts, []);
});

test('sanitizeConversationInputForResponses normalizes nested multimodal content and tool items', () => {
  const rawInput = [
    {
      role: 'user',
      content: [
        [{ type: 'text', text: 'please inspect this image' }],
        [{ type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } }]
      ]
    },
    {
      role: 'assistant',
      content: [
        [{ type: 'output_text', text: 'legacy assistant output' }],
        [{ type: 'refusal', refusal: 'legacy refusal text' }]
      ]
    },
    {
      type: 'function_call',
      id: 'call-1',
      name: 'Read',
      arguments: { path: 'README.md' }
    },
    {
      type: 'function_call_output',
      callId: 'call-1',
      output: { ok: true }
    }
  ];

  const sanitized = sanitizeConversationInputForResponses(rawInput);

  assert.equal(sanitized.droppedCount, 0);
  assert.ok(sanitized.rewrittenCount >= 3);

  assert.equal(sanitized.items[0].role, 'user');
  assert.ok(Array.isArray(sanitized.items[0].content));
  assert.equal(sanitized.items[0].content[0].type, 'input_text');
  assert.equal(sanitized.items[0].content[1].type, 'input_image');
  assert.equal(sanitized.items[0].content[1].detail, 'auto');
  assert.equal(sanitized.items[0].content[1].imageUrl, 'data:image/png;base64,abc123');

  assert.equal(sanitized.items[1].role, 'assistant');
  assert.equal(
    sanitized.items[1].content,
    'legacy assistant output\nlegacy refusal text'
  );

  assert.equal(sanitized.items[2].type, 'function_call');
  assert.equal(sanitized.items[2].callId, 'call-1');
  assert.equal(sanitized.items[2].arguments, '{"path":"README.md"}');

  assert.equal(sanitized.items[3].type, 'function_call_output');
  assert.equal(sanitized.items[3].output, '{"ok":true}');
});
