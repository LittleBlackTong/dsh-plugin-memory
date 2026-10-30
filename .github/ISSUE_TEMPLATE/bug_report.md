---
name: Bug report
about: Something is broken or behaves unexpectedly
title: '[bug] '
labels: bug
---

## What happened

<!-- A clear and concise description of the bug. -->

## Steps to reproduce

1.
2.
3.

## Expected behaviour

<!-- What you expected to happen instead. -->

## Actual behaviour

<!-- What actually happened. If the plugin did not inject a memory / skill
when it should have, or injected the wrong thing, describe the visible effect. -->

## Environment

- **DSH version**: <!-- e.g. DSH Desktop 0.2.1-rc.5, or `dsh --version` -->
- **dsh-plugin-memory version**: <!-- npm version, or the git commit when running from a checkout -->
- **OS**: <!-- e.g. macOS 15.1 (arm64), Ubuntu 24.04, Windows 11 -->
- **Node.js version**: <!-- `node --version`, only relevant for the CLI / tests -->
- **Install method**: <!-- `dsh plugin --profile <profile> add dsh-plugin-memory` / dsh-market / `link:` to a checkout -->

## Relevant configuration

<!-- Redact anything private. `GET /api/memory/config` (Settings → Memory) or
the relevant keys from `<dshHome>/memory.json`: memoryDir, autoInject,
recallEnabled, digest nudge / tone / growth options, proactiveCooldownSeconds. -->

```json
```

## Store state

<!-- Which memory store is in use (`~/.memory`, a project `.memory/`, or a
custom memoryDir)? Do not paste personal memory content; just the layout, e.g.
`ls` output or the result of `node scripts/memory.mjs status`. -->

```text
```

## Logs / screenshots

<!-- Paste the relevant lines from the DSH log, the output of
`node scripts/memory.mjs lint`, or attach a screenshot of the settings panel.
Never paste API keys or private conversation content. -->

```text
```

## Additional context

<!-- Anything else that might matter: whether the memory was migrated from an
older version, whether dsh-plugin-heartbeat was speaking around the same time
(the shared `proactive-cooldown.json`), etc. -->
