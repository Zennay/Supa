import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createManualRecipeDraft, importRecipeFromHtml, normalizeIngredientLine,
} from '../src/domain/userRecipeImport.ts'

test('manual recipes normalize kilograms, liters, decimal comma and pieces', () => {
  const draft = createManualRecipeDraft({
    title: ' Mijn tikka-bowl ',
    servings: 2,
    minutes: 25,
    ingredients: ['1/2 kg kippendij', '0,4 l kokosmelk', '2 uien', '250 g rijst'],
    steps: ['Snijd de ui', 'Bak de kip'],
  })
  assert.equal(draft.source, 'manual')
  assert.equal(draft.status, 'needs_review')
  assert.equal(draft.title, 'Mijn tikka-bowl')
  assert.deepEqual(draft.ingredients.map(x => [x.amount, x.unit]), [
    [500, 'g'], [400, 'ml'], [2, 'piece'], [250, 'g'],
  ])
  assert.deepEqual(draft.steps, ['Snijd de ui', 'Bak de kip'])
  assert.deepEqual(draft.warnings, [])
  assert.equal('estimatedCost' in draft, false, 'no fabricated grocery prices')
})

test('unknown cups and arbitrary ingredient measures fail closed instead of guessing grams', () => {
  const draft = createManualRecipeDraft({
    title: 'Onbekende maten', ingredients: ['1 cup bloem', '2 eetlepels suiker', 'zout naar smaak'],
  })
  assert.deepEqual(draft.ingredients.map(x => x.amount), [null, null, null])
  assert.ok(draft.warnings.some(x => x.includes('metrische')))
  assert.equal(normalizeIngredientLine('2 uien').unit, 'piece')
  assert.equal(normalizeIngredientLine('1 1/2 kg bloem').amount, 1500)
  assert.equal(normalizeIngredientLine('½ l melk').amount, 500)
  assert.equal(normalizeIngredientLine('2 oz kaas').unit, 'g')
  assert.equal(normalizeIngredientLine('2 oz kaas').amount, 56.699)
})

test('URL import extracts Recipe from nested JSON-LD graph and keeps ingredient evidence', () => {
  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', name: 'Recipes' },
      {
        '@type': ['WebPage', 'Recipe'],
        name: 'Tikka in 30 minuten',
        totalTime: 'PT30M',
        recipeYield: '2 porties',
        recipeIngredient: ['300 g kip', '200 ml kokosmelk', '1 tsp curry', '1 ui'],
        recipeInstructions: [
          { '@type': 'HowToStep', text: 'Snijd de kip' },
          { '@type': 'HowToSection', itemListElement: [
            { '@type': 'HowToStep', text: 'Bak de kip' },
          ] },
        ],
      },
    ],
  }
  const html = '<html><script type="application/ld+json">' + JSON.stringify(schema) + '</script></html>'
  const draft = importRecipeFromHtml(html, 'https://recepten.example/tikka')
  assert.equal(draft.source, 'url')
  assert.equal(draft.sourceUrl, 'https://recepten.example/tikka')
  assert.equal(draft.title, 'Tikka in 30 minuten')
  assert.equal(draft.servings, 2)
  assert.equal(draft.minutes, 30)
  assert.deepEqual(draft.steps, ['Snijd de kip', 'Bak de kip'])
  assert.deepEqual(draft.ingredients.map(x => x.amount), [300, 200, null, 1])
  assert.deepEqual(draft.ingredients.map(x => x.unit), ['g', 'ml', null, 'piece'])
  assert.equal(draft.ingredients[2].original, '1 tsp curry')
  assert.ok(draft.warnings[0].includes('Ingrediënt 3'))
  assert.equal(draft.status, 'needs_review')
})

test('URL import handles JSON-LD array, bad preceding JSON and no fabricated missing durations', () => {
  const html = '<script type=application/ld+json>{broken</script>' +
    "<script type='application/ld+json'>" + JSON.stringify([
      { '@type': 'Article', headline: 'No recipe' },
      { '@type': 'https://schema.org/Recipe', name: 'Soep', recipeIngredient: ['1 l water'],
        recipeInstructions: 'Kook en roer.' },
    ]) + '</script>'
  const draft = importRecipeFromHtml(html, 'https://recipes.example/soep')
  assert.equal(draft.ingredients[0].amount, 1000)
  assert.equal(draft.ingredients[0].unit, 'ml')
  assert.equal(draft.servings, null)
  assert.equal(draft.minutes, null)
  assert.equal(draft.warnings.length, 2)
  assert.deepEqual(draft.steps, ['Kook en roer.'])
})

test('malformed recipes, unsafe schemes and oversized markup are refused', () => {
  const html = '<script type="application/ld+json">' +
    JSON.stringify({ '@type': 'Recipe', name: 'A', recipeIngredient: ['1 g b'] }) +
    '</script>'
  assert.throws(() => importRecipeFromHtml(html, 'http://recipes.example'), /HTTPS/)
  assert.throws(() => importRecipeFromHtml(html, 'file:///etc/passwd'), /HTTPS/)
  assert.throws(() => importRecipeFromHtml(html, 'https://u:p@recipes.example'), /HTTPS/)
  assert.throws(() => importRecipeFromHtml('a'.repeat(512001), 'https://recipes.example'), /groot/)
  assert.throws(() => importRecipeFromHtml('<p>Geen metadata</p>', 'https://recipes.example'), /Geen schema/)
  assert.throws(() => createManualRecipeDraft({ title: '', ingredients: ['1 g b'] }), /titel/)
  assert.throws(() => createManualRecipeDraft({ title: 'x', ingredients: [] }), /ingrediënten/)
})

test('structured types in a nonrecipe script do not execute or become recipes', () => {
  const html = '<script>alert("evil")</script>' +
    '<script type="application/json">' + JSON.stringify({
      '@type': 'Recipe', name: 'Wrong', recipeIngredient: ['300 g kippendij'],
    }) + '</script>'
  assert.throws(() => importRecipeFromHtml(html, 'https://recipes.example'), /Geen schema/)
})

test('uncertain quantities retain original data for user correction', () => {
  const item = normalizeIngredientLine('een snufje kaneel')
  assert.equal(item.amount, null)
  assert.equal(item.unit, null)
  assert.equal(item.original, 'een snufje kaneel')
  const noLabel = normalizeIngredientLine('200 g')
  assert.equal(noLabel.amount, null)
  assert.ok(noLabel.reviewReason)
})
