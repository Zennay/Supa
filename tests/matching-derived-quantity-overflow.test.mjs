import assert from 'node:assert/strict'
import test from 'node:test'

import { matchIngredient } from '../src/domain/matching.ts'

test('derived multipack quantity overflow cannot become a trusted match', () => {
  const decision = matchIngredient(
    { id: 'milk', query: 'halfvolle melk', amount: 1, unit: 'l' },
    [
      {
        id: 'overflow-pack',
        name: 'Halfvolle melk',
        packAmount: Number.MAX_VALUE,
        packUnit: 'l',
        packCount: 2,
        available: true,
      },
    ],
  )

  assert.equal(decision.type, 'abstain')
  assert.match(decision.reasons.join(' '), /effective pack amount invalid/)
})

test('base-unit conversion overflow on a candidate fails closed', () => {
  const decision = matchIngredient(
    { id: 'rice', query: 'basmati rijst', amount: 500, unit: 'g' },
    [
      {
        id: 'overflow-kg-pack',
        name: 'Basmati rijst',
        packAmount: Number.MAX_VALUE,
        packUnit: 'kg',
        packCount: 1,
        available: true,
      },
    ],
  )

  assert.equal(decision.type, 'abstain')
  assert.match(decision.reasons.join(' '), /normalized pack amount invalid/)
})

test('base-unit conversion overflow on a requirement fails closed before scoring', () => {
  const decision = matchIngredient(
    {
      id: 'rice',
      query: 'basmati rijst',
      amount: Number.MAX_VALUE,
      unit: 'kg',
    },
    [
      {
        id: 'rice-1kg',
        name: 'Basmati rijst',
        packAmount: 1,
        packUnit: 'kg',
        packCount: 1,
        available: true,
      },
    ],
  )

  assert.equal(decision.type, 'abstain')
  assert.match(
    decision.reasons.join(' '),
    /requirement amount invalid after unit conversion/,
  )
})
