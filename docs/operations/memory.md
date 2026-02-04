---
title: Memory
---

# Memory

DotClaw stores long-term memory in a SQLite database at `~/.dotclaw/data/store/memory.db`. Memory items are extracted from conversations and can be recalled when relevant to future interactions.

## Memory extraction

The agent automatically extracts important facts, preferences, and instructions from conversations. Extraction can be synchronous (during the response) or asynchronous (after the response) based on the `agent.memory.extraction.async` setting.

## Memory recall

When processing a message, DotClaw recalls relevant memories using a combination of:

- **Keyword matching**: Fast lookup based on text overlap
- **Semantic search**: Vector embeddings for meaning-based retrieval (when enabled)

The number of recalled items is controlled by `host.memory.recall.maxResults` and `host.memory.recall.maxTokens`.

## Memory controls

In the main/admin chat:

- `/dotclaw remember <fact>` - Manually add a memory item
- `/dotclaw memory <strict|balanced|loose>` - Adjust recall sensitivity

You can also ask the assistant to recall or summarize what it knows.

## Per-group isolation

Memory items are tagged with their source group. Each group's agent only sees memory from:
- Its own group
- Memory explicitly shared across groups

This maintains privacy boundaries between different chats.
