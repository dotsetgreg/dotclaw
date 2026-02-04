---
title: Model Selection
---

# Model Selection

Model selection is stored in `~/.dotclaw/config/model.json`.

## Example

```json
{
  "model": "moonshotai/kimi-k2.5",
  "allowlist": [
    "moonshotai/kimi-k2.5",
    "openai/gpt-5-mini",
    "openai/gpt-5-nano"
  ],
  "overrides": {
    "moonshotai/kimi-k2.5": {
      "context_window": 32000,
      "max_output_tokens": 2048
    }
  },
  "per_group": {
    "main": { "model": "openai/gpt-5-mini" }
  },
  "per_user": {
    "123456789": { "model": "openai/gpt-5-nano" }
  },
  "updated_at": "2026-02-04T00:00:00.000Z"
}
```

## How it works

- `model` sets the global default.
- `allowlist` restricts selectable models. Empty or missing means allow all.
- `overrides` sets per-model runtime overrides.
- `per_group` and `per_user` override the default for specific groups or users.

## Updating the model

- Use `npm run configure` to update the default model and allowlist.
- From Telegram (main/admin chat), you can set models with commands like:

```
set model to moonshotai/kimi-k2.5
set model to openai/gpt-5-mini for group main
set model to openai/gpt-5-nano for user 123456789
```
