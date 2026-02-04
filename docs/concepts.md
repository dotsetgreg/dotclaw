---
title: Concepts
---

# Concepts

## Groups and chats

DotClaw treats each Telegram chat as a group with its own context and files. Group registration is stored in `~/.dotclaw/data/registered_groups.json`, and each group gets a folder under `~/.dotclaw/groups/<group-folder>`.

## Memory

DotClaw keeps long-term memory in a SQLite database at `~/.dotclaw/data/store/memory.db`. The agent automatically extracts important facts from conversations and recalls them when relevant.

Memory features:
- **Automatic extraction**: Facts, preferences, and instructions are extracted from conversations
- **Semantic search**: Optional vector embeddings for meaning-based retrieval
- **Per-group isolation**: Each group's memory is kept separate

See [Memory](/operations/memory) for configuration options.

## Containers and isolation

Each request runs inside a Docker container. The container only sees mounted directories that you explicitly allow. This protects the host and limits agent access to your data.

Container mode:

- `ephemeral`: a new container per request
- `daemon`: a persistent container for lower latency

## Tools and policy

Tools are governed by `~/.dotclaw/config/tool-policy.json`. You can allow or deny tools by default and override by group or user. Optional budgets in `~/.dotclaw/config/tool-budgets.json` limit daily tool usage.

## Scheduler

The task scheduler runs cron-based or one-off tasks and executes them in the target group's context. Scheduling uses the timezone defined in `~/.dotclaw/config/runtime.json` or the system timezone by default.
