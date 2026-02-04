---
title: Troubleshooting
---

# Troubleshooting

## Docker not running

Run `docker info` to confirm Docker is running. On macOS, start Docker Desktop. On Linux, run `sudo systemctl start docker`.

## Missing API keys

Check `~/.dotclaw/.env` for:

- `TELEGRAM_BOT_TOKEN`
- `OPENROUTER_API_KEY`

Optional:

- `BRAVE_SEARCH_API_KEY`

## Permission errors on ~/.dotclaw/

Ensure the current user owns `~/.dotclaw/`:

```bash
sudo chown -R $USER ~/.dotclaw/
```

## Container build fails

Try rebuilding the image:

```bash
dotclaw build
# or: ./container/build.sh
```

Check `~/.dotclaw/logs/dotclaw.error.log` for details.

## Diagnostics

Run the doctor script to inspect common issues:

```bash
npm run doctor
```

## Scheduler issues

Confirm `host.timezone` in `~/.dotclaw/config/runtime.json` and restart DotClaw after changes:

```bash
dotclaw restart
```
