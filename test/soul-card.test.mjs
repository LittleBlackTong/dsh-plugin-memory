import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/** Minimal React stub: enough to build and walk an element tree. */
const React = {
  memo(component) { return component },
  createContext(defaultValue) { return { _default: defaultValue } },
  useContext(context) { return context._default },
  createElement(type, props, ...children) {
    const flat = []
    const push = (value) => {
      if (Array.isArray(value)) { for (const item of value) push(item); return }
      if (value === null || value === undefined || value === false) return
      flat.push(value)
    }
    for (const child of children) push(child)
    return { type, props: props ?? {}, children: flat }
  },
  useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}] },
  useEffect() {},
  useRef(value) { return { current: value } },
  useMemo(fn) { return fn() },
  Component: class { constructor(p) { this.props = p } },
}

function loadClient() {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  let captured
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(options) {
          captured = options.factory((id) => {
            if (id === 'react') return React
            throw new Error(`unexpected require: ${id}`)
          })
        },
      },
    },
    document: {
      getElementById: () => null,
      createElement: () => ({ id: '', textContent: '', setAttribute() {}, remove() {} }),
      head: { appendChild() {} },
    },
    console,
  }
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  assert.ok(captured !== undefined, 'factory did not run')
  return captured.__test
}

function collectText(node, out = []) {
  if (node === null || node === undefined) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out)
    return out
  }
  collectText(node.children, out)
  return out
}

test('SoulCard renders its loading line before the fetch resolves', () => {
  const seam = loadClient()
  const texts = collectText(seam.SoulCard({}))
  assert.ok(texts.some((text) => text.includes('读取人格设置中')), `texts: ${texts.join(' | ')}`)
})

test('SoulCard follows an injected English t seat', () => {
  const seam = loadClient()
  const t = (key) => seam.DICTS.en[key]
  const texts = collectText(seam.SoulCard({ t }))
  assert.ok(texts.some((text) => text.includes('Reading the soul profile')), `texts: ${texts.join(' | ')}`)
})

test('the client half talks to the soul route', () => {
  const seam = loadClient()
  assert.equal(seam.SOUL_URL, '/api/memory/soul')
})
