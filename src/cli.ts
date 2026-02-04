#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { spawn, spawnSync, execSync } from 'child_process';
import readline from 'readline';

import {
  DOTCLAW_HOME,
  PACKAGE_ROOT,
  GROUPS_DIR,
  LOGS_DIR,
  ENV_PATH,
  REGISTERED_GROUPS_PATH,
  CONTAINER_BUILD_SCRIPT,
  SCRIPTS_DIR,
  ensureDirectoryStructure,
} from './paths.js';

const PLATFORM = process.platform;
const IS_MACOS = PLATFORM === 'darwin';
const IS_LINUX = PLATFORM === 'linux';

const LAUNCHD_PLIST_NAME = 'com.dotclaw.plist';
const SYSTEMD_SERVICE_NAME = 'dotclaw.service';

function log(message: string): void {
  console.log(`[dotclaw] ${message}`);
}

function error(message: string): void {
  console.error(`[dotclaw] ERROR: ${message}`);
}

function warn(message: string): void {
  console.warn(`[dotclaw] WARN: ${message}`);
}

function getNodePath(): string {
  return process.execPath;
}

function getUserHome(): string {
  return process.env.HOME || process.env.USERPROFILE || '/tmp';
}

function getLaunchdPlistPath(): string {
  return path.join(getUserHome(), 'Library', 'LaunchAgents', LAUNCHD_PLIST_NAME);
}

function isServiceRunning(): boolean {
  if (IS_MACOS) {
    try {
      const result = execSync(`launchctl list | grep com.dotclaw`, { encoding: 'utf-8', stdio: 'pipe' });
      return result.includes('com.dotclaw');
    } catch {
      return false;
    }
  } else if (IS_LINUX) {
    try {
      const result = execSync(`systemctl is-active ${SYSTEMD_SERVICE_NAME}`, { encoding: 'utf-8', stdio: 'pipe' });
      return result.trim() === 'active';
    } catch {
      return false;
    }
  }
  return false;
}

function generateLaunchdPlist(): string {
  const nodePath = getNodePath();
  const home = getUserHome();
  const distIndex = path.join(PACKAGE_ROOT, 'dist', 'index.js');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.dotclaw</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${distIndex}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${DOTCLAW_HOME}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${home}/.local/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>${home}</string>
        <key>DOTCLAW_HOME</key>
        <string>${DOTCLAW_HOME}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${LOGS_DIR}/dotclaw.log</string>
    <key>StandardErrorPath</key>
    <string>${LOGS_DIR}/dotclaw.error.log</string>
</dict>
</plist>`;
}

function generateSystemdService(): string {
  const nodePath = getNodePath();
  const distIndex = path.join(PACKAGE_ROOT, 'dist', 'index.js');
  const user = process.env.USER || 'nobody';

  return `[Unit]
Description=DotClaw Personal Assistant
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
User=${user}
Environment=NODE_ENV=production
Environment=DOTCLAW_HOME=${DOTCLAW_HOME}
ExecStart=${nodePath} ${distIndex}
WorkingDirectory=${DOTCLAW_HOME}
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
`;
}

async function prompt(question: string, defaultValue = ''): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    rl.question(`${question}${suffix}: `, (answer: string) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

// Commands

async function cmdSetup(): Promise<void> {
  log('Starting DotClaw setup...');
  log(`Data directory: ${DOTCLAW_HOME}`);
  log(`Package root: ${PACKAGE_ROOT}`);

  // Create directory structure
  log('Creating directory structure...');
  ensureDirectoryStructure();

  // Run init to create config files
  log('Initializing configuration files...');
  const initResult = spawnSync('node', [path.join(SCRIPTS_DIR, 'init.js')], {
    stdio: 'inherit',
    env: { ...process.env, DOTCLAW_HOME }
  });
  if (initResult.status !== 0) {
    error('Init failed');
    process.exit(1);
  }

  // Run configure
  log('Running configuration...');
  const configureResult = spawnSync('node', [path.join(SCRIPTS_DIR, 'configure.js')], {
    stdio: 'inherit',
    env: { ...process.env, DOTCLAW_HOME }
  });
  if (configureResult.status !== 0) {
    error('Configuration failed');
    process.exit(1);
  }

  // Build container
  const buildContainer = await prompt('Build Docker container now? (yes/no)', 'yes');
  if (buildContainer.toLowerCase().startsWith('y')) {
    await cmdBuild();
  }

  // Install service
  const installService = await prompt('Install as system service? (yes/no)', 'yes');
  if (installService.toLowerCase().startsWith('y')) {
    await cmdInstallService();
  }

  log('Setup complete!');
  log('');
  log('Next steps:');
  log('  1. Register your Telegram chat: dotclaw register');
  log('  2. Start the service: dotclaw start');
  log('  3. Check status: dotclaw doctor');
}

async function cmdConfigure(): Promise<void> {
  log('Running configuration...');
  log(`Data directory: ${DOTCLAW_HOME}`);

  // Ensure directories exist
  ensureDirectoryStructure();

  // Run configure script
  const configureResult = spawnSync('node', [path.join(SCRIPTS_DIR, 'configure.js')], {
    stdio: 'inherit',
    env: { ...process.env, DOTCLAW_HOME }
  });

  if (configureResult.status !== 0) {
    error('Configuration failed');
    process.exit(1);
  }

  log('Configuration updated.');

  if (isServiceRunning()) {
    const restart = await prompt('Restart service to apply changes? (yes/no)', 'yes');
    if (restart.toLowerCase().startsWith('y')) {
      await cmdRestart();
    }
  }
}

async function cmdBuild(): Promise<void> {
  log('Building Docker container...');

  if (!fs.existsSync(CONTAINER_BUILD_SCRIPT)) {
    error(`Container build script not found: ${CONTAINER_BUILD_SCRIPT}`);
    process.exit(1);
  }

  const dockerResult = spawnSync('bash', [CONTAINER_BUILD_SCRIPT], {
    cwd: path.dirname(CONTAINER_BUILD_SCRIPT),
    stdio: 'inherit'
  });

  if (dockerResult.status !== 0) {
    warn('Container build failed. Make sure Docker is running.');
    process.exit(1);
  } else {
    log('Build complete');
  }
}

async function cmdStart(foreground = false): Promise<void> {
  const distIndex = path.join(PACKAGE_ROOT, 'dist', 'index.js');

  if (!fs.existsSync(distIndex)) {
    error(`DotClaw not properly installed. Missing: ${distIndex}`);
    process.exit(1);
  }

  if (foreground) {
    log('Starting DotClaw in foreground...');
    const child = spawn('node', [distIndex], {
      cwd: DOTCLAW_HOME,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production', DOTCLAW_HOME }
    });
    child.on('exit', code => process.exit(code || 0));
    return;
  }

  if (IS_MACOS) {
    const plistPath = getLaunchdPlistPath();
    if (!fs.existsSync(plistPath)) {
      warn('Service not installed. Installing now...');
      await cmdInstallService();
    }

    if (isServiceRunning()) {
      log('Service is already running');
      return;
    }

    log('Starting service...');
    try {
      execSync(`launchctl load "${plistPath}"`, { stdio: 'inherit' });
      log('Service started');
    } catch {
      error('Failed to start service');
      process.exit(1);
    }
  } else if (IS_LINUX) {
    if (isServiceRunning()) {
      log('Service is already running');
      return;
    }

    log('Starting service...');
    try {
      execSync(`sudo systemctl start ${SYSTEMD_SERVICE_NAME}`, { stdio: 'inherit' });
      log('Service started');
    } catch {
      error('Failed to start service. Try: dotclaw start --foreground');
      process.exit(1);
    }
  } else {
    warn(`Unsupported platform: ${PLATFORM}. Running in foreground.`);
    await cmdStart(true);
  }
}

async function cmdStop(): Promise<void> {
  if (IS_MACOS) {
    const plistPath = getLaunchdPlistPath();
    if (!fs.existsSync(plistPath)) {
      log('Service not installed');
      return;
    }

    if (!isServiceRunning()) {
      log('Service is not running');
      return;
    }

    log('Stopping service...');
    try {
      execSync(`launchctl unload "${plistPath}"`, { stdio: 'inherit' });
      log('Service stopped');
    } catch {
      error('Failed to stop service');
      process.exit(1);
    }
  } else if (IS_LINUX) {
    if (!isServiceRunning()) {
      log('Service is not running');
      return;
    }

    log('Stopping service...');
    try {
      execSync(`sudo systemctl stop ${SYSTEMD_SERVICE_NAME}`, { stdio: 'inherit' });
      log('Service stopped');
    } catch {
      error('Failed to stop service');
      process.exit(1);
    }
  } else {
    warn(`Unsupported platform: ${PLATFORM}`);
  }
}

async function cmdRestart(): Promise<void> {
  await cmdStop();
  await cmdStart();
}

async function cmdLogs(follow = false): Promise<void> {
  const logFile = path.join(LOGS_DIR, 'dotclaw.log');
  const errorLogFile = path.join(LOGS_DIR, 'dotclaw.error.log');

  if (!fs.existsSync(logFile) && !fs.existsSync(errorLogFile)) {
    log('No logs found yet');
    log(`Log directory: ${LOGS_DIR}`);
    return;
  }

  if (follow) {
    log('Following logs (Ctrl+C to stop)...');
    const tailArgs = ['-f'];
    if (fs.existsSync(logFile)) tailArgs.push(logFile);
    if (fs.existsSync(errorLogFile)) tailArgs.push(errorLogFile);

    const child = spawn('tail', tailArgs, { stdio: 'inherit' });
    child.on('exit', code => process.exit(code || 0));
  } else {
    log('Recent logs:');
    console.log('');
    if (fs.existsSync(logFile)) {
      try {
        const content = execSync(`tail -n 50 "${logFile}"`, { encoding: 'utf-8' });
        console.log(content);
      } catch {
        // ignore
      }
    }
    if (fs.existsSync(errorLogFile)) {
      const errorContent = fs.readFileSync(errorLogFile, 'utf-8').trim();
      if (errorContent) {
        console.log('\n--- Errors ---');
        try {
          const content = execSync(`tail -n 20 "${errorLogFile}"`, { encoding: 'utf-8' });
          console.log(content);
        } catch {
          // ignore
        }
      }
    }
  }
}

async function cmdDoctor(): Promise<void> {
  log('Running diagnostics...');
  console.log('');

  const doctorResult = spawnSync('node', [path.join(SCRIPTS_DIR, 'doctor.js')], {
    stdio: 'inherit',
    env: { ...process.env, DOTCLAW_HOME }
  });

  console.log('');

  // Additional service status
  if (IS_MACOS) {
    const plistPath = getLaunchdPlistPath();
    console.log(`launchd plist: ${fs.existsSync(plistPath) ? 'installed' : 'not installed'}`);
    console.log(`Service running: ${isServiceRunning() ? 'yes' : 'no'}`);
  } else if (IS_LINUX) {
    console.log(`Service running: ${isServiceRunning() ? 'yes' : 'no'}`);
  }

  if (doctorResult.status !== 0) {
    process.exit(doctorResult.status || 1);
  }
}

async function cmdInstallService(): Promise<void> {
  fs.mkdirSync(LOGS_DIR, { recursive: true });

  if (IS_MACOS) {
    const plistPath = getLaunchdPlistPath();
    const plistDir = path.dirname(plistPath);

    fs.mkdirSync(plistDir, { recursive: true });

    // Unload if already loaded
    if (isServiceRunning()) {
      try {
        execSync(`launchctl unload "${plistPath}"`, { stdio: 'pipe' });
      } catch {
        // ignore
      }
    }

    const plistContent = generateLaunchdPlist();
    fs.writeFileSync(plistPath, plistContent);

    log(`Installed launchd service: ${plistPath}`);
    log('Start with: dotclaw start');
  } else if (IS_LINUX) {
    const servicePath = `/etc/systemd/system/${SYSTEMD_SERVICE_NAME}`;
    const serviceContent = generateSystemdService();

    log('Installing systemd service (requires sudo)...');

    // Write to temp file first, then move with sudo
    const tempPath = path.join('/tmp', SYSTEMD_SERVICE_NAME);
    fs.writeFileSync(tempPath, serviceContent);

    try {
      execSync(`sudo mv "${tempPath}" "${servicePath}"`, { stdio: 'inherit' });
      execSync('sudo systemctl daemon-reload', { stdio: 'inherit' });
      execSync(`sudo systemctl enable ${SYSTEMD_SERVICE_NAME}`, { stdio: 'inherit' });
      log(`Installed systemd service: ${servicePath}`);
      log('Start with: dotclaw start');
    } catch {
      error('Service installation failed');
      process.exit(1);
    }
  } else {
    warn(`Unsupported platform: ${PLATFORM}. No service installed.`);
  }
}

async function cmdUninstallService(): Promise<void> {
  if (IS_MACOS) {
    const plistPath = getLaunchdPlistPath();

    if (isServiceRunning()) {
      log('Stopping service...');
      try {
        execSync(`launchctl unload "${plistPath}"`, { stdio: 'pipe' });
      } catch {
        // ignore
      }
    }

    if (fs.existsSync(plistPath)) {
      fs.unlinkSync(plistPath);
      log('Service uninstalled');
    } else {
      log('Service was not installed');
    }
  } else if (IS_LINUX) {
    log('Removing systemd service...');
    try {
      execSync(`sudo systemctl stop ${SYSTEMD_SERVICE_NAME}`, { stdio: 'pipe' });
    } catch {
      // ignore
    }
    try {
      execSync(`sudo systemctl disable ${SYSTEMD_SERVICE_NAME}`, { stdio: 'pipe' });
    } catch {
      // ignore
    }
    try {
      execSync(`sudo rm /etc/systemd/system/${SYSTEMD_SERVICE_NAME}`, { stdio: 'pipe' });
      execSync('sudo systemctl daemon-reload', { stdio: 'pipe' });
      log('Service uninstalled');
    } catch {
      warn('Could not remove systemd service file');
    }
  } else {
    warn(`Unsupported platform: ${PLATFORM}`);
  }
}

async function cmdRegister(): Promise<void> {
  // Ensure directories exist
  ensureDirectoryStructure();

  let groups: Record<string, { name: string; folder: string; added_at: string }> = {};
  if (fs.existsSync(REGISTERED_GROUPS_PATH)) {
    try {
      groups = JSON.parse(fs.readFileSync(REGISTERED_GROUPS_PATH, 'utf-8'));
    } catch {
      // ignore
    }
  }

  console.log('Register a Telegram chat with DotClaw');
  console.log('');
  console.log('To find your chat ID:');
  console.log('  1. Add @userinfobot or @get_id_bot to your Telegram chat');
  console.log('  2. The bot will reply with the chat ID (usually a negative number for groups)');
  console.log('');

  const chatId = await prompt('Telegram chat ID');
  if (!chatId) {
    error('Chat ID is required');
    process.exit(1);
  }

  const name = await prompt('Group name', 'main');
  const folder = await prompt('Folder name (lowercase, hyphens only)', 'main');

  if (!/^[a-z0-9-]+$/.test(folder)) {
    error('Folder name must be lowercase letters, numbers, and hyphens only');
    process.exit(1);
  }

  groups[chatId] = {
    name,
    folder,
    added_at: new Date().toISOString()
  };

  fs.mkdirSync(path.dirname(REGISTERED_GROUPS_PATH), { recursive: true });
  fs.writeFileSync(REGISTERED_GROUPS_PATH, JSON.stringify(groups, null, 2) + '\n');

  // Create group folder
  const groupDir = path.join(GROUPS_DIR, folder);
  fs.mkdirSync(groupDir, { recursive: true });

  log(`Registered chat ${chatId} as "${name}" (folder: ${folder})`);

  if (isServiceRunning()) {
    const restart = await prompt('Restart service to apply changes? (yes/no)', 'yes');
    if (restart.toLowerCase().startsWith('y')) {
      await cmdRestart();
    }
  }
}

async function cmdStatus(): Promise<void> {
  console.log(`Platform: ${PLATFORM}`);
  console.log(`DOTCLAW_HOME: ${DOTCLAW_HOME}`);
  console.log(`Package root: ${PACKAGE_ROOT}`);
  console.log(`Service running: ${isServiceRunning() ? 'yes' : 'no'}`);

  console.log(`.env: ${fs.existsSync(ENV_PATH) ? 'present' : 'missing'}`);

  if (fs.existsSync(REGISTERED_GROUPS_PATH)) {
    try {
      const groups = JSON.parse(fs.readFileSync(REGISTERED_GROUPS_PATH, 'utf-8'));
      const count = Object.keys(groups).length;
      console.log(`Registered groups: ${count}`);
    } catch {
      console.log('Registered groups: error reading file');
    }
  } else {
    console.log('Registered groups: none');
  }
}

function printHelp(): void {
  console.log(`
DotClaw - Personal OpenRouter-based assistant

Usage: dotclaw <command> [options]

Commands:
  setup              Run initial setup (init, configure, build, install service)
  configure          Re-run configuration (change API keys, model, etc.)
  start              Start the service (or run in foreground with --foreground)
  stop               Stop the service
  restart            Restart the service
  logs               Show recent logs (use --follow to tail)
  doctor             Run diagnostics
  build              Build Docker container
  register           Register a Telegram chat
  status             Show current status
  install-service    Install as system service
  uninstall-service  Remove system service
  help               Show this help message

Options:
  --foreground, -f   Run in foreground (for 'start' command)
  --follow, -f       Follow log output (for 'logs' command)

Data directory: ${DOTCLAW_HOME}
Override with DOTCLAW_HOME environment variable.

Examples:
  dotclaw setup              # First-time setup
  dotclaw configure          # Change configuration
  dotclaw start              # Start as background service
  dotclaw start --foreground # Run in terminal
  dotclaw logs --follow      # Tail logs
  dotclaw doctor             # Check configuration
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  const flags = args.slice(1);

  const hasFlag = (short: string, long: string): boolean =>
    flags.includes(short) || flags.includes(long);

  try {
    switch (command) {
      case 'setup':
        await cmdSetup();
        break;
      case 'configure':
        await cmdConfigure();
        break;
      case 'build':
        await cmdBuild();
        break;
      case 'start':
        await cmdStart(hasFlag('-f', '--foreground'));
        break;
      case 'stop':
        await cmdStop();
        break;
      case 'restart':
        await cmdRestart();
        break;
      case 'logs':
        await cmdLogs(hasFlag('-f', '--follow'));
        break;
      case 'doctor':
        await cmdDoctor();
        break;
      case 'register':
        await cmdRegister();
        break;
      case 'status':
        await cmdStatus();
        break;
      case 'install-service':
        await cmdInstallService();
        break;
      case 'uninstall-service':
        await cmdUninstallService();
        break;
      case 'help':
      case '--help':
      case '-h':
        printHelp();
        break;
      default:
        error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
