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
      createElement: () => ({ id: '', textContent: '', setAttribute() {} }),
      head: { appendChild() {} },
    },
    console,
  }
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  assert.ok(captured !== undefined, 'factory did not run')
  return captured.__test
}

/** Walk an element tree, collecting every string leaf. */
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

test('MemoryChip renders the ON state, and nothing without a sessionId', () => {
  const seam = loadClient()
  const withSession = seam.MemoryChip({ sessionId: 's1' })
  assert.ok(withSession !== null, 'chip renders when the slot passes a session id')
  const texts = collectText(withSession)
  assert.ok(texts.some((text) => text.includes('记忆开')), `chip texts: ${texts.join(' | ')}`)
  const trigger = withSession.children[0]
  assert.equal(trigger.props['aria-haspopup'], 'menu')
  assert.equal(trigger.props['aria-expanded'], false, 'the dropdown starts closed')
  assert.ok(!texts.includes('本会话'), 'menu items are not rendered until the chip is opened')
  assert.equal(seam.MemoryChip({}), null, 'no session id means no chip (e.g. a preview)')
})

test('MemoryChip follows an injected English t seat', () => {
  const seam = loadClient()
  const t = (key) => seam.DICTS.en[key]
  const node = seam.MemoryChip({ sessionId: 's1', t })
  assert.ok(collectText(node).some((text) => text.includes('Memory on')))
})

test('SessionControls shows the loading line before the fetch resolves', () => {
  const seam = loadClient()
  const texts = collectText(seam.SessionControls({}))
  assert.ok(texts.some((text) => text.includes('读取会话状态中')), `texts: ${texts.join(' | ')}`)
  assert.ok(texts.some((text) => text.includes('会话与工作区')))
})

test('the client half exposes the session route it talks to', () => {
  const seam = loadClient()
  assert.equal(seam.SESSION_URL, '/api/memory/session')
})
