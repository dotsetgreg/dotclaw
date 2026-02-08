import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';

import { projectRoot } from './test-helpers.js';

function makeTempDotclawHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dotclaw-preflight-'));
  fs.mkdirSync(path.join(home, 'data', 'store'), { recursive: true });
  fs.mkdirSync(path.join(home, 'traces'), { recursive: true });
  const dbPath = path.join(home, 'data', 'store', 'messages.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_jid TEXT NOT NULL,
      message_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      is_group INTEGER NOT NULL DEFAULT 0,
      chat_type TEXT NOT NULL DEFAULT 'private',
      message_thread_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      error TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0
    );
  `);
  return { home, db };
}

function appendTrace(home, timestamp, chatId, options = {}) {
  const day = timestamp.slice(0, 10);
  const traceFile = path.join(home, 'traces', `trace-${day}.jsonl`);
  const outputText = Object.prototype.hasOwnProperty.call(options, 'outputText')
    ? options.outputText
    : 'ok';
  const errorCode = Object.prototype.hasOwnProperty.call(options, 'errorCode')
    ? options.errorCode
    : undefined;
  const row = {
    trace_id: 'trace-test',
    timestamp,
    created_at: Date.parse(timestamp),
    chat_id: chatId,
    group_folder: 'main',
    input_text: 'hello',
    output_text: outputText,
    error_code: errorCode,
    model_id: 'test-model',
    source: 'dotclaw'
  };
  fs.appendFileSync(traceFile, `${JSON.stringify(row)}\n`);
}

function runPreflight(args) {
  return spawnSync(process.execPath, [path.join(projectRoot, 'scripts', 'preflight-prod-chat.js'), ...args], {
    encoding: 'utf-8'
  });
}

test('preflight-prod-chat passes when completed queue row and trace exist', () => {
  const { home, db } = makeTempDotclawHome();
  try {
    const chat = 'discord:1469421941294108713';
    const now = new Date();
    const startIso = new Date(now.getTime() - 2_000).toISOString();
    const createdAt = new Date(now.getTime() - 1_000).toISOString();
    db.prepare(`
      INSERT INTO message_queue (
        chat_jid, message_id, sender_id, sender_name, content, timestamp, status, created_at, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      chat,
      'm-1',
      'user-1',
      'Greg',
      'hello',
      createdAt,
      'completed',
      createdAt,
      createdAt,
      createdAt
    );
    appendTrace(home, createdAt, chat);

    const result = runPreflight([
      '--chat', chat,
      '--dotclaw-home', home,
      '--start-iso', startIso,
      '--timeout-sec', '2',
      '--poll-ms', '50',
      '--require-completed', '1'
    ]);

    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, /PASS: gate conditions satisfied/);
  } finally {
    db.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('preflight-prod-chat fails on stale processing row', () => {
  const { home, db } = makeTempDotclawHome();
  try {
    const chat = 'discord:1469421941294108713';
    const now = new Date();
    const startIso = new Date(now.getTime() - 20_000).toISOString();
    const stale = new Date(now.getTime() - 15_000).toISOString();

    db.prepare(`
      INSERT INTO message_queue (
        chat_jid, message_id, sender_id, sender_name, content, timestamp, status, created_at, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      chat,
      'm-stale',
      'user-1',
      'Greg',
      'hello',
      stale,
      'processing',
      stale,
      stale
    );

    const result = runPreflight([
      '--chat', chat,
      '--dotclaw-home', home,
      '--start-iso', startIso,
      '--timeout-sec', '2',
      '--poll-ms', '50',
      '--max-processing-age-sec', '1'
    ]);

    assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stderr, /stale processing/i);
  } finally {
    db.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('preflight-prod-chat fails on timeout when no completions arrive', () => {
  const { home, db } = makeTempDotclawHome();
  try {
    const chat = 'discord:1469421941294108713';
    const startIso = new Date().toISOString();

    const result = runPreflight([
      '--chat', chat,
      '--dotclaw-home', home,
      '--start-iso', startIso,
      '--timeout-sec', '1',
      '--poll-ms', '50',
      '--no-require-trace'
    ]);

    assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stderr, /timed out waiting for pass conditions/i);
  } finally {
    db.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('preflight-prod-chat fails when trace rows include model error', () => {
  const { home, db } = makeTempDotclawHome();
  try {
    const chat = 'discord:1469421941294108713';
    const now = new Date();
    const startIso = new Date(now.getTime() - 2_000).toISOString();
    const createdAt = new Date(now.getTime() - 1_000).toISOString();
    db.prepare(`
      INSERT INTO message_queue (
        chat_jid, message_id, sender_id, sender_name, content, timestamp, status, created_at, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      chat,
      'm-err',
      'user-1',
      'Greg',
      'hello',
      createdAt,
      'completed',
      createdAt,
      createdAt,
      createdAt
    );
    appendTrace(home, createdAt, chat, {
      outputText: null,
      errorCode: 'All models failed. Last error: Input validation failed'
    });

    const result = runPreflight([
      '--chat', chat,
      '--dotclaw-home', home,
      '--start-iso', startIso,
      '--timeout-sec', '2',
      '--poll-ms', '50',
      '--require-completed', '1'
    ]);

    assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stderr, /trace rows with error_code/i);
  } finally {
    db.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
