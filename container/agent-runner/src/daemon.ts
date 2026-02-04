import fs from 'fs';
import path from 'path';
import { runAgentOnce } from './index.js';
import { loadAgentConfig } from './agent-config.js';
import type { ContainerInput } from './container-protocol.js';

const REQUESTS_DIR = '/workspace/ipc/agent_requests';
const RESPONSES_DIR = '/workspace/ipc/agent_responses';
const HEARTBEAT_FILE = '/workspace/ipc/heartbeat';
const POLL_MS = loadAgentConfig().daemonPollMs;

function log(message: string): void {
  console.error(`[agent-daemon] ${message}`);
}

function ensureDirs(): void {
  fs.mkdirSync(REQUESTS_DIR, { recursive: true });
  fs.mkdirSync(RESPONSES_DIR, { recursive: true });
}

function writeHeartbeat(): void {
  try {
    fs.writeFileSync(HEARTBEAT_FILE, Date.now().toString());
  } catch {
    // Ignore heartbeat write errors
  }
}

async function processRequests(): Promise<void> {
  const files = fs.readdirSync(REQUESTS_DIR).filter(file => file.endsWith('.json'));
  for (const file of files) {
    const filePath = path.join(REQUESTS_DIR, file);
    let requestId = file.replace('.json', '');
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const payload = JSON.parse(raw) as { id?: string; input?: unknown };
      requestId = payload.id || requestId;
      const input = payload.input || payload;
      if (!isContainerInput(input)) {
        throw new Error('Invalid agent request payload');
      }
      const output = await runAgentOnce(input);
      const responsePath = path.join(RESPONSES_DIR, `${requestId}.json`);
      fs.writeFileSync(responsePath, JSON.stringify(output));
      fs.unlinkSync(filePath);
    } catch (err) {
      log(`Failed processing request ${requestId}: ${err instanceof Error ? err.message : String(err)}`);
      const responsePath = path.join(RESPONSES_DIR, `${requestId}.json`);
      fs.writeFileSync(responsePath, JSON.stringify({
        status: 'error',
        result: null,
        error: err instanceof Error ? err.message : String(err)
      }));
      try {
        fs.unlinkSync(filePath);
      } catch {
        // ignore cleanup failure
      }
    }
  }
}

function isContainerInput(value: unknown): value is ContainerInput {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.prompt === 'string'
    && typeof record.groupFolder === 'string'
    && typeof record.chatJid === 'string'
    && typeof record.isMain === 'boolean';
}

async function loop(): Promise<void> {
  ensureDirs();
  log('Daemon started');
  while (true) {
    // Write heartbeat at the start of each loop iteration
    writeHeartbeat();

    try {
      await processRequests();
    } catch (err) {
      log(`Daemon loop error: ${err instanceof Error ? err.message : String(err)}`);
    }
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
}

loop().catch(err => {
  log(`Daemon fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
