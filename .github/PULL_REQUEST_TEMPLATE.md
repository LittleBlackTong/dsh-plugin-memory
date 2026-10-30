## Summary

<!-- What does this PR change, and why? One paragraph is enough. Link the
issue it fixes (`Fixes #123`) when there is one. -->

## Type of change

- [ ] Bug fix
- [ ] New feature / behaviour change
- [ ] Prompt / boot-block / skill wording change
- [ ] Documentation
- [ ] Tests only
- [ ] Chore / refactor (no behaviour change)

## Changes

<!-- Bullet list of the meaningful changes. Mention new or changed config keys,
CLI commands, persisted-state files and boot-block sections explicitly. -->

-
-

## Test evidence

<!-- Paste the exact output counts, not just "tests pass".
`node --test` → all pass; the suite is at 242 tests on main today.
`node scripts/memory.mjs --self-test` must print `self-test: PASS`.
For a UI change, also attach a screenshot from a running DSH
(Settings → Memory) — see CONTRIBUTING.md for the client-test caveat. -->

```text
$ node --test
ℹ tests ...   ℹ pass ...   ℹ fail 0

$ node scripts/memory.mjs --self-test
self-test: PASS
```

- [ ] New/updated tests cover the behaviour change (existing assertions were not weakened)
- [ ] `npm pack --dry-run` still contains the expected files
- [ ] Larger changes verified against a real DSH 0.2.1-rc.5 host

## Impact and compatibility

<!-- Host version, store-format migration, boot-block budget, what gets
injected into the model context. Write "none" when the change is invisible. -->

- Host / session-format impact:
- Store format / migration impact:
- Prompt-budget impact:

## Documentation

- [ ] README / README.zh.md updated when user-visible behaviour changed
- [ ] CHANGELOG entry left to the maintainer during release (do not bump the version here)

## Checklist

- [ ] I did not edit `package.json` version or publish anything
- [ ] No secrets, tokens or private conversation content in the diff or test fixtures
- [ ] The change is limited to the plugin boundary (no cross-plugin imports, no host edits)
