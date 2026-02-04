---
title: systemd (Linux)
---

# systemd (Linux)

## One-click install

```bash
./scripts/install.sh
```

This script:

- Installs dependencies
- Builds DotClaw and the container image
- Writes a systemd service unit
- Optionally configures Autotune if available

## Manual service setup

Use `systemd/dotclaw.service` as a template. Replace:

- `{{USER}}` with the Linux user that runs DotClaw
- `{{NODE_PATH}}` with your Node 20+ binary
- `{{PROJECT_ROOT}}` with the DotClaw repo path
- `{{DOTCLAW_HOME}}` with your DotClaw data directory (default `~/.dotclaw`)

Then install it:

```bash
sudo cp systemd/dotclaw.service /etc/systemd/system/dotclaw.service
sudo systemctl daemon-reload
sudo systemctl enable --now dotclaw.service
```

Logs will be written to `~/.dotclaw/logs/` by default.

Or use the CLI:

```bash
dotclaw install-service
dotclaw start
```
