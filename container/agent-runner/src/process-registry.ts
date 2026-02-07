/**
 * Process session registry — manages background processes with poll/write/kill.
 * Sessions live for the lifetime of the daemon container.
 */

import { spawn, type ChildProcess } from 'child_process';
import { generateId } from './id.js';

export interface ProcessSession {
  id: string;
  command: string;
  pid: number;
  startedAt: number;
  cwd: string;
  stdout: string;
  tail: string;
  exited: boolean;
  exitCode: number | null;
  exitSignal: string | null;
  truncated: boolean;
}

interface InternalSession extends ProcessSession {
  process: ChildProcess;
  pollCursor: number;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
}

const sessions = new Map<string, InternalSession>();

const TAIL_LENGTH = 500;

export interface ProcessConfig {
  maxSessions: number;
  maxOutputBytes: number;
  defaultTimeoutMs: number;
}

const DEFAULT_CONFIG: ProcessConfig = {
  maxSessions: 16,
  maxOutputBytes: 1_048_576,
  defaultTimeoutMs: 1_800_000,
};

let config: ProcessConfig = { ...DEFAULT_CONFIG };

export function configureProcessRegistry(cfg: Partial<ProcessConfig>): void {
  config = { ...DEFAULT_CONFIG, ...cfg };
}

function updateTail(session: InternalSession): void {
  if (session.stdout.length <= TAIL_LENGTH) {
    session.tail = session.stdout;
  } else {
    session.tail = session.stdout.slice(-TAIL_LENGTH);
  }
}

export function startProcess(command: string, opts?: {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}): { sessionId: string; pid: number } {
  if (sessions.size >= config.maxSessions) {
    throw new Error(`Maximum sessions reached (${config.maxSessions}). Remove finished sessions first.`);
  }

  const id = generateId('proc');
  const cwd = opts?.cwd || '/workspace/group';
  const timeoutMs = opts?.timeoutMs || config.defaultTimeoutMs;
  const env = opts?.env ? { ...process.env, ...opts.env } : process.env;

  const child = spawn('/bin/bash', ['-lc', command], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  });

  const session: InternalSession = {
    id,
    command,
    pid: child.pid!,
    startedAt: Date.now(),
    cwd,
    stdout: '',
    tail: '',
    exited: false,
    exitCode: null,
    exitSignal: null,
    truncated: false,
    process: child,
    pollCursor: 0,
    timeoutTimer: null,
  };

  const append = (chunk: Buffer) => {
    if (session.truncated) return;
    const text = chunk.toString();
    const currentBytes = Buffer.byteLength(session.stdout, 'utf-8');
    const chunkBytes = Buffer.byteLength(text, 'utf-8');
    if (currentBytes + chunkBytes > config.maxOutputBytes) {
      const remaining = config.maxOutputBytes - currentBytes;
      if (remaining > 0) {
        session.stdout += text.slice(0, remaining);
      }
      session.truncated = true;
      session.stdout += '\n[OUTPUT TRUNCATED]';
      updateTail(session);
      return;
    }
    session.stdout += text;
    updateTail(session);
  };

  child.stdout?.on('data', append);
  child.stderr?.on('data', append);

  child.on('close', (code, signal) => {
    session.exited = true;
    session.exitCode = code;
    session.exitSignal = signal;
    if (session.timeoutTimer) {
      clearTimeout(session.timeoutTimer);
      session.timeoutTimer = null;
    }
  });

  child.on('error', (err) => {
    session.exited = true;
    session.exitCode = 1;
    session.stdout += `\n[PROCESS ERROR: ${err.message}]`;
    updateTail(session);
    if (session.timeoutTimer) {
      clearTimeout(session.timeoutTimer);
      session.timeoutTimer = null;
    }
  });

  // Auto-kill on timeout
  if (timeoutMs > 0) {
    session.timeoutTimer = setTimeout(() => {
      if (!session.exited) {
        try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch {
          try { child.kill('SIGKILL'); } catch { /* already exited */ }
        }
        session.stdout += '\n[PROCESS TIMED OUT]';
        updateTail(session);
      }
    }, timeoutMs);
  }

  sessions.set(id, session);
  return { sessionId: id, pid: child.pid! };
}

export function listSessions(): Array<{
  id: string;
  command: string;
  pid: number;
  runtimeMs: number;
  exited: boolean;
  exitCode: number | null;
  tail: string;
}> {
  const now = Date.now();
  return Array.from(sessions.values()).map(s => ({
    id: s.id,
    command: s.command.slice(0, 200),
    pid: s.pid,
    runtimeMs: s.exited ? 0 : now - s.startedAt,
    exited: s.exited,
    exitCode: s.exitCode,
    tail: s.tail,
  }));
}

export function getSession(id: string): ProcessSession | null {
  const s = sessions.get(id);
  if (!s) return null;
  return toPublic(s);
}

export function pollSession(id: string): { newOutput: string; exited: boolean; exitCode: number | null } {
  const s = sessions.get(id);
  if (!s) throw new Error(`Session not found: ${id}`);
  const newOutput = s.stdout.slice(s.pollCursor);
  s.pollCursor = s.stdout.length;
  return { newOutput, exited: s.exited, exitCode: s.exitCode };
}

export function getLog(id: string, offset?: number, limit?: number): { output: string; totalChars: number; truncated: boolean } {
  const s = sessions.get(id);
  if (!s) throw new Error(`Session not found: ${id}`);
  const start = offset || 0;
  const end = limit ? start + limit : undefined;
  return {
    output: s.stdout.slice(start, end),
    totalChars: s.stdout.length,
    truncated: s.truncated,
  };
}

export function writeToSession(id: string, data: string): void {
  const s = sessions.get(id);
  if (!s) throw new Error(`Session not found: ${id}`);
  if (s.exited) throw new Error(`Session has exited: ${id}`);
  if (!s.process.stdin?.writable) throw new Error(`Session stdin not writable: ${id}`);
  s.process.stdin.write(data);
}

export function killSession(id: string, signal?: string): void {
  const s = sessions.get(id);
  if (!s) throw new Error(`Session not found: ${id}`);
  if (s.exited) return;
  const sig = (signal || 'SIGTERM') as NodeJS.Signals;
  try {
    if (s.pid) process.kill(-s.pid, sig);
  } catch {
    try { s.process.kill(sig); } catch { /* already exited */ }
  }
}

export function removeSession(id: string): void {
  const s = sessions.get(id);
  if (!s) throw new Error(`Session not found: ${id}`);
  if (!s.exited) {
    killSession(id, 'SIGKILL');
  }
  if (s.timeoutTimer) {
    clearTimeout(s.timeoutTimer);
  }
  sessions.delete(id);
}

function toPublic(s: InternalSession): ProcessSession {
  return {
    id: s.id,
    command: s.command,
    pid: s.pid,
    startedAt: s.startedAt,
    cwd: s.cwd,
    stdout: s.stdout,
    tail: s.tail,
    exited: s.exited,
    exitCode: s.exitCode,
    exitSignal: s.exitSignal,
    truncated: s.truncated,
  };
}

/** Clean up all sessions — called on daemon shutdown */
export function cleanupAllSessions(): void {
  for (const [id] of sessions) {
    try { removeSession(id); } catch { /* ignore */ }
  }
}
