import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

// Regression: v0.16.0 shipped the plugin author's own persona names inside the
// recall/growth nudges, the tone guide and the settings placeholders, so every
// user saw 「小蓝」/「阿周」 instead of the names from their own SOUL. Persona
// names must always come from SOUL (readSoulProfile) — never from source.
const FORBIDDEN = ['小蓝', '阿周', 'Small-Blue', 'Small Blue']

test('runtime sources carry no hard-coded persona names (SOUL is the only source)', () => {
  const libDir = new URL('../lib/', import.meta.url)
  const offenders = []
  for (const entry of readdirSync(libDir)) {
    if (!entry.endsWith('.js')) continue
    const source = readFileSync(new URL(entry, libDir), 'utf8')
    for (const name of FORBIDDEN) {
      if (source.includes(name)) offenders.push(`${entry}: ${name}`)
    }
  }
  assert.deepEqual(offenders, [], `hard-coded names must come from SOUL, not source: ${offenders.join(', ')}`)
})
