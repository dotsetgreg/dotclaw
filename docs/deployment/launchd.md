---
title: launchd (macOS)
---

# launchd (macOS)

The repo includes `launchd/com.dotclaw.plist`.

## Setup

```bash
cp launchd/com.dotclaw.plist ~/Library/LaunchAgents/
```

Edit the plist to set:

- `{{NODE_PATH}}`
- `{{PROJECT_ROOT}}`
- `{{HOME}}`
- `{{DOTCLAW_HOME}}`

Then load it:

```bash
launchctl load ~/Library/LaunchAgents/com.dotclaw.plist
```

Logs are written to `~/.dotclaw/logs/` by default.

## Using the CLI

The recommended approach is to use the CLI which handles template substitution automatically:

```bash
dotclaw install-service
dotclaw start
```
