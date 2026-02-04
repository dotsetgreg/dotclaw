---
title: Scheduler
---

# Scheduler

DotClaw supports one-off and recurring tasks, scheduled in the host timezone by default.

## Timezone

Set `host.timezone` in `~/.dotclaw/config/runtime.json` to override the system timezone:

```json
{
  "host": {
    "timezone": "America/New_York"
  }
}
```

## Scheduling tasks

Create tasks with natural language prompts in Telegram:

```
remind me every Monday at 9am to check my emails
schedule a daily standup summary at 9:30am
```

Ask the assistant to list, pause, resume, or cancel tasks when needed.

## Targeting other groups

Tasks run in the context of the group they are created in. To schedule for another group, use the `target_group` parameter when calling scheduler tools.
