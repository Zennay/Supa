import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

// Checks actual source JSX consumers against the owner's staged CSS.
// This is a structural regression, not a rendered 320px browser test.
const [basketSource, pillSource, css] = await Promise.all([
  readFile(new URL('../src/features/basket/BasketView.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/StatPill.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

const basketAst = ts.createSourceFile('BasketView.tsx', basketSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const pillAst = ts.createSourceFile('StatPill.tsx', pillSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function tag(node) {
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText()
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText()
  return null
}

function attrs(node) {
  if (ts.isJsxElement(node)) return node.openingElement.attributes.properties
  if (ts.isJsxSelfClosingElement(node)) return node.attributes.properties
  return []
}

function attribute(node, key) {
  return attrs(node).find((entry) => ts.isJsxAttribute(entry) && entry.name.text === key)
}

function classes(node) {
  const value = attribute(node, 'className')?.initializer
  return value && ts.isStringLiteral(value) ? value.text.split(' ') : []
}

function direct(node, name) {
  return ts.isJsxElement(node)
    ? node.children.filter((child) => tag(child) === name)
    : []
}

function find(root, className) {
  const found = []
  function visit(node) {
    if (tag(node) && classes(node).includes(className)) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(root)
  assert.equal(found.length, 1, 'Exactly one ' + className + ' consumer must be present')
  return found[0]
}

function assertRuleContains(selector, requiredProperties) {
  const marker = selector + ' {'
  const start = css.indexOf(marker)
  assert.ok(start >= 0, 'CSS rule is missing: ' + selector)
  const end = css.indexOf('}', start + marker.length)
  assert.ok(end > start)
  const entries = css.slice(start + marker.length, end).split(';').map((entry) => entry.trim())
  for (const property of requiredProperties) {
    assert.ok(entries.includes(property), selector + ' missing ' + property)
  }
}

function assertMoneyGroup() {
  assertRuleContains(
    '.hero-total > strong,\n.stat-pill strong,\n.comparison-totals strong',
    ['min-width: 0', 'overflow-wrap: anywhere'],
  )
}

test('basket amountLabel is a direct strong child of the mobile hero total', () => {
  const card = find(basketAst, 'hero-total')
  const strongs = direct(card, 'strong')
  assert.equal(strongs.length, 1)
  assert.match(strongs[0].getText(basketAst), /basketCost\.amountLabel/)
  assertMoneyGroup()
})

test('visible StatPill value is in the non-overflow strong without losing group access semantics', () => {
  const pill = find(pillAst, 'stat-pill')
  const role = attribute(pill, 'role')?.initializer
  assert.ok(role && ts.isStringLiteral(role))
  assert.equal(role.text, 'group')
  assert.ok(attribute(pill, 'aria-label'), 'Accessible label must remain on the group')
  const strongs = direct(pill, 'strong')
  assert.equal(strongs.length, 1)
  assert.match(strongs[0].getText(pillAst), /presentation\.value/)
  assertMoneyGroup()
})

test('baseline and candidate totals both have shrinkable grid cells and strong amounts', () => {
  const comparison = find(basketAst, 'comparison-totals')
  const cells = direct(comparison, 'div')
  assert.equal(cells.length, 2)
  for (const cell of cells) {
    const amount = direct(cell, 'strong')
    assert.equal(amount.length, 1)
    assert.ok(attribute(amount[0], 'data-basket-cost-state'))
  }
  assert.match(cells[0].getText(basketAst), /baselineCost\.amountLabel/)
  assert.match(cells[1].getText(basketAst), /candidateCost\.amountLabel/)
  assertRuleContains('.comparison-totals > div', ['min-width: 0'])
  assertMoneyGroup()
})
