---
title: Quickstart
---

# Quickstart

This path uses the bootstrap script to initialize config, prompt for secrets, register your main chat, and build the container.

## 1. Install dependencies

```bash
git clone <repo-url>
cd dotclaw
npm install
```

## 2. Run the bootstrap

```bash
npm run bootstrap
```

The bootstrap will:

- Create runtime directories and config files
- Prompt for `.env` secrets
- Register your main Telegram chat
- Optionally build the Docker image
- Optionally run a container self-check

## 3. Build and start

```bash
npm run build
npm start
```

## Non-interactive bootstrap

```bash
DOTCLAW_BOOTSTRAP_NONINTERACTIVE=1 \
TELEGRAM_BOT_TOKEN=your_bot_token_here \
OPENROUTER_API_KEY=your_openrouter_api_key \
DOTCLAW_BOOTSTRAP_CHAT_ID=123456789 \
npm run bootstrap
```

Optional variables:

- `DOTCLAW_BOOTSTRAP_GROUP_NAME` (default `main`)
- `DOTCLAW_BOOTSTRAP_GROUP_FOLDER` (default `main`)
- `DOTCLAW_BOOTSTRAP_BUILD` (`true` or `false`)
- `DOTCLAW_BOOTSTRAP_SELF_CHECK` (`true` or `false`)
