import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

// Independent executable SSR acceptance of the staged, as-yet-unrouted product
// component. Does not claim the App shell has replaced its dead profile button.
const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const source = readFileSync(
  new URL('../src/components/IdentityAvatar.tsx', import.meta.url), 'utf8',
)
const compiled = ts.transpileModule(source, {
  fileName: 'IdentityAvatar.tsx',
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])
const loaded = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  loaded, loaded.exports, require,
)
const { IdentityAvatar } = loaded.exports
assert.equal(typeof IdentityAvatar, 'function')
const render = () => renderToStaticMarkup(React.createElement(IdentityAvatar))

test('product #596: actual React render is a labelled, non-interactive demo image', () => {
  const html = render()
  assert.match(html, /^<span\b[^>]*>ZE<\/span>$/)
  assert.match(html, /class="avatar"/)
  assert.match(html, /role="img"/)
  assert.match(html, /aria-label="Demo-avatar"/)
  assert.match(html, /data-profile-action="none"/)
  assert.doesNotMatch(html, /<button\b|<a\b|<input\b|<select\b|<form\b/)
})

test('product #596: rendered demo identity has no keyboard, route or expandable-profile affordance', () => {
  const html = render()
  assert.doesNotMatch(html, /\b(?:tabindex|href|onclick|aria-haspopup|aria-expanded|aria-controls|aria-pressed|aria-current)=/i)
  assert.doesNotMatch(html, /role="(?:button|link|menuitem)"/)
  assert.doesNotMatch(html, /aria-label="Profiel"/)
})

test('product #596: static component renders identically through repeated independent mounts', () => {
  const first = render()
  const second = render()
  assert.equal(first, second)
  assert.equal((first.match(/ZE/g) ?? []).length, 1)
})
