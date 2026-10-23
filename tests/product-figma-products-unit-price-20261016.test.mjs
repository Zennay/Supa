import assert from 'node:assert/strict'
import test from 'node:test'
import {
  filterDemoProductsByUnit,
  orderDemoProductsByUnitPrice,
  parseDemoUnitPrice,
} from '../src/features/products/productUnitPrice.ts'

test('Figma Producten: €-examples parse with integer cents in both Dutch and dot notation', () => {
  assert.deepEqual(parseDemoUnitPrice('€1.09/L'), { cents: 109, unit: 'l' })
  assert.deepEqual(parseDemoUnitPrice(' € 1,16 / l '), { cents: 116, unit: 'l' })
  assert.deepEqual(parseDemoUnitPrice('€1.36/KG'), { cents: 136, unit: 'kg' })
})

test('Figma Producten: invalid and unsupported units never become sortable known prices', () => {
  for (const sample of ['€0.001/L', '€-1/L', '€1.36/unknown', '€999999999999999999/KG', '€1.75', '€0/0']) {
    assert.equal(parseDemoUnitPrice(sample), null, sample)
  }
})

test('Figma Producten: unit filter only includes directly comparable examples', () => {
  const examples = [
    { id: 'cola', unitPrice: '€1.09/L' },
    { id: 'banana', unitPrice: '€1.36/KG' },
    { id: 'unknown', unitPrice: 'Prijs onbekend' },
  ]
  assert.deepEqual(filterDemoProductsByUnit(examples, 'all').map(p => p.id), ['cola', 'banana', 'unknown'])
  assert.deepEqual(filterDemoProductsByUnit(examples, 'l').map(p => p.id), ['cola'])
  assert.deepEqual(filterDemoProductsByUnit(examples, 'kg').map(p => p.id), ['banana'])
})

test('Figma Producten: sort does not rank kg as less expensive than litres', () => {
  const original = [
    { id: 'cola-2', unitPrice: '€2.10/L' },
    { id: 'banana-1', unitPrice: '€0.50/KG' },
    { id: 'cola-1', unitPrice: '€1.09/L' },
    { id: 'banana-2', unitPrice: '€1.36/KG' },
  ]
  assert.deepEqual(orderDemoProductsByUnitPrice(original).map(p => p.id), [
    'cola-1', 'cola-2', 'banana-1', 'banana-2',
  ])
  assert.deepEqual(original.map(p => p.id), ['cola-2', 'banana-1', 'cola-1', 'banana-2'])
})

test('Figma Producten: equal and unknown prices preserve their input order', () => {
  const examples = [
    { id: 'z', unitPrice: '€1.99/L' },
    { id: 'a', unitPrice: '€1.99/L' },
    { id: 'missing-1', unitPrice: 'unknown' },
    { id: 'missing-2', unitPrice: '' },
  ]
  assert.deepEqual(orderDemoProductsByUnitPrice(examples).map(p => p.id), ['z', 'a', 'missing-1', 'missing-2'])
})
