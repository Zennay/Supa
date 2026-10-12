import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

// Independent structural contract. This verifies real JSX selectors against
// the staged CSS, not browser layout or genuine M3 retailer evidence.
const [source, css] = await Promise.all([
  readFile(new URL('../src/features/observation/ObservationView.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/observation/ObservationView.css', import.meta.url), 'utf8'),
])
const ast = ts.createSourceFile(
  'ObservationView.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)

function elementTag(node) {
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText(ast)
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText(ast)
  return null
}

function classNames(node) {
  const opening = ts.isJsxElement(node)
    ? node.openingElement
    : ts.isJsxSelfClosingElement(node)
      ? node
      : null
  if (!opening) return []
  const attr = opening.attributes.properties.find(
    (entry) => ts.isJsxAttribute(entry) && entry.name.text === 'className',
  )
  return attr && ts.isStringLiteral(attr.initializer)
    ? attr.initializer.text.split(' ')
    : []
}

function directElements(node) {
  return ts.isJsxElement(node)
    ? node.children.filter((entry) => ts.isJsxElement(entry) || ts.isJsxSelfClosingElement(entry))
    : []
}

function findElements(predicate) {
  const found = []
  function visit(node) {
    if (elementTag(node) !== null && predicate(node)) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return found
}

function only(nodes, description) {
  assert.equal(nodes.length, 1, `${description}: expected exactly one JSX target, saw ${nodes.length}`)
  return nodes[0]
}

function rule(selector) {
  const marker = selector + ' {'
  const start = css.indexOf(marker)
  assert.ok(start >= 0, `Missing CSS selector: ${selector}`)
  assert.equal(css.indexOf(marker, start + marker.length), -1, `Duplicate CSS selector: ${selector}`)
  const end = css.indexOf('}', start + marker.length)
  assert.ok(end > start, `Unclosed CSS declaration: ${selector}`)
  return css.slice(start + marker.length, end)
}

function property(declarations, name, value) {
  const entries = declarations.split(';').map((entry) => entry.trim())
  assert.ok(entries.includes(`${name}: ${value}`), `Missing ${name}: ${value} in ${declarations}`)
}

test('actual JSX store heading has a shrinkable heading and unshrinking progress pill', () => {
  const heading = only(
    findElements((node) => classNames(node).includes('observation-card-heading')),
    'store heading',
  )
  assert.equal(elementTag(heading), 'div')
  const children = directElements(heading)
  const nameContainer = only(children.filter((node) => elementTag(node) === 'div'), 'store name container')
  only(directElements(nameContainer).filter((node) => elementTag(node) === 'h3'), 'store h3')
  const counter = only(children.filter((node) => classNames(node).includes('observation-count')), 'progress pill')
  assert.equal(elementTag(counter), 'span')

  property(rule('.observation-card-heading > div'), 'min-width', '0')
  property(rule('.observation-card-heading h3'), 'overflow-wrap', 'anywhere')
  property(rule('.observation-count'), 'flex', '0 0 auto')
})

test('actual JSX ingredient details summary has shrinkable copy beside durable status pill', () => {
  const details = only(
    findElements((node) => classNames(node).includes('observation-line')),
    'observation details',
  )
  assert.equal(elementTag(details), 'details')
  const summary = only(directElements(details).filter((node) => elementTag(node) === 'summary'), 'row summary')
  const children = directElements(summary)
  const copy = only(children.filter((node) => elementTag(node) === 'div'), 'row copy container')
  only(directElements(copy).filter((node) => elementTag(node) === 'strong'), 'ingredient label')
  only(directElements(copy).filter((node) => elementTag(node) === 'span'), 'required amount')
  const pill = only(children.filter((node) => classNames(node).includes('line-state')), 'row status pill')
  assert.equal(elementTag(pill), 'span')

  property(rule('.observation-line summary > div'), 'min-width', '0')
  property(rule('.observation-line summary > div'), 'overflow-wrap', 'anywhere')
  property(rule('.line-state'), 'flex', '0 0 auto')
})

test('narrow observation cards preserve 44px detail tap targets and single-column fields', () => {
  property(rule('.observation-line summary'), 'min-height', '44px')
  const breakpoint = css.indexOf('@media (max-width: 430px) {')
  assert.ok(breakpoint >= 0, 'Missing narrow viewport media rule')
  const responsive = css.slice(breakpoint)
  assert.ok(responsive.includes('.field-grid,'))
  assert.ok(responsive.includes('.line-fields {'))
  assert.ok(responsive.includes('grid-template-columns: 1fr;'))
})
