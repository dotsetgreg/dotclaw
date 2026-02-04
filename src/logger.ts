import pino from 'pino';
import { loadRuntimeConfig } from './runtime-config.js';

let cachedLogger: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (cachedLogger) return cachedLogger;
  const runtime = loadRuntimeConfig();
  cachedLogger = pino({
    level: runtime.host.logLevel,
    transport: { target: 'pino-pretty', options: { colorize: true } }
  });
  return cachedLogger;
}

export const logger = getLogger();
