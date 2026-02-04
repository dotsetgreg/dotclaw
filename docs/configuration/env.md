---
title: Environment (.env)
---

# Environment (.env)

Secrets live in `~/.dotclaw/.env`. Only set secrets here; non-secret runtime settings go in `~/.dotclaw/config/runtime.json`.

::: tip File Location
The `.env` file must be placed at `~/.dotclaw/.env` (or `$DOTCLAW_HOME/.env` if you've customized the home directory).
:::

## Required

- `TELEGRAM_BOT_TOKEN`
- `OPENROUTER_API_KEY`

## Optional

- `BRAVE_SEARCH_API_KEY` (enables WebSearch)
- `TZ` (override host timezone)
- `DOTCLAW_HOME` (override config/data directory, default: `~/.dotclaw`)

## Example

```bash
TELEGRAM_BOT_TOKEN=123456789:replace-with-real-token
OPENROUTER_API_KEY=sk-or-replace-with-real-key
BRAVE_SEARCH_API_KEY=replace-with-brave-key
```

## Non-interactive setup variables

These are read by `npm run bootstrap` and `npm run configure` when running non-interactively:

- `DOTCLAW_BOOTSTRAP_NONINTERACTIVE=1`
- `DOTCLAW_CONFIGURE_NONINTERACTIVE=1`
- `DOTCLAW_BOOTSTRAP_CHAT_ID`
- `DOTCLAW_BOOTSTRAP_GROUP_NAME`
- `DOTCLAW_BOOTSTRAP_GROUP_FOLDER`
- `DOTCLAW_BOOTSTRAP_BUILD`
- `DOTCLAW_BOOTSTRAP_SELF_CHECK`
