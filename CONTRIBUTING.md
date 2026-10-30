# Contributing to dsh-plugin-memory

Thanks for helping build portable, local-first long-term memory for DeepSeek
Harness agents. The plugin is intentionally small and dependency-free, so most
contributions are **tests, store-format care and prompt-budget care**.

## Ground rules

- **Zero build**: `lib/` is the runtime code exactly as shipped — plain ESM.
  `lib/types/index.d.ts` serves TypeScript consumers; there is no compiler step.
  `lib/client.js` runs unbundled in the DSH web client.
- **Local-first**: the memory store is plain markdown on the local filesystem.
  Do not add telemetry, analytics, a network client, an embedding service or any
  background upload. Anything that reads/writes outside the store needs a
  maintainer-approved design first.
- **Plugin boundary**: this plugin is a pure Cordis plugin and must never import
  from other plugins (including `dsh-plugin-heartbeat`). Cross-plugin
  coordination happens only through the documented shared JSON file
  (`<dshHome>/proactive-cooldown.json`) implemented independently on each side.
- **No new runtime dependencies**: runtime code may use `node:*` builtins and the
  host-provided peer packages. `scripts/memory.mjs` and `lib/boot.js` /
  `lib/scaffold.js` must stay standalone (node builtins only).
- **Fail soft**: corrupt config, missing store files or an unavailable host
  service must degrade to a warning — never crash a turn or a route.
- **Boot budget**: everything injected at session start shares a fixed character
  budget. New boot-block content must account for it in tests; never let the
  budget silently explode.

## Requirements

- Node.js **18+** locally; CI runs the plugin suite on Node **20** and **22**.
- Git, and ideally a DSH Desktop **0.2.1-rc.5** installation for manual checks.
- No lockfile is committed on purpose (peer-only dependencies); just
  `npm install` in the checkout.

## Local development

```sh
git clone https://github.com/LittleBlackTong/dsh-plugin-memory.git
cd dsh-plugin-memory
npm install                              # peer packages used by the tests
node --test                              # plugin suite; 242 tests on main today
node scripts/memory.mjs --self-test      # CLI round trip (also `npm test`)
node scripts/memory.mjs lint             # store integrity check
npm pack --dry-run                       # inspect the exact npm package contents
```

The CLI is usable against any store directory, so most store work can be
exercised without DSH at all:

```sh
MEMORY_DIR=/tmp/mem-dev node scripts/memory.mjs init
MEMORY_DIR=/tmp/mem-dev node scripts/memory.mjs status
MEMORY_DIR=/tmp/mem-dev node scripts/memory.mjs lint
```

Useful focused runs:

```sh
node --test test/boot.test.mjs
node --test test/recall-nudge.test.mjs test/proactive-lock.test.mjs
```

## Test requirements

- **TDD is the house style**: add or extend a `test/*.test.mjs` case first, watch
  it fail for the right reason, then implement. A behaviour change without a
  test is not ready.
- **The whole suite must be green** — CI runs `node --test` on Node 20 and 22,
  plus `node scripts/memory.mjs --self-test`.
- **Do not weaken existing assertions.** The suite pins the store contract
  (frontmatter, index routing, log format), boot-budget allocation, recall /
  digest nudge gating, migration tooling and the shared speech-right protocol.
  Removing or loosening one of those needs a maintainer-approved reason in the
  PR.
- Store-format changes need: an update to `docs/MIGRATION.md` when existing
  stores must be migrated, a `--self-test` round trip that still passes, and
  fixtures/coverage for both old and new files.
- New user-facing config keys need a default in the config schema, coverage in
  the config-store tests, and a row in the README config table(s).
- Prompt/boot changes need: budget tests updated deliberately, and a check that
  the section order (SOUL → tone → expression → working state → …) is preserved.
- Prefer the existing test doubles: temp directories (`mkdtemp`), injected clocks
  (`now`), and injected services instead of touching the real `~/.memory`.

### Client UI testing: the honest status

`lib/client.js` (the settings panel and memory health/graph cards) is covered by
**contract and static tests only** — tests load the client module in a `vm` with
a fake DOM and assert registration, slot declarations, locale dictionaries and
dictionary-key alignment. **There are no real DOM, render-snapshot or browser
tests.** Any UI change therefore needs manual verification in a running DSH
(Settings → Memory) and a screenshot in the PR. Treat this gap as a known
limitation, not as something a unit test proves.

## Manual testing against a real host (optional but recommended)

1. Clone the repo somewhere stable.
2. In a DSH profile directory (e.g. `~/.dsh/profiles/desktop`), add the checkout
   as a link dependency and to the profile's bundle list in `package.json`:

   ```jsonc
   {
     "dependencies": {
       "dsh-plugin-memory": "link:/absolute/path/to/dsh-plugin-memory"
     },
     "dsh": {
       "profile": {
         "bundles": ["@deepseek-ai/dsh-base", "dsh-plugin-memory"]
       }
     }
   }
   ```

3. Run `npm install` inside the profile directory, then restart DSH (a profile
   with `patchReload: live` also picks up bundle-patch edits live).
4. Use **Settings → Memory** to tune the config; `GET /api/memory/config` and
   `GET /api/memory/insights` show the live state.
5. **Do not** hand-write an `insert:` entry for this plugin into the profile's
   `cordis.patch.yml`: the package's `dsh.bundle` manifest already mounts it and
   a duplicate id crashes profile startup (`duplicate loader entry id`).

## Commit and PR style

- Small, focused PRs: one logical change per PR.
- Commit subjects follow the history style: `feat: …`, `fix: …`, `docs: …`,
  `test: …`, `chore: …`. Include the version only in release commits
  (maintainers do those).
- Fill in the PR template, including the exact `node --test` counts, the
  `self-test: PASS` line and a screenshot for UI changes.
- **Do not** bump `package.json` version, do not edit `CHANGELOG.md`, and do not
  run `npm publish` — releases are maintainer-run. Docs (`README.md` /
  `README.zh.md`) should be updated together, in both languages, when
  user-visible behaviour changes.
- Read `docs/MIGRATION.md` before changing the store layout or frontmatter
  contract.

## Releasing (maintainers only)

1. Merge the release PR after green CI.
2. Update `package.json`, `CHANGELOG.md`, README(s); commit the version bump.
3. `git push` (no tags) and `npm publish`; verify the published tarball
   (including `lib/types/index.d.ts` and the CLI `bin`).
4. No separate release branch is needed; `npm` is the distribution channel.

Questions: open an issue, or mention the maintainer in the PR.
