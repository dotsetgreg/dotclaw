#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { runOnce } from '@dotsetlabs/autotune';

// Get DOTCLAW_HOME from environment or default to ~/.dotclaw
const DOTCLAW_HOME = process.env.DOTCLAW_HOME || path.join(os.homedir(), '.dotclaw');
const CONFIG_DIR = path.join(DOTCLAW_HOME, 'config');
const DATA_DIR = path.join(DOTCLAW_HOME, 'data');
const TRACES_DIR = path.join(DOTCLAW_HOME, 'traces');
const PROMPTS_DIR = path.join(DOTCLAW_HOME, 'prompts');

function setDefaultEnv(key, value) {
  if (!process.env[key] && value !== undefined && value !== null) {
    process.env[key] = String(value);
  }
}

function loadRuntimeConfig() {
  const runtimePath = path.join(CONFIG_DIR, 'runtime.json');
  if (!fs.existsSync(runtimePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(runtimePath, 'utf-8'));
  } catch {
    return null;
  }
}

async function main() {
  const runtime = loadRuntimeConfig();
  if (runtime) {
    setDefaultEnv('AUTOTUNE_TRACE_DIR', runtime.host?.trace?.dir || TRACES_DIR);
    setDefaultEnv('AUTOTUNE_OUTPUT_DIR', runtime.host?.promptPacksDir || PROMPTS_DIR);
    setDefaultEnv('AUTOTUNE_CANARY_FRACTION', runtime.agent?.promptPacks?.canaryRate);
  } else {
    setDefaultEnv('AUTOTUNE_TRACE_DIR', TRACES_DIR);
    setDefaultEnv('AUTOTUNE_OUTPUT_DIR', PROMPTS_DIR);
  }

  setDefaultEnv('AUTOTUNE_BEHAVIOR_CONFIG_PATH', path.join(CONFIG_DIR, 'behavior.json'));
  setDefaultEnv('AUTOTUNE_BEHAVIOR_REPORT_DIR', DATA_DIR);
  setDefaultEnv('AUTOTUNE_BEHAVIOR_ENABLED', '1');

  await runOnce();
  console.log('Autotune complete.');
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
