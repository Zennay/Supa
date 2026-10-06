import assert from 'node:assert/strict'
import test from 'node:test'

import { basketCostDisclosure } from '../src/features/basket/basketPresentation.ts'

test('basket cost disclosure exposes an exact total only when every line is resolved', () => {
  const display = basketCostDisclosure(3008, 0)

  assert.equal(display.state, 'complete')
  assert.equal(display.headline, 'Deterministisch mandtotaal')
  assert.equal(display.unresolvedLineCount, 0)
  assert.match(display.amountLabel, /30,08/)
  assert.doesNotMatch(display.amountLabel, /^min\./)
})

test('basket cost disclosure labels matched cost as a minimum when lines remain unresolved', () => {
  const display = basketCostDisclosure(3008, 2)

  assert.equal(display.state, 'minimum')
  assert.equal(display.headline, 'Bekend mandminimum')
  assert.equal(display.unresolvedLineCount, 2)
  assert.match(display.amountLabel, /^min\./)
  assert.match(display.amountLabel, /30,08/)
})

test('basket cost disclosure fails closed on an invalid unresolved count', () => {
  for (const count of [-1, Number.NaN]) {
    const display = basketCostDisclosure(3008, count)

    assert.equal(display.state, 'minimum')
    assert.equal(display.unresolvedLineCount, 1)
  }
})
