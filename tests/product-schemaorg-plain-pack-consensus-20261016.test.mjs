import test from 'node:test'
import assert from 'node:assert/strict'
import { structuredSchemaOrgPack } from '../src/data/schemaOrgQuantitativePack.ts'

// Pure structural contract, no HTML, source, grant, HTTP or live prices.
for (const [label, weight, size, expected, quantity] of [
  ['matching same 500 g', '500 g', '500 g', 'normalized', '500 g'],
  ['equivalent 500 g and half kilogram', '500 g', '0.5 kg', 'normalized', '500 g'],
  ['equivalent one liter and 1000 ml', '1 l', '1000 ml', 'normalized', '1 l'],
  ['contradictory 500 g vs 1000 g', '500 g', '1000 g', 'unsafe', null],
  ['incompatible mass versus volume', '500 g', '500 ml', 'unsafe', null],
  ['multipack not a single container', '2x250 g', '500 g', 'unsafe', null],
  ['unknown explicit second pack', '500 g', 'about a kilogram', 'unsafe', null],
]) {
  test('Product plain weight-versus-size consistency: ' + label, () => {
    const product = { weight: { value: weight }, size: { value: size } }
    const result = structuredSchemaOrgPack(product)
    assert.equal(result.status, expected)
    if (result.status === 'normalized') {
      assert.equal(result.weightText, quantity)
    }
  })
}
test('single historical plain weight remains compatible with legacy parser', () => {
  const result = structuredSchemaOrgPack({ weight: { value: '500 g' } })
  assert.equal(result.status, 'none')
})
