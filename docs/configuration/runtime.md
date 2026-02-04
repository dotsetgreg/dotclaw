---
title: Runtime Config
---

# Runtime Config

`~/.dotclaw/config/runtime.json` contains non-secret runtime overrides. Defaults are defined in `src/runtime-config.ts` and merged at startup.

## Example

```json
{
  "host": {
    "logLevel": "info",
    "container": {
      "mode": "daemon"
    },
    "metrics": {
      "port": 3001,
      "enabled": true
    },
    "dashboard": {
      "enabled": true
    },
    "memory": {
      "embeddings": {
        "enabled": true
      }
    }
  },
  "agent": {
    "assistantName": "Rain",
    "promptPacks": {
      "enabled": true
    },
    "planner": {
      "enabled": true,
      "mode": "auto"
    }
  }
}
```

## Key sections

- `host.container` controls Docker image, timeouts, resource limits, and mode.
- `host.metrics.enabled` and `host.metrics.port` expose Prometheus metrics on `http://localhost:<port>/metrics`.
- `host.dashboard.enabled` serves a basic status page on `http://localhost:<port+1>/`.
- `host.timezone` overrides the scheduler timezone.
- `host.heartbeat` controls automated heartbeat runs (disable if you don't want background activity).
- `host.backgroundTasks` controls async/background runs based on trigger regex.
- `host.trace.dir` and `host.promptPacksDir` control Autotune outputs.
- `host.memory.embeddings` configures optional embeddings for recall.
- `agent.assistantName` sets the assistant display name.
- `agent.promptPacks` enables prompt pack loading and canary rate.
- `agent.tools` controls access to built-in tools (bash, web search, web fetch).

## Tips

- Keep secrets out of this file.
- Match types and structure to the defaults or overrides will be ignored.
- Restart DotClaw after changes.

## Background tasks

`host.backgroundTasks` can run long tasks asynchronously when the last user message matches `triggerRegex`.
Disable this if you prefer all requests to run synchronously.

## Heartbeat

`host.heartbeat` controls periodic background runs for checking scheduled tasks and pending work.
Set `enabled` to `false` to disable heartbeats.
