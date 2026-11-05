# Design notes

The plugin owns the **workflow**, never the **data format**.

```
dsh-plugin-memory (this plugin)
├── lib/index.js             # Cordis entry: boot injection + skill registration + settings hot-edits
├── lib/boot.js              # boot block rendering (SOUL/MEMORY/index + recent log, per-file budget)
├── lib/pages.js             # page access accounting (last_access stamping)
├── lib/insights.js          # health-dashboard data layer (read-only)
├── lib/activity-tracker.js  # the two polite gates: has the user spoken + active session
├── lib/digest-guard.js      # anti-laziness digest nudge
├── lib/recall-nudge.js      # proactive recall (persona names read from SOUL)
├── lib/growth.js            # weekly growth recap
├── lib/tone.js              # context-sensitive tone section
├── lib/graph.js / graph-3d.js / graph-search.js  # memory graph model + 3D layout + search
├── lib/reveal.js            # reveal a page in Finder / Explorer / xdg
├── lib/soul.js / paths.js   # SOUL managed block + cross-platform path helpers
├── lib/scaffold.js          # store scaffolding (templates created, never overwritten)
├── lib/client.js            # client half: "Memory" settings section, dashboard, graph
├── skills/memory.md         # embedded skill's operating protocol
└── scripts/memory.mjs       # CLI: init/search/touch/lint/status/checkup/pack/unpack
```

## Why the boot block is a hard guarantee

The boot block is injected through `ctx.systemPrompt.context()` (runtime context), not through a skill blurb. The host deduplicates by projection: an unchanged payload is injected once, a changed store replaces the previous snapshot. A new session therefore **always** loads memory first instead of hoping the model decides to call a skill.

## Persona layer

- **SOUL.md** is the persona file (user-owned). `BOOTSTRAP.md` drives the soul-forging conversation until `status: complete`.
- **Quick soul setup** writes a fenced managed block into `SOUL.md` (three fields: agent name / user address / baseline persona) and marks forging complete. Legacy stores forged in chat are echoed from the SOUL text.
- **tone.js** adds a ≤12-line "adapt to context" section (charged to the boot budget): crunch → short, night → gentler, bad news → facts first, milestones → one light line.
- **Persona names are never hard-coded**: recall/growth nudges read them from `readSoulProfile(memoryDir)`; `test/no-hardcoded-names.test.mjs` scans `lib/*.js` to keep it that way.

## Proactive behaviour

| Mechanism | Trigger | Guard |
|---|---|---|
| Digest nudge | turn ended + store unwritten for `digestNudgeAfterMinutes` | cooldown + per-session cap |
| Proactive recall | conversation idle, randomised interval | per-session cap, speech-floor arbitration |
| Weekly growth recap | `growthRecapIntervalDays` elapsed | same channel and arbitration as recall |
| Git auto-commit | store changes quiet for `autoCommitQuietSeconds` | skipped without `.git` |

**Speech-floor arbitration**: before any proactive message, claim `<DSH_HOME>/proactive-cooldown.json` (`{ version: 1, speaker, at }`, atomic tmp+rename). If another speaker claimed within `proactiveCooldownSeconds`, defer and **do not consume the cadence**. No cross-plugin imports — see [PROACTIVE-PROTOCOL.md](PROACTIVE-PROTOCOL.md).

## Health dashboard

`GET /api/memory/insights` is computed live per request (never cached): pages / index routes / word count (characters, not bytes), a 0–100 health score, access-freshness bars (today / ≤7 / ≤30 / ≤90 / >90 / never), four checks sharing a source with `dsh-memory lint`, stale candidates and the 5 newest log entries. On a headless deployment without `webServer` the route simply does not exist.

## Memory graph

A read-only projection of the store rendered as an interactive **3D sphere** (Canvas, no dependency):

- **Layout**: Fibonacci sphere (deterministic; same type forms a contiguous colour band).
- **Interaction**: drag empty space to rotate, wheel to zoom (0.5×–2.4×), drag a node to arrange it, double-click empty space to reset, auto-spin unless `prefers-reduced-motion`. Hover/click lights up neighbours immediately; click detection uses a displacement+duration double threshold (≤5px, ≤350ms).
- **Search**: ranks label > id > type > tag and flies the camera so the hit lands in the centre.
- **Reveal**: select a node → *Reveal in Finder* / *Copy path*; the host command is awaited, failures are reported and the absolute path is copied as a fallback.
- **Colours** adapt to light/dark panel themes (glow only on dark).
- The maths lives in `lib/graph-3d.js` + `lib/graph-search.js` (pure, tested) and is mirrored in `client.js` with consistency tests.

## FAQ (details)

**File skill vs plugin.** A `.dsh/skills/memory` file skill is a *soft* guarantee (only its blurb is injected). This plugin is a *hard* guarantee. They coexist; the file skill (rank 100) overrides the embedded skill (rank 250). Remove any hand-written persona you added before installing, to avoid double injection.

**Token cost.** Runtime context is deduplicated by projection: an unchanged payload is injected once.

**Where should the store live?** `~/.memory` by default; point `memoryDir` inside a project for isolation.

**Encryption.** Put `memoryDir` on an encrypted volume or a private repository — the format is unchanged.

## Migration

The store is plain markdown + git: copying it *is* the migration. Cross-machine, cross-agent and degradation tiers are covered in [MIGRATION.md](MIGRATION.md).
