import assert from 'node:assert/strict'
import test from 'node:test'

import { basket, plan, recipes, stores } from '../src/data/mock.ts'
import { mockRepository } from '../src/data/mockRepository.ts'

test('canonical legacy mock fixtures reject direct runtime mutation', () => {
  assert.throws(() => {
    stores[0].name = 'Poisoned store'
  }, TypeError)
  assert.throws(() => {
    stores.push({ id: 'store-c', name: 'Poisoned store' })
  }, TypeError)

  assert.throws(() => {
    recipes[0].title = 'Poisoned recipe'
  }, TypeError)
  assert.throws(() => {
    recipes[0].tags.push('poisoned')
  }, TypeError)
  assert.throws(() => {
    plan[0].day = 'Poisoned day'
  }, TypeError)

  assert.throws(() => {
    basket.store.name = 'Poisoned basket store'
  }, TypeError)
  assert.throws(() => {
    basket.lines[0].price = 999
  }, TypeError)
  assert.throws(() => {
    basket.lines.push({
      id: 'poisoned',
      label: 'Poisoned line',
      quantity: '1 st',
      price: 999,
      source: 'mock',
      observedAt: '2026-09-26T12:00:00Z',
    })
  }, TypeError)
})

test('failed direct fixture mutations cannot poison later repository snapshots', async () => {
  assert.throws(() => {
    recipes[0].tags.push('poisoned')
  }, TypeError)
  assert.throws(() => {
    basket.lines[0].price = 999
  }, TypeError)

  const recipeSnapshot = await mockRepository.getRecipes()
  const basketSnapshot = await mockRepository.getBasket()

  assert.equal(recipeSnapshot[0].title, 'Tikka chicken bowl')
  assert.deepEqual(recipeSnapshot[0].tags, ['budget', 'meal-prep'])
  assert.equal(basketSnapshot.store.name, 'Supermarkt A')
  assert.equal(basketSnapshot.lines[0].price, 6.49)

  recipeSnapshot[0].title = 'Local mutation remains allowed'
  basketSnapshot.lines[0].price = 123

  const laterRecipeSnapshot = await mockRepository.getRecipes()
  const laterBasketSnapshot = await mockRepository.getBasket()

  assert.equal(laterRecipeSnapshot[0].title, 'Tikka chicken bowl')
  assert.equal(laterBasketSnapshot.lines[0].price, 6.49)
})
