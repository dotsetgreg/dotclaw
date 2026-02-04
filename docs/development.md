---
title: Development
---

# Development

## Commands

```bash
npm run dev
npm run build
npm run typecheck
npm run lint
npm test
```

## Agent container

Rebuild the agent image when you change container code:

```bash
./container/build.sh
```

## Tests

`npm test` runs a build, Node tests, and the agent runner test.
