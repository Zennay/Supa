import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const path = new URL('../src/features/observation/ObservationNextActionCard.tsx', import.meta.url)
const stylesheetPath = new URL('../src/features/observation/ObservationNextActionCard.css', import.meta.url)
const source = readFileSync(path, 'utf8')
const css = readFileSync(stylesheetPath, 'utf8')

function openingAttributes(sourceFile) {
  let root = null
  const visit = (node) => {
    if (
      root === null &&
      ts.isJsxOpeningElement(node) &&
      node.tagName.getText(sourceFile) === 'div'
    ) {
      root = node
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  assert.ok(root, 'expected a semantic next-action status root')
  return new Map(root.attributes.properties.map((attribute) => [
    attribute.name?.getText(sourceFile),
    attribute.initializer?.getText(sourceFile),
  ]))
}

test('M3 next-action React component is valid TSX with one passive accessible status', () => {
  const parsed = ts.createSourceFile(
    path.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  assert.equal(parsed.parseDiagnostics.length, 0)
  const attributes = openingAttributes(parsed)
  assert.equal(attributes.get('role'), '"status"')
  assert.equal(attributes.get('aria-label'), '"Volgende stap"')
  assert.equal(attributes.get('aria-live'), '"polite"')
  assert.equal(attributes.get('aria-atomic'), '"true"')
  assert.equal(attributes.get('className'), '"observation-next-action"')
  assert.doesNotMatch(source, /onClick|onKeyDown|dangerouslySetInnerHTML|innerHTML|autoFocus/)
})

test('M3 next-action content is React text, never interpolated into raw HTML', () => {
  assert.match(source, /<strong>\{action\.title\}<\/strong>/)
  assert.match(source, /<p>\{action\.detail\}<\/p>/)
  assert.doesNotMatch(source, /href=|src=|<button|<a\b|contentEditable/)
})

test('M3 task guidance layout uses existing neutral palette and mobile-safe overflow', () => {
  assert.match(source, /import '\.\/ObservationNextActionCard\.css'/)
  assert.match(css, /\.observation-next-action\s*\{/)
  assert.match(css, /overflow-wrap:\s*anywhere/)
  assert.match(css, /background:\s*var\(--surface-strong\)/)
  assert.match(css, /border:\s*1px solid var\(--line\)/)
  assert.match(css, /color:\s*var\(--muted\)/)
})
