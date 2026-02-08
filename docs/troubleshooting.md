---
title: Troubleshooting
---

# Troubleshooting

## Docker not running

Run `docker info` to confirm Docker is running. On macOS, start Docker Desktop. On Linux, run `sudo systemctl start docker`.

## Missing API keys

Check `~/.dotclaw/.env` for:

- `OPENROUTER_API_KEY`
- at least one provider token:
  - `TELEGRAM_BOT_TOKEN`, or
  - `DISCORD_BOT_TOKEN`

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

## Unexpected container privilege behavior

By default, DotClaw runs agent containers in privileged mode (`host.container.privileged=true`).
If you need reduced container privileges, set:

```json
{
  "host": {
    "container": {
      "privileged": false
    }
  }
}
```

Then restart DotClaw.

For deterministic release gating on the production machine, run:

```bash
npm run preflight:prod-chat -- \
  --chat discord:1469421941294108713 \
  --dotclaw-home ~/.dotclaw \
  --timeout-sec 180 \
  --require-completed 1
```

The command exits `0` only when the target chat has a completed queue row plus a successful trace row (by default) after `--start-iso`/start time, and exits non-zero on failed/stale/timeout conditions or trace rows containing `error_code`.

## Diagnostics

Run the doctor script to inspect common issues:

```bash
dotclaw doctor
```

## Scheduler issues

Confirm `host.timezone` (or `TZ`) in `~/.dotclaw/config/runtime.json` and restart DotClaw after changes. This controls both scheduling and how the agent interprets timestamps:

```bash
dotclaw restart
```

## Message stays on typing with no model request

If logs stop after `Processing message` (often around embedding/memory recall) and no provider request is emitted, DotClaw is likely blocked in recall prep.

Mitigations:

- reduce recall wait ceiling:

```json
{
  "host": {
    "memory": {
      "recall": {
        "timeoutMs": 5000
      }
    }
  }
}
```

- temporarily disable semantic embeddings:

```json
{
  "host": {
    "memory": {
      "embeddings": {
        "enabled": false
      }
    }
  }
}
```

Then restart DotClaw.
