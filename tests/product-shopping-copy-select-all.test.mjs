import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { selectShoppingCopyText } from '../src/features/shopping-list/selectShoppingCopyText.ts'

function field(value, options = {}) {
  const calls = []
  return {
    calls,
    value,
    readOnly: options.readOnly ?? true,
    focus() { calls.push('focus'); if (options.throwAt === 'focus') throw Error('denied') },
    select() { calls.push('select'); if (options.throwAt === 'select') throw Error('denied') },
    setSelectionRange(start, end) {
      calls.push(['range', start, end])
      if (options.throwAt === 'range') throw Error('denied')
    },
  }
}

test('mobile shopping export: select all currently visible exact read-only text', () => {
  const text = 'Boodschappenlijst\\n[ ] Bloemkool\\n[ ] Rijst'
  const element = field(text)
  assert.equal(selectShoppingCopyText(element, text), true)
  assert.deepEqual(element.calls, ['focus', 'select', ['range', 0, text.length]])
  assert.equal(element.value, text)
})

test('mobile shopping export: empty, replaced or writable text is never selected', () => {
  for (const [value, expected, options] of [
    ['', '', {}],
    ['vorige planning', 'actuele planning', {}],
    ['actuele planning', 'actuele planning', { readOnly: false }],
  ]) {
    const element = field(value, options)
    assert.equal(selectShoppingCopyText(element, expected), false)
    assert.deepEqual(element.calls, [])
  }
  assert.equal(selectShoppingCopyText(null, 'actuele planning'), false)
})

test('mobile shopping export: denied native selection fails closed without clipboard fallback', () => {
  for (const step of ['focus', 'select', 'range']) {
    const element = field('lijst', { throwAt: step })
    assert.equal(selectShoppingCopyText(element, 'lijst'), false)
  }
})

test('mobile shopping export: live Lijst has explicit select button and no clipboard API', () => {
  const source = readFileSync(new URL('../src/features/shopping-list/ShoppingListCopyButton.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../src/features/shopping-list/shoppingListCopyButton.css', import.meta.url), 'utf8')
  assert.match(source, /Selecteer alle tekst/)
  assert.match(source, /selectShoppingCopyText\(textAreaRef\.current, text\)/)
  assert.match(source, /ref=\{textAreaRef\}/)
  assert.match(source, /type="button"/)
  assert.match(source, /readOnly/)
  assert.match(css, /\.shopping-copy__button[\s\S]*?min-height:\s*44px/)
  assert.doesNotMatch(source, /navigator\.clipboard|document\.execCommand|fetch\(/)
})
