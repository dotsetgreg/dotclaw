# DotClaw

Personal OpenRouter-based assistant. See [README.md](README.md) for philosophy and setup. See [docs/architecture.md](docs/architecture.md) and [docs/getting-started/requirements.md](docs/getting-started/requirements.md).

## Quick Context

Single Node.js process that connects to Telegram, routes messages to an OpenRouter agent runtime running in Docker containers. Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Main app: Telegram connection, message routing, IPC |
| `src/config.ts` | Paths, intervals, routing defaults |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `src/memory-store.ts` | Long-term memory storage (SQLite) |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

Service management:
```bash
launchctl load ~/Library/LaunchAgents/com.dotclaw.plist
launchctl unload ~/Library/LaunchAgents/com.dotclaw.plist
```
