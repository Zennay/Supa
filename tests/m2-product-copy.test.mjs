import assert from 'node:assert/strict'
import test from 'node:test'

import { m2Products } from '../src/data/m2Fixture.ts'

test('controlled M2 product labels stay natural Dutch without changing canonical identity', () => {
  const byId = new Map(m2Products.map((product) => [product.id, product]))

  assert.equal(byId.get('basmati-1kg')?.name, 'Basmatirijst 1 kg')
  assert.equal(byId.get('teriyaki-250')?.name, 'Teriyakisaus 250 ml')

  const renderedNames = m2Products.map((product) => product.name).join('\n')
  assert.doesNotMatch(renderedNames, /Basmati rijst 1 kg/)
  assert.doesNotMatch(renderedNames, /Teriyaki saus 250 ml/)
})
