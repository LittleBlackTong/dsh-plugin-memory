# Proactive-cooldown protocol (v1)

Two DSH plugins may independently decide, on their own timers, that the agent
should say something unprompted:

- **dsh-plugin-memory** — recall nudges, digest reminders, weekly growth recaps;
- **dsh-plugin-heartbeat** — L1 reports, L2 questions, L4 escalations.

Talking over each other in the same quiet window looks like a split
personality, so both plugins honour one shared, advisory **speech floor**. The
protocol deliberately lives in a **plain JSON file**, not an import: each plugin
ships its own tiny implementation, so either one can be installed, upgraded or
removed without touching the other (`zero cross-plugin imports`).

## File

```
${DSH_HOME:-~/.dsh}/proactive-cooldown.json
```

```json
{ "version": 1, "speaker": "memory" | "heartbeat", "at": 1760000000000 }
```

- `at` is an epoch-millisecond timestamp of the last claim.
- Writes are atomic (`temp file + rename`): a reader never sees a partial
  document.
- A missing, unreadable or malformed file means **"no lock"** — a broken
  cooldown must never silence a plugin forever.

## Claim algorithm

Before injecting a proactive followup, a plugin calls:

```js
claimProactiveLock({ path, speaker, cooldownSeconds, now })
```

1. Read the file. If it is missing/corrupt → no lock.
2. If `at > now - cooldownSeconds * 1000` **and** `speaker !== self`:
   - return `{ ok: false, deferredBy: <other speaker> }`;
   - the caller yields **for this attempt only** (do not consume its own
     cadence or signal set — retry on a later trigger);
   - heartbeat records the yield as `L0 · proactive-cooldown` and re-arms.
3. Otherwise write `{ version: 1, speaker: self, at: now }` (atomic) and
   return `{ ok: true }`.

`cooldownSeconds <= 0` disables arbitration: claim returns `{ ok: true }`
without writing anything.

## Rules

- The lock is **advisory**: a failed write (read-only home, EACCES, …) must
  degrade to "go ahead" — politeness, not a hard dependency.
- **Manual user actions bypass the floor** (e.g. heartbeat's *Beat now*), since
  the user explicitly asked for speech.
- A speaker may re-claim/refresh its **own** lock (same `speaker`) at any time.
- Default cooldown: **180 seconds** (`proactiveCooldownSeconds` in both plugins;
  `0` turns arbitration off).
- Old files without `version`/`speaker` are treated as no lock; only
  `{version:1, speaker, at}` is written by both implementations.

## Compatibility matrix

| Plugin | 0.12.x | 0.13.x | Notes |
| --- | --- | --- | --- |
| dsh-plugin-memory | v1 | v1 | since 0.12.0 |
| dsh-plugin-heartbeat | v1 | v1 | since 0.7.0 |

A third-party plugin is welcome to participate: implement the same claim
algorithm, use a unique `speaker` value, and read the same file. Unknown
speakers are treated as "someone else holds the floor" until the cooldown
expires.

## Tests

Both repositories test the protocol independently and cross-check each other's
implementation (`test/proactive-lock.test.mjs` in
[dsh-plugin-memory](https://github.com/LittleBlackTong/dsh-plugin-memory) and
[dsh-plugin-heartbeat](https://github.com/LittleBlackTong/dsh-plugin-heartbeat))
with real files and real timestamps.
