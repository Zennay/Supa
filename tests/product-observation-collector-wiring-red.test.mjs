import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'

/**
 * Product #756 / PWQ-223: acceptance for the *real routed collector*.
 *
 * The helper/SSR tests on #1998 -> #2030 -> #2031 prove the new standalone
 * components, but cannot prove that ObservationView actually renders them.
 * Intentionally RED while #522 owns ObservationView.tsx: no source rewrite here.
 */
const source = readFileSync(
  new URL('../src/features/observation/ObservationView.tsx', import.meta.url),
  'utf8',
)
const ast = ts.createSourceFile(
  'ObservationView.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)

function descendants(root, predicate) {
  const found = []
  function visit(node) {
    if (predicate(node)) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(root)
  return found
}

function jsxTagName(node) {
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText(ast)
  if (ts.isJsxOpeningElement(node)) return node.tagName.getText(ast)
  return null
}

function attributeValue(node, name) {
  const entry = node.attributes.properties.find(
    (attribute) =>
      ts.isJsxAttribute(attribute) && attribute.name.text === name,
  )
  return entry?.initializer?.getText(ast) ?? ''
}

test('product #756: actual Meten demand rows use the Dutch boundary component', () => {
  const imports = descendants(
    ast,
    (node) =>
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier.text === './ObservationQuantityFields.tsx',
  )
  assert.equal(
    imports.length,
    1,
    'ObservationView must import the reviewed, display-only quantity components',
  )

  const amounts = descendants(
    ast,
    (node) =>
      ts.isJsxSelfClosingElement(node) &&
      jsxTagName(node) === 'ObservationRequirementText' &&
      attributeValue(node, 'amount').includes('line.requirement.amount') &&
      attributeValue(node, 'unit').includes('line.requirement.unit'),
  )
  assert.ok(
    amounts.length > 0,
    'The visible Meten requirement must use the localized component on the actual line data',
  )
  assert.doesNotMatch(
    source,
    /nodig:\s*\{line\.requirement\.amount\}\s*\{line\.requirement\.unit\}/,
    'Never interpolate the canonical piece/unknown unit into visible Dutch collector copy',
  )
})

test('product #756: real pack-unit select renders Dutch options while retaining canonical value', () => {
  const selects = descendants(
    ast,
    (node) =>
      ts.isJsxElement(node) &&
      jsxTagName(node.openingElement) === 'select' &&
      attributeValue(node.openingElement, 'value').includes('product.packUnit'),
  )

  assert.ok(selects.length > 0, 'Find the actual product.packUnit controlled select')
  for (const select of selects) {
    const options = descendants(
      select,
      (node) =>
        ts.isJsxSelfClosingElement(node) &&
        jsxTagName(node) === 'ObservationPackUnitOptions',
    )
    assert.equal(
      options.length,
      1,
      'Render reviewed Dutch labels; do not display raw canonical piece via packUnits.map',
    )
  }
  assert.match(
    source,
    /packUnit:\s*event\.target\.value/,
    'The form must still submit the canonical selected unit without translation',
  )
})

test('product #756: collector template retains canonical piece, untouched evidence status', () => {
  const sheet = buildObservationSheet()
  const before = JSON.stringify(sheet)
  assert.ok(sheet.baseline.lines.some((line) => line.requirement.unit === 'piece'))
  assert.deepEqual(
    sheet.baseline.lines.map((line) => line.requirement),
    sheet.candidate.lines.map((line) => line.requirement),
  )
  assert.equal(sheet.evidenceStatus, 'collection-template-not-evidence')
  assert.equal(JSON.stringify(sheet), before)
})
