import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import * as observationDomain from '../src/domain/m3ObservationSheet.ts'
import * as observationCopy from '../src/features/observation/observationPresentation.ts'
import * as observationUi from '../src/features/observation/observationCollectionUi.ts'
import * as quantityCopy from '../src/features/observation/observationQuantityPresentation.ts'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

/**
 * Runtime acceptance for actual ObservationView.tsx, not standalone previews.
 * Product #756 / PWQ-223: expected RED while the original #522 owner still
 * controls the Meten integration. It never edits the owner or collected data.
 */
const source = readFileSync(
  new URL('../src/features/observation/ObservationView.tsx', import.meta.url),
  'utf8',
)
const jsxComponents = readFileSync(
  new URL('../src/features/observation/ObservationQuantityFields.tsx', import.meta.url),
  'utf8',
)

function compile(sourceText, fileName) {
  const compiled = ts.transpileModule(sourceText, {
    fileName,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  })
  assert.deepEqual(compiled.diagnostics, [])
  return compiled.outputText
}

const jsxExports = { exports: {} }
new Function('module', 'exports', 'require', compile(jsxComponents, 'ObservationQuantityFields.tsx'))(
  jsxExports,
  jsxExports.exports,
  (specifier) =>
    specifier === './observationQuantityPresentation.ts'
      ? quantityCopy
      : require(specifier),
)

const viewExports = { exports: {} }
new Function('module', 'exports', 'require', compile(source, 'ObservationView.tsx'))(
  viewExports,
  viewExports.exports,
  (specifier) => {
    if (specifier === './ObservationView.css') return {}
    if (specifier === '../../domain/m3ObservationSheet.ts') return observationDomain
    if (specifier === './observationPresentation.ts') return observationCopy
    if (specifier === './observationCollectionUi.ts') return observationUi
    if (specifier === './ObservationQuantityFields.tsx') return jsxExports.exports
    return require(specifier)
  },
)

const { ObservationView } = viewExports.exports
const render = () => renderToStaticMarkup(React.createElement(ObservationView))

test('product #756: routed empty Meten view shows Dutch required piece demand in both shops', () => {
  const markup = render()
  assert.match(markup, /Meten zonder gokken/)
  assert.match(markup, /PLUS/)
  assert.match(markup, /DekaMarkt/)
  assert.match(markup, /collection-template-not-evidence/)
  assert.equal((markup.match(/nodig: 2 stuks/g) ?? []).length, 2)
  assert.doesNotMatch(markup, /nodig:\s*2\s+piece\b/)
  assert.doesNotMatch(markup, /nodig:\s*\?\s+unknown\b/)
})

test('product #756: routed available line renders Dutch option but preserves canonical form value', () => {
  const sheet = observationDomain.buildObservationSheet()
  const line = sheet.baseline.lines.find(({ requirement }) => requirement.unit === 'piece')
  assert.ok(line, 'Canonical M3 fixture has an actual piece requirement')
  line.observedProduct.available = true
  line.observedProduct.packUnit = 'piece'
  const saved = JSON.stringify(sheet)
  assert.ok(
    observationDomain.restoreObservationSheetDraft(saved),
    'This is a valid local draft input, not a fabricated measured price',
  )

  const before = globalThis.window
  try {
    globalThis.window = {
      localStorage: {
        getItem(key) {
          assert.equal(key, observationDomain.OBSERVATION_DRAFT_STORAGE_KEY)
          return saved
        },
      },
    }
    const markup = render()
    assert.match(markup, /Productnaam/)
    assert.match(markup, /<option[^>]*value="piece"[^>]*>stuk<\/option>/)
    assert.doesNotMatch(markup, />piece<\/option>/)
    assert.equal(JSON.stringify(sheet), saved, 'rendering cannot rewrite a collected field')
  } finally {
    if (before === undefined) delete globalThis.window
    else globalThis.window = before
  }
})
