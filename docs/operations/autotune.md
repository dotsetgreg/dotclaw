---
title: Autotune
---

# Autotune

DotClaw can run a continuous optimization loop with `@dotsetlabs/autotune`.

## Run Autotune

```bash
npm run autotune
```

Autotune consumes traces from `~/.dotclaw/traces` and writes:

- `~/.dotclaw/config/behavior.json`
- optional prompt packs in `~/.dotclaw/prompts`

## Environment variables

You can set these in `.env` or your shell:

- `AUTOTUNE_TRACE_DIR`
- `AUTOTUNE_OUTPUT_DIR`
- `AUTOTUNE_BEHAVIOR_ENABLED`
- `AUTOTUNE_BEHAVIOR_CONFIG_PATH`
- `AUTOTUNE_BEHAVIOR_REPORT_DIR`
- `AUTOTUNE_CANARY_FRACTION`
- `AUTOTUNE_EVAL_MODEL`

If you run `./scripts/install.sh`, you can set `AUTOTUNE_DIR` to point at a local Autotune checkout so the systemd timer can run it.

## Prompt packs

Shared prompt packs:

- `~/.dotclaw/prompts/task-extraction.json`
- `~/.dotclaw/prompts/response-quality.json`
- `~/.dotclaw/prompts/tool-calling.json`
- `~/.dotclaw/prompts/memory-policy.json`

Canary packs:

- `~/.dotclaw/prompts/task-extraction.canary.json`
- `~/.dotclaw/prompts/response-quality.canary.json`
- `~/.dotclaw/prompts/tool-calling.canary.json`
- `~/.dotclaw/prompts/memory-policy.canary.json`
