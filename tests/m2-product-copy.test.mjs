import assert from 'node:assert/strict'
import test from 'node:test'

import { m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

test('controlled M2 product and ingredient labels stay natural Dutch without changing matching queries', () => {
  const productsById = new Map(m2Products.map((product) => [product.id, product]))

  assert.equal(productsById.get('basmati-1kg')?.name, 'Basmatirijst 1 kg')
  assert.equal(productsById.get('teriyaki-250')?.name, 'Teriyakisaus 250 ml')

  const ingredients = m2Recipes.flatMap((recipe) => recipe.ingredients)
  const ingredientsById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]))

  assert.deepEqual(
    {
      label: ingredientsById.get('basmati-rice')?.label,
      query: ingredientsById.get('basmati-rice')?.query,
    },
    { label: 'Basmatirijst', query: 'basmati rijst' },
  )
  assert.deepEqual(
    {
      label: ingredientsById.get('teriyaki-sauce')?.label,
      query: ingredientsById.get('teriyaki-sauce')?.query,
    },
    { label: 'Teriyakisaus', query: 'teriyaki saus' },
  )

  const renderedCopy = [
    ...m2Products.map((product) => product.name),
    ...ingredients.map((ingredient) => ingredient.label),
  ].join('\n')
  assert.doesNotMatch(renderedCopy, /Basmati rijst/)
  assert.doesNotMatch(renderedCopy, /Teriyaki saus/)
})
