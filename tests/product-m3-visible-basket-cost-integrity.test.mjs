import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Recipes,
} from '../src/data/m2Fixture.ts'
import { m3BaselineProducts, m3BaselineStore } from '../src/data/m3ComparisonFixture.ts'
import { basketCostDisclosure } from '../src/features/basket/basketPresentation.ts'

function basket(products = m3BaselineProducts, activeDays = m2DefaultActiveDays) {
  return buildOneStoreBasket({
    store: m3BaselineStore, plan: m2InitialPlan, recipes: m2Recipes, activeDays, products,
  })
}

const money = (b) => basketCostDisclosure(b.totalCents, b.unresolvedLineCount, b)

test('controlled complete and incomplete M2 basket costs remain honestly disclosed', () => {
  const complete = basket()
  assert.ok(complete.matchedLineCount > 0)
  assert.equal(complete.unresolvedLineCount, 0)
  assert.equal(money(complete).state, 'complete')
  assert.notEqual(money(complete).amountLabel, '—')

  const partial = basket([])
  assert.ok(partial.unresolvedLineCount > 0)
  assert.equal(money(partial).state, 'minimum')
  assert.match(money(partial).amountLabel, /^min\./)

  const empty = basket(m3BaselineProducts, [])
  assert.equal(empty.lines.length, 0)
  assert.equal(money(empty).state, 'complete')
  assert.match(money(empty).amountLabel, /0,00/)
})

test('synthetic stale or tampered one-store line traces never display a deterministic total', async (t) => {
  const complete = basket()
  const mutations = [
    ['a matched row total changed without basket total', (b) => {
      b.lines.find((l) => l.status === 'matched').lineTotalCents += 1
    }],
    ['negative matched line cents', (b) => {
      b.lines.find((l) => l.status === 'matched').lineTotalCents = -1
    }],
    ['unsafe matched line cents', (b) => {
      b.lines.find((l) => l.status === 'matched').lineTotalCents = Number.MAX_SAFE_INTEGER + 1
    }],
    ['matched product pack price changed', (b) => {
      b.lines.find((l) => l.status === 'matched').pricePerPackCents += 1
    }],
    ['matched pack count erased', (b) => {
      b.lines.find((l) => l.status === 'matched').packs = 0
    }],
    ['matched physical pack multiplicity corrupted', (b) => {
      b.lines.find((l) => l.status === 'matched').pack.count = 0
    }],
    ['matched requirement changed without repacking', (b) => {
      const l = b.lines.find((l) => l.status === 'matched')
      l.requirement.amount *= 100
    }],
    ['duplicate ingredient identity', (b) => { b.lines[1].id = b.lines[0].id }],
    ['matched counter does not reflect visible rows', (b) => { b.matchedLineCount -= 1 }],
    ['unresolved counter claims an extra missing row', (b) => { b.unresolvedLineCount += 1 }],
    ['matched row removed without recalculating total', (b) => { b.lines.pop() }],
    ['unsupported status in visible row', (b) => { b.lines[0].status = 'hidden' }],
  ]

  for (const [label, mutate] of mutations) {
    await t.test(label, () => {
      const current = structuredClone(complete)
      mutate(current)
      assert.equal(money(current).state, 'unknown', label)
      assert.equal(money(current).amountLabel, '—', label)
    })
  }
})

test('valid incomplete basket is also validated against its known matched minimum', () => {
  const complete = basket()
  const mixed = structuredClone(complete)
  const removed = mixed.lines.find((line) => line.status === 'matched')
  assert.ok(removed)
  mixed.lines = mixed.lines.map((line) => line.id === removed.id ? {
    id: line.id,
    ingredientLabel: line.ingredientLabel,
    requirement: line.requirement,
    status: 'unresolved',
    reasons: ['no candidates'],
    matchScore: null,
  } : line)
  mixed.matchedLineCount -= 1
  mixed.unresolvedLineCount += 1
  mixed.totalCents -= removed.lineTotalCents
  assert.equal(money(mixed).state, 'minimum')

  const stale = structuredClone(mixed)
  stale.totalCents += 1
  assert.equal(money(stale).state, 'unknown')
})

test('actual basket UI applies snapshot validation to main, baseline and candidate amounts', async () => {
  const source = await readFile(new URL('../src/features/basket/BasketView.tsx', import.meta.url), 'utf8')
  for (const name of ['basket', 'comparisonBaseline', 'comparisonCandidate']) {
    const match = new RegExp('basketCostDisclosure\\(\\s*' + name +
      '\\.totalCents,\\s*' + name + '\\.unresolvedLineCount,\\s*' + name + ',?\\s*\\)')
    assert.match(source, match, name)
  }
})
