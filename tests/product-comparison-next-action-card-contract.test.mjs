import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/features/basket/ComparisonNextActionCard.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/features/basket/ComparisonNextActionCard.css', import.meta.url), 'utf8')
const file = ts.createSourceFile('ComparisonNextActionCard.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

const elements = []
function visit(node) {
  if (ts.isJsxElement(node)) elements.push(node)
  ts.forEachChild(node, visit)
}
visit(file)

function tag(element) {
  return element.openingElement.tagName.getText(file)
}

function attribute(element, name) {
  return element.openingElement.attributes.properties.find(
    (prop) => ts.isJsxAttribute(prop) && prop.name.getText(file) === name,
  )
}

test('passive comparison card is valid TSX with an accessible status surface', () => {
  assert.deepEqual(file.parseDiagnostics, [])
  const section = elements.find((element) => tag(element) === 'section')
  assert.ok(section, 'card has semantic status container')
  for (const [name, literal] of [['role', 'status'], ['aria-live', 'polite']]) {
    const prop = attribute(section, name)
    assert.ok(prop, `missing ${name}`)
    assert.equal(prop.initializer?.text, literal)
  }
  assert.ok(attribute(section, 'data-comparison-next-step'))
  assert.ok(attribute(section, 'data-can-show-difference'))
})

test('display component exposes heading, explanation, and concrete next action', () => {
  for (const text of ['guidance.title', 'guidance.explanation', 'guidance.action', 'Volgende stap: ']) {
    assert.ok(source.includes(text), `missing ${text}`)
  }
  assert.ok(elements.some((element) => tag(element) === 'strong'))
  assert.ok(elements.filter((element) => tag(element) === 'p').length >= 2)
})

test('read-only guidance never claims an action through a dead control', () => {
  for (const element of elements) {
    assert.ok(!['button', 'a', 'input', 'select'].includes(tag(element)), `unexpected interactive element ${tag(element)}`)
    for (const prop of element.openingElement.attributes.properties) {
      if (ts.isJsxAttribute(prop)) {
        assert.ok(!/^onClick$|^onKeyDown$/.test(prop.name.getText(file)))
      }
    }
  }
})

test('comparison guidance card cannot calculate or display independent savings', () => {
  assert.doesNotMatch(source, /savingsCents|deltaCents|euro\.format|totalCents|Math\.abs/)
  assert.doesNotMatch(source, /M2|M3|liveprijs|besparing/)
})

test('card layout can shrink on mobile with readable long user-generated content', () => {
  assert.match(styles, /min-width:\s*0/)
  assert.match(styles, /max-width:\s*100%/)
  assert.match(styles, /overflow-wrap:\s*anywhere/)
  assert.doesNotMatch(styles, /white-space:\s*nowrap|width:\s*\d+px/)
})
