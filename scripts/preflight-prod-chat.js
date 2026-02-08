#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import Database from 'better-sqlite3';

function usage() {
  console.log([
    'Usage:',
    '  node scripts/preflight-prod-chat.js --chat <chat_jid> [options]',
    '',
    'Options:',
    '  --chat <jid>                    Required (example: discord:1469421941294108713)',
    '  --dotclaw-home <path>           Defaults to DOTCLAW_HOME or ~/.dotclaw',
    '  --start-iso <iso8601>           Defaults to script start time',
    '  --timeout-sec <n>               Defaults to 180',
    '  --poll-ms <n>                   Defaults to 1000',
    '  --require-completed <n>         Defaults to 1',
    '  --max-processing-age-sec <n>    Defaults to 120',
    '  --allow-failed                  Don\'t fail on failed queue rows',
    '  --allow-error-traces            Don\'t fail when trace rows contain error_code',
    '  --no-require-success-trace      Don\'t require at least one successful trace row',
    '  --no-require-trace              Don\'t require at least one trace row',
    '  --help                          Show this help'
  ].join('\n'));
}

function parseArgs(argv) {
  const parsed = {
    chat: '',
    dotclawHome: process.env.DOTCLAW_HOME || path.join(os.homedir(), '.dotclaw'),
    startIso: new Date().toISOString(),
    timeoutSec: 180,
    pollMs: 1000,
    requireCompleted: 1,
    maxProcessingAgeSec: 120,
    allowFailed: false,
    allowErrorTraces: false,
    requireSuccessfulTrace: true,
    requireTrace: true
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg === '--allow-failed') {
      parsed.allowFailed = true;
      continue;
    }
    if (arg === '--allow-error-traces') {
      parsed.allowErrorTraces = true;
      continue;
    }
    if (arg === '--no-require-success-trace') {
      parsed.requireSuccessfulTrace = false;
      continue;
    }
    if (arg === '--no-require-trace') {
      parsed.requireTrace = false;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }
    if (arg === '--chat') parsed.chat = next;
    else if (arg === '--dotclaw-home') parsed.dotclawHome = next;
    else if (arg === '--start-iso') parsed.startIso = next;
    else if (arg === '--timeout-sec') parsed.timeoutSec = Number(next);
    else if (arg === '--poll-ms') parsed.pollMs = Number(next);
    else if (arg === '--require-completed') parsed.requireCompleted = Number(next);
    else if (arg === '--max-processing-age-sec') parsed.maxProcessingAgeSec = Number(next);
    else throw new Error(`Unknown argument: ${arg}`);
    i += 1;
  }

  return parsed;
}

function clampInt(value, fallback, min) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.floor(value));
}

function parseIsoOrNow(value) {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return new Date().toISOString();
  return new Date(ts).toISOString();
}

function listTraceFiles(traceDir, startIso) {
  if (!fs.existsSync(traceDir)) return [];
  const startDate = startIso.slice(0, 10);
  return fs.readdirSync(traceDir)
    .filter((name) => /^trace-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
    .filter((name) => {
      const datePart = name.slice(6, 16);
      return datePart >= startDate;
    })
    .sort()
    .map((name) => path.join(traceDir, name));
}

function summarizeTraceRows({ traceDir, chatJid, startIso }) {
  const startMs = Date.parse(startIso);
  const stats = {
    total: 0,
    success: 0,
    error: 0,
    latestError: ''
  };
  for (const filePath of listTraceFiles(traceDir, startIso)) {
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row?.chat_id !== chatJid) continue;
        const ts = Date.parse(String(row.timestamp || ''));
        if (!Number.isFinite(ts) || ts < startMs) continue;
        stats.total += 1;
        const errorCode = typeof row.error_code === 'string' ? row.error_code.trim() : '';
        if (errorCode) {
          stats.error += 1;
          stats.latestError = errorCode;
          continue;
        }
        if (typeof row.output_text === 'string' && row.output_text.trim()) {
          stats.success += 1;
        }
      } catch {
        // ignore malformed trace rows
      }
    }
  }
  return stats;
}

function getQueueRows(db, chatJid, startIso) {
  return db.prepare(`
    SELECT id, message_id, status, created_at, started_at, completed_at, error
    FROM message_queue
    WHERE chat_jid = ?
      AND created_at >= ?
    ORDER BY id DESC
    LIMIT 200
  `).all(chatJid, startIso);
}

function summarizeRows(rows, nowMs, maxProcessingAgeSec) {
  const counts = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0
  };
  const staleProcessing = [];
  for (const row of rows) {
    const status = String(row.status || '');
    if (status === 'pending' || status === 'processing' || status === 'completed' || status === 'failed') {
      counts[status] += 1;
    }
    if (status === 'processing') {
      const startedMs = Date.parse(String(row.started_at || row.created_at || ''));
      if (Number.isFinite(startedMs)) {
        const ageSec = (nowMs - startedMs) / 1000;
        if (ageSec > maxProcessingAgeSec) {
          staleProcessing.push({ id: row.id, ageSec, messageId: row.message_id });
        }
      }
    }
  }
  return { counts, staleProcessing };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Argument error: ${err instanceof Error ? err.message : String(err)}`);
    usage();
    process.exit(2);
  }

  if (args.help) {
    usage();
    process.exit(0);
  }

  if (!args.chat || !String(args.chat).trim()) {
    console.error('Missing required argument: --chat <chat_jid>');
    usage();
    process.exit(2);
  }

  const chatJid = String(args.chat).trim();
  const dotclawHome = path.resolve(String(args.dotclawHome || '.'));
  const startIso = parseIsoOrNow(String(args.startIso || ''));
  const timeoutSec = clampInt(args.timeoutSec, 180, 1);
  const pollMs = clampInt(args.pollMs, 1000, 50);
  const requireCompleted = clampInt(args.requireCompleted, 1, 1);
  const maxProcessingAgeSec = clampInt(args.maxProcessingAgeSec, 120, 1);
  const allowFailed = !!args.allowFailed;
  const allowErrorTraces = !!args.allowErrorTraces;
  const requireSuccessfulTrace = !!args.requireSuccessfulTrace;
  const requireTrace = !!args.requireTrace;

  const dbPath = path.join(dotclawHome, 'data', 'store', 'messages.db');
  const traceDir = path.join(dotclawHome, 'traces');
  if (!fs.existsSync(dbPath)) {
    console.error(`messages.db not found: ${dbPath}`);
    process.exit(2);
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const startedAt = Date.now();
  const deadline = startedAt + (timeoutSec * 1000);
  let lastSignature = '';

  console.log(`[preflight] chat=${chatJid}`);
  console.log(`[preflight] dotclawHome=${dotclawHome}`);
  console.log(`[preflight] startIso=${startIso}`);
  console.log(`[preflight] timeoutSec=${timeoutSec}, pollMs=${pollMs}, requireCompleted=${requireCompleted}, maxProcessingAgeSec=${maxProcessingAgeSec}, requireTrace=${requireTrace}, requireSuccessfulTrace=${requireSuccessfulTrace}, allowFailed=${allowFailed}, allowErrorTraces=${allowErrorTraces}`);

  try {
    while (Date.now() <= deadline) {
      const nowMs = Date.now();
      const rows = getQueueRows(db, chatJid, startIso);
      const { counts, staleProcessing } = summarizeRows(rows, nowMs, maxProcessingAgeSec);
      const traceStats = (requireTrace || !allowErrorTraces)
        ? summarizeTraceRows({ traceDir, chatJid, startIso })
        : { total: 0, success: 0, error: 0, latestError: '' };

      const signature = `${counts.pending}/${counts.processing}/${counts.completed}/${counts.failed}|stale:${staleProcessing.length}|trace:${traceStats.total}/${traceStats.success}/${traceStats.error}`;
      if (signature !== lastSignature) {
        const traceSummary = requireTrace
          ? ` traces(total/success/error)=${traceStats.total}/${traceStats.success}/${traceStats.error}`
          : '';
        console.log(`[preflight] queue pending=${counts.pending} processing=${counts.processing} completed=${counts.completed} failed=${counts.failed} staleProcessing=${staleProcessing.length}${traceSummary}`);
        if (rows[0]) {
          const latest = rows[0];
          console.log(`[preflight] latest id=${latest.id} status=${latest.status} message_id=${latest.message_id || 'n/a'} error=${latest.error || 'none'}`);
        }
        lastSignature = signature;
      }

      if (!allowFailed && counts.failed > 0) {
        console.error('[preflight] FAIL: detected failed queue rows.');
        process.exit(1);
      }
      if (staleProcessing.length > 0) {
        console.error('[preflight] FAIL: detected stale processing rows.');
        for (const row of staleProcessing.slice(0, 5)) {
          console.error(`[preflight] stale id=${row.id} message_id=${row.messageId || 'n/a'} ageSec=${Math.floor(row.ageSec)}`);
        }
        process.exit(1);
      }

      if (!allowErrorTraces && traceStats.error > 0) {
        console.error('[preflight] FAIL: detected trace rows with error_code.');
        if (traceStats.latestError) {
          console.error(`[preflight] latest trace error: ${traceStats.latestError}`);
        }
        process.exit(1);
      }

      const completedEnough = counts.completed >= requireCompleted;
      const traceEnough = !requireTrace || traceStats.total > 0;
      const successTraceEnough = !requireTrace || !requireSuccessfulTrace || traceStats.success > 0;
      if (completedEnough && traceEnough) {
        if (!successTraceEnough) {
          await sleep(pollMs);
          continue;
        }
        console.log('[preflight] PASS: gate conditions satisfied.');
        process.exit(0);
      }

      await sleep(pollMs);
    }
  } finally {
    db.close();
  }

  console.error('[preflight] FAIL: timed out waiting for pass conditions.');
  process.exit(1);
}

void main();
