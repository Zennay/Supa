import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import * as presentation from '../src/features/observation/observationQuantityPresentation.ts'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const source = readFileSync(
  new URL('../src/features/observation/ObservationQuantityFields.tsx', import.meta.url),
  'utf8',
)
const compiled = ts.transpileModule(source, {
  fileName: 'ObservationQuantityFields.tsx',
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
  loaded,
  loaded.exports,
  (name) => name === './observationQuantityPresentation.ts'
    ? presentation
    : require(name),
)
const { ObservationRequirementText, ObservationPackUnitOptions } = loaded.exports

test('product #756: actual rendered M3 requirement component speaks Dutch', () => {
  const render = (amount, unit) =>
    renderToStaticMarkup(
      React.createElement(ObservationRequirementText, { amount, unit }),
    )

  assert.equal(render(1, 'piece'), '<span>nodig: 1 stuk</span>')
  assert.equal(render(2, 'piece'), '<span>nodig: 2 stuks</span>')
  assert.equal(render(null, 'unknown'), '<span>nodig: ? onbekend</span>')
  assert.equal(render(0.2, 'kg'), '<span>nodig: 0.2 kg</span>')
  assert.doesNotMatch(render(2, 'piece'), /\bpiece\b/)
  assert.equal(render(2, 'piece'), render(2, 'piece'))
})

test('product #756: actual select markup shows Dutch piece while posting canonical value', () => {
  const html = renderToStaticMarkup(
    React.createElement('select', {
      'aria-label': 'Verpakkingseenheid',
      name: 'pack-unit',
      defaultValue: 'piece',
    }, React.createElement(ObservationPackUnitOptions)),
  )
  assert.match(html, /^<select\b/)
  assert.match(html, /aria-label="Verpakkingseenheid"/)
  assert.match(html, /<option\b[^>]*value="piece"[^>]*>stuk<\/option>/)
  assert.doesNotMatch(html, />piece<\/option>/)
  assert.equal((html.match(/<option\b/g) ?? []).length, 5)
  for (const [canonical, label] of [
    ['g', 'g'],
    ['kg', 'kg'],
    ['ml', 'ml'],
    ['l', 'l'],
    ['piece', 'stuk'],
  ]) {
    assert.match(html, new RegExp(`<option\\b[^>]*value="${canonical}"[^>]*>${label}<\\/option>`))
  }
})
