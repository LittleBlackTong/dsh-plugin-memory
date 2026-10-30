# Security Policy

## Supported versions

Security fixes are applied to the latest published minor line. Older versions may
not receive fixes; please upgrade before reporting.

| Version | Supported |
| --- | --- |
| 0.12.x (latest) | ✅ |
| < 0.12 | ❌ |

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

- Preferred: open a private report via GitHub Security Advisories —
  <https://github.com/LittleBlackTong/dsh-plugin-memory/security/advisories/new>
- Alternative email: `security@example.com`
  <!-- Placeholder: replace with a real maintainer address before publicising this file. -->

Useful details: the plugin version (npm version or git commit), DSH version, OS,
store layout (`ls`-level, never memory content), the relevant config (redacted),
reproduction steps and the potential impact. We aim to acknowledge a report
within 7 days and to coordinate disclosure after a fix ships.

## Data and privacy

The plugin is local-first. It has **no telemetry and makes no third-party network
requests**. The memory store is plain markdown on your local filesystem.

Files it reads and writes:

| Path | Content |
| --- | --- |
| `$MEMORY_DIR`, else `./.memory`, else `~/.memory` | the memory store: `SOUL.md`, `MEMORY.md`, `index.md`, `log.md`, pages, notes |
| `<dshHome>/memory.json` (default `~/.dsh/memory.json`) | user configuration |
| `<store>/.growth-recap.json` | weekly-recap state (`lastAt`) |
| `<dshHome>/proactive-cooldown.json` | shared speech-right lock with `dsh-plugin-heartbeat` (only `version`, `speaker`, `at`) |

If the store is a git repository and auto-commit is enabled, the plugin runs
local `git add` / `git commit` / `git status` / `git diff` inside the store
directory. It **never pushes, fetches or contacts a remote**.

Memory content is injected into the model context, which means it becomes part
of the prompts sent to **your configured model provider**. That provider
relationship is governed by DSH and the provider's policy, not by this plugin.
Treat the store like a personal notes directory: keep it out of public
repositories, use an encrypted volume for sensitive content, and never paste
memory content unredacted into issues.

The browser half (`lib/client.js`) only calls the plugin's own loopback routes on
the DSH web server (`/api/memory/config`, `/api/memory/insights`,
`/api/memory/graph`, …). It loads no remote assets.

## Permission and sandbox boundary

- The plugin runs **in-process inside the DSH host** with the host's privileges.
  It is a plugin, not a sandbox.
- It injects instructions and context (boot block, skill body, recall reminders,
  digest nudges, tone/expression guidance). Those steer the model but **do not
  bypass the host's approval layer**; tool calls that are dangerous or
  irreversible still require approval. Treat prompt content as influential:
  review what is in your store before installing the plugin into a shared
  profile.
- The bundled CLI (`scripts/memory.mjs`, `bin: dsh-memory`) runs with your user
  privileges and reads/writes the resolved store directory. Run it only against
  stores you trust; `unpack` can overwrite files unless `--force` semantics are
  respected — review its output before restoring into an existing store.
- Treat the store and `<dshHome>/memory.json` as sensitive: they can contain
  personal information and reveal store paths. Don't commit them or paste them
  unredacted into issues.

## Scope

In scope: vulnerabilities in this plugin's code (path handling, archive
pack/unpack, config parsing, lock-file handling, unintended data exposure,
prompt-injection issues caused by the plugin's own text or skill file).

Out of scope: vulnerabilities in DSH itself or in the model providers (report
those upstream), and risks arising from a user deliberately placing sensitive
data in a store that is later published or shared.

## Dependency posture

Runtime code depends only on `node:*` builtins and host-provided peer packages
(`@deepseek-ai/cordis`, `@deepseek-ai/dsh-skill`,
`@deepseek-ai/dsh-system-prompt`, `@deepseek-ai/schemastery`); there are no
bundled third-party runtime dependencies. The CLI and store helpers are
node-builtins-only by design.
