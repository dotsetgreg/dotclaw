import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function distPath(relativeFile) {
  return path.join(projectRoot, 'dist', relativeFile);
}

export function importFresh(modulePath) {
  const url = pathToFileURL(modulePath).href;
  const cacheBust = `t=${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return import(`${url}?${cacheBust}`);
}

export async function withTempCwd(tempDir, fn) {
  const cwd = process.cwd();
  process.chdir(tempDir);
  try {
    return await fn();
  } finally {
    process.chdir(cwd);
  }
}

/**
 * Set DOTCLAW_HOME to a temp directory and run the function.
 * Restores the original DOTCLAW_HOME after the function completes.
 */
export async function withTempHome(tempDir, fn) {
  const originalHome = process.env.DOTCLAW_HOME;
  process.env.DOTCLAW_HOME = tempDir;
  try {
    return await fn();
  } finally {
    if (originalHome === undefined) {
      delete process.env.DOTCLAW_HOME;
    } else {
      process.env.DOTCLAW_HOME = originalHome;
    }
  }
}
