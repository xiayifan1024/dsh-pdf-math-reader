import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import assert from 'node:assert/strict'
const code = await readFile(new URL('../client.js', import.meta.url), 'utf8')
let definition
const window = { __ModuleLoader__: { load(value) { definition = value } } }
const sandbox = { window, console, setTimeout, clearTimeout, URL, Blob, fetch, document: {}, navigator: {} }
vm.runInNewContext(code, sandbox, { filename: 'client.js' })
assert.equal(definition.id, '@local/pdf-math-reader')
const React = {
  Component: class {},
  createElement() {},
  useState() {},
  useEffect() {},
  useRef() {},
  useMemo() {},
  useCallback() {},
}
const jsxRuntime = { jsx() {}, jsxs() {}, Fragment: Symbol('Fragment') }
const require = (id) => {
  if (id === 'react') return React
  if (id === 'react/jsx-runtime') return jsxRuntime
  throw new Error(`unexpected require ${id}`)
}
const plugin = definition.factory(require)
assert.equal(typeof plugin.apply, 'function')
assert.deepEqual([...plugin.inject].sort(), ['locale', 'slots'])
console.log('client loader artifact test passed')
