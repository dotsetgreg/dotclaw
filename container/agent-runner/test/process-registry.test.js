import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';

import {
  configureProcessRegistry,
  startProcess,
  listSessions,
  getSession,
  pollSession,
  getLog,
  writeToSession,
  killSession,
  removeSession,
  cleanupAllSessions,
} from '../dist/process-registry.js';

const CWD = os.tmpdir();

// Use small limits for testing
configureProcessRegistry({
  maxSessions: 16,
  maxOutputBytes: 1024,
  defaultTimeoutMs: 10_000,
});

function waitForExit(sessionId, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const s = getSession(sessionId);
      if (!s) return reject(new Error('Session vanished'));
      if (s.exited) return resolve(s);
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for exit'));
      setTimeout(check, 50);
    };
    check();
  });
}

// Clean up leaked sessions before each test
beforeEach(() => {
  cleanupAllSessions();
});

test('startProcess and pollSession lifecycle', async () => {
  const { sessionId, pid } = startProcess('echo hello', { cwd: CWD });
  assert.ok(sessionId.startsWith('proc'));
  assert.equal(typeof pid, 'number');

  await waitForExit(sessionId);

  const result = pollSession(sessionId);
  assert.ok(result.newOutput.includes('hello'));
  assert.equal(result.exited, true);
  assert.equal(result.exitCode, 0);

  removeSession(sessionId);
});

test('getSession returns null for unknown id', () => {
  assert.equal(getSession('proc-nonexistent'), null);
});

test('pollSession throws for unknown session', () => {
  assert.throws(() => pollSession('proc-nonexistent'), /Session not found/);
});

test('getLog returns full output with offset and limit', async () => {
  const { sessionId } = startProcess('echo -n ABCDEFGHIJ', { cwd: CWD });
  await waitForExit(sessionId);

  const full = getLog(sessionId);
  assert.ok(full.output.includes('ABCDEFGHIJ'));
  assert.equal(full.truncated, false);

  // Find where ABCDEFGHIJ starts and test offset/limit from there
  const idx = full.output.indexOf('ABCDEFGHIJ');
  const partial = getLog(sessionId, idx + 3, 4);
  assert.equal(partial.output, 'DEFG');

  removeSession(sessionId);
});

test('listSessions includes running sessions', async () => {
  const { sessionId } = startProcess('sleep 30', { cwd: CWD });
  const list = listSessions();
  assert.ok(list.some(s => s.id === sessionId));
  const entry = list.find(s => s.id === sessionId);
  assert.equal(entry.exited, false);

  killSession(sessionId);
  await waitForExit(sessionId);
  removeSession(sessionId);
});

test('killSession terminates a running process', async () => {
  const { sessionId } = startProcess('sleep 30', { cwd: CWD });

  let s = getSession(sessionId);
  assert.equal(s.exited, false);

  killSession(sessionId, 'SIGTERM');
  await waitForExit(sessionId);

  s = getSession(sessionId);
  assert.equal(s.exited, true);

  removeSession(sessionId);
});

test('removeSession kills process if still running', () => {
  const { sessionId } = startProcess('sleep 30', { cwd: CWD });
  removeSession(sessionId);
  assert.equal(getSession(sessionId), null);
});

test('writeToSession sends data to stdin', async () => {
  // head -1 reads one line then exits, avoiding race with kill
  const { sessionId } = startProcess('head -1', { cwd: CWD });

  // Small delay for process to start
  await new Promise(r => setTimeout(r, 100));

  writeToSession(sessionId, 'test-input\n');
  await waitForExit(sessionId);

  const log = getLog(sessionId);
  assert.ok(log.output.includes('test-input'));

  removeSession(sessionId);
});

test('writeToSession throws for exited process', async () => {
  const { sessionId } = startProcess('echo done', { cwd: CWD });
  await waitForExit(sessionId);

  assert.throws(() => writeToSession(sessionId, 'x'), /Session has exited/);
  removeSession(sessionId);
});

test('maxSessions enforced', () => {
  configureProcessRegistry({ maxSessions: 2, maxOutputBytes: 1024, defaultTimeoutMs: 10_000 });
  const ids = [];
  ids.push(startProcess('sleep 30', { cwd: CWD }).sessionId);
  ids.push(startProcess('sleep 30', { cwd: CWD }).sessionId);

  assert.throws(() => startProcess('sleep 30', { cwd: CWD }), /Maximum sessions reached/);

  for (const id of ids) {
    removeSession(id);
  }
  // Restore
  configureProcessRegistry({ maxSessions: 16, maxOutputBytes: 1024, defaultTimeoutMs: 10_000 });
});

test('output truncation at maxOutputBytes', async () => {
  configureProcessRegistry({ maxSessions: 16, maxOutputBytes: 256, defaultTimeoutMs: 10_000 });
  const { sessionId } = startProcess('python3 -c "print(\'X\' * 2000)"', { cwd: CWD });
  await waitForExit(sessionId);

  const s = getSession(sessionId);
  assert.equal(s.truncated, true);
  assert.ok(s.stdout.includes('[OUTPUT TRUNCATED]'));

  removeSession(sessionId);
  configureProcessRegistry({ maxSessions: 16, maxOutputBytes: 1024, defaultTimeoutMs: 10_000 });
});

test('pollSession tracks cursor position', async () => {
  const { sessionId } = startProcess('echo first && sleep 0.1 && echo second', { cwd: CWD });
  await waitForExit(sessionId);

  const poll1 = pollSession(sessionId);
  assert.ok(poll1.newOutput.includes('first'));
  assert.ok(poll1.newOutput.includes('second'));

  // Second poll should return empty since cursor advanced
  const poll2 = pollSession(sessionId);
  assert.equal(poll2.newOutput, '');
  assert.equal(poll2.exited, true);

  removeSession(sessionId);
});

test('cleanupAllSessions removes everything', () => {
  startProcess('sleep 30', { cwd: CWD });
  startProcess('sleep 30', { cwd: CWD });
  assert.ok(listSessions().length >= 2);

  cleanupAllSessions();
  assert.equal(listSessions().length, 0);
});

test('getLog throws for unknown session', () => {
  assert.throws(() => getLog('proc-nonexistent'), /Session not found/);
});

test('killSession throws for unknown session', () => {
  assert.throws(() => killSession('proc-nonexistent'), /Session not found/);
});

test('removeSession throws for unknown session', () => {
  assert.throws(() => removeSession('proc-nonexistent'), /Session not found/);
});

test('tail field shows last portion of output', async () => {
  // Generate output longer than TAIL_LENGTH (500)
  const { sessionId } = startProcess('python3 -c "print(\'A\' * 600)"', { cwd: CWD });
  await waitForExit(sessionId);

  const s = getSession(sessionId);
  assert.ok(s.tail.length <= 500);
  assert.ok(s.stdout.length > s.tail.length);

  removeSession(sessionId);
});

test('stderr is captured in stdout', async () => {
  const { sessionId } = startProcess('echo err-msg >&2', { cwd: CWD });
  await waitForExit(sessionId);

  const log = getLog(sessionId);
  assert.ok(log.output.includes('err-msg'));

  removeSession(sessionId);
});
