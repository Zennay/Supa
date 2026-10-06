import assert from 'node:assert/strict'
import test from 'node:test'

import { mockRepository } from '../src/data/mockRepository.ts'

test('mock repository returns isolated recipe snapshots', async () => {
  const first = await mockRepository.getRecipes()
  first[0].title = 'Mutated title'
  first[0].tags.push('mutated')

  const second = await mockRepository.getRecipes()

  assert.equal(second[0].title, 'Tikka chicken bowl')
  assert.deepEqual(second[0].tags, ['budget', 'meal-prep'])
  assert.notStrictEqual(second, first)
  assert.notStrictEqual(second[0], first[0])
  assert.notStrictEqual(second[0].tags, first[0].tags)
})

test('mock repository returns isolated plan snapshots', async () => {
  const first = await mockRepository.getPlan()
  first[0].day = 'Mutated day'

  const second = await mockRepository.getPlan()

  assert.equal(second[0].day, 'Ma')
  assert.notStrictEqual(second, first)
  assert.notStrictEqual(second[0], first[0])
})

test('mock repository returns isolated basket snapshots', async () => {
  const first = await mockRepository.getBasket()
  first.store.name = 'Mutated store'
  first.lines[0].price = 999

  const second = await mockRepository.getBasket()

  assert.equal(second.store.name, 'Supermarkt A')
  assert.equal(second.lines[0].price, 6.49)
  assert.notStrictEqual(second, first)
  assert.notStrictEqual(second.store, first.store)
  assert.notStrictEqual(second.lines, first.lines)
  assert.notStrictEqual(second.lines[0], first.lines[0])
})
