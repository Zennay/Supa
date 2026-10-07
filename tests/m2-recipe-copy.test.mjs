import assert from 'node:assert/strict'
import test from 'node:test'

import { m2Recipes } from '../src/data/m2Fixture.ts'

test('canonical M2 recipe titles stay Dutch in the rendered planner fixture', () => {
  assert.deepEqual(
    m2Recipes.map(({ id, title }) => [id, title]),
    [
      ['tikka', 'Tikka-bowl met kip'],
      ['teriyaki', 'Teriyaki-bowl met groenten'],
      ['pasta', 'Romige tomatenpasta'],
    ],
  )

  const titles = m2Recipes.map((recipe) => recipe.title)
  assert.equal(titles.includes('Tikka chicken bowl'), false)
  assert.equal(titles.includes('Teriyaki veggie bowl'), false)
  assert.equal(titles.includes('Creamy tomato pasta'), false)
})
