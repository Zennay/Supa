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

const exportsWrapper = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  exportsWrapper,
  exportsWrapper.exports,
  (name) => name === './observationQuantityPresentation.ts'
    ? presentation
    : require(name),
)
const { ObservationRequirementText, ObservationPackUnitOptions } = exportsWrapper.exports

test('independent product #2029: actual React demand text fails closed on negative quantities', () => {
  const render = (amount, unit) =>
    renderToStaticMarkup(
      React.createElement(ObservationRequirementText, { amount, unit }),
    )

  for (const unit of ['piece', 'g', 'kg', 'ml', 'l', 'unknown']) {
    for (const amount of [-100, -1, -0.25, -0.00007]) {
      const html = render(amount, unit)
      assert.match(html, /^<span>nodig: \? /, html)
      assert.doesNotMatch(html, /nodig: -/, html)
      assert.doesNotMatch(html, /NaN|Infinity/, html)
    }
  }

  assert.equal(render(-1, 'piece'), '<span>nodig: ? stuks</span>')
  assert.equal(render(-0.5, 'g'), '<span>nodig: ? g</span>')
  assert.equal(render(1, 'piece'), '<span>nodig: 1 stuk</span>')
  assert.equal(render(2, 'piece'), '<span>nodig: 2 stuks</span>')
  assert.equal(render(0, 'piece'), '<span>nodig: 0 stuks</span>')
  assert.equal(render(0.07, 'ml'), '<span>nodig: 0.07 ml</span>')
})

test('independent product #2029: rendered pack selector remains Dutch while submitting canonical piece', () => {
  const markup = renderToStaticMarkup(
    React.createElement(
      'select',
      { name: 'packUnit', defaultValue: 'piece' },
      React.createElement(ObservationPackUnitOptions),
    ),
  )
  assert.match(markup, /<option[^>]*value="piece"[^>]*>stuk<\/option>/)
  assert.doesNotMatch(markup, />piece<\/option>/)
  assert.equal((markup.match(/<option\b/g) ?? []).length, 5)
})
