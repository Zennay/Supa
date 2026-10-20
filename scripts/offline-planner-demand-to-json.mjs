#!/usr/bin/env node
/**
 * Convert explicit, user-owned selected-week recipe data into the exact
 * unpriced demand used by the private two-store basket report.
 *
 * Uses Supa's canonical ingredient aggregation instead of recomputing amounts.
 * Never generates retailer product IDs, timestamps, prices or permissions.
 */
import { open, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { aggregatePlanIngredients } from '../src/domain/basket.ts'

const MAX_BYTES = 256_000
const UNITS = ['g', 'kg', 'ml', 'l', 'piece']
const validText = (value, max = 160) =>
  typeof value === 'string' && value.length > 0 && value.length <= max &&
  value === value.trim() && /[\p{L}\p{N}]/u.test(value) &&
  !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value) &&
  !/^[=+@-]/u.test(value)

async function readPrivateFile(path) {
  if (!Number.isInteger(constants.O_NOFOLLOW)) throw Error('Unsafe environment')
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_BYTES) throw Error('Invalid size')
    const bytes = await handle.readFile()
    if (!bytes.length || bytes.length > MAX_BYTES) throw Error('Invalid size')
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } finally { await handle.close() }
}

function validateWeek(text) {
  const root = JSON.parse(text)
  if (!root || Array.isArray(root) || typeof root !== 'object' ||
      root.schema !== 'supa-private-planner-week-v1' ||
      Object.keys(root).some(key => !['schema', 'plan', 'activeDays', 'recipes'].includes(key)) ||
      !Array.isArray(root.plan) || root.plan.length < 1 || root.plan.length > 14 ||
      !Array.isArray(root.activeDays) || root.activeDays.length < 1 ||
      root.activeDays.length > 14 || !Array.isArray(root.recipes) ||
      root.recipes.length < 1 || root.recipes.length > 150) throw Error('Invalid private week')
  if (new Set(root.activeDays).size !== root.activeDays.length ||
      !root.activeDays.every(day => validText(day, 40))) throw Error('Invalid active days')
  if (!root.plan.every(meal =>
    meal && typeof meal === 'object' && !Array.isArray(meal) &&
    Object.keys(meal).every(key => ['day','recipeId'].includes(key)) &&
    validText(meal.day, 40) && validText(meal.recipeId, 100))) {
    throw Error('Invalid planned meals')
  }
  if (!root.recipes.every(recipe =>
    recipe && typeof recipe === 'object' && !Array.isArray(recipe) &&
    Object.keys(recipe).every(key => ['id','ingredients'].includes(key)) &&
    validText(recipe.id, 100) && Array.isArray(recipe.ingredients) &&
    recipe.ingredients.length <= 1000 &&
    recipe.ingredients.every(item =>
      item && typeof item === 'object' && !Array.isArray(item) &&
      Object.keys(item).every(key => ['id','label','query','amount','unit'].includes(key)) &&
      validText(item.id,100) && validText(item.label) && validText(item.query) &&
      UNITS.includes(item.unit) && (item.amount === null ||
        (typeof item.amount === 'number' && Number.isFinite(item.amount) &&
          item.amount > 0 && item.amount <= 100_000))))) {
    throw Error('Invalid recipe ingredients')
  }
  // Canonical domain requires a single defined identity for each day and recipe,
  // consistent units and labels across multiple meals, and exact decimal sums.
  if (new Set(root.recipes.map(recipe => recipe.id)).size !== root.recipes.length) {
    throw Error('Ambiguous recipes')
  }
  return root
}

function toBasketDemand(week) {
  const ingredients = aggregatePlanIngredients(week.plan, week.recipes, week.activeDays)
  if (!ingredients.length || ingredients.length > 1000 ||
      ingredients.some(item => item.amount !== null &&
        (!Number.isFinite(item.amount) || item.amount <= 0 || item.amount > 100_000))) {
    throw Error('Canonical demand exceeds local report bounds')
  }
  const result = {
    schema: 'supa-private-basket-demand-v1',
    selectedMealCount: week.activeDays.length,
    ingredients: ingredients.map(item => ({
      id: item.id,
      label: item.label,
      amount: item.amount,
      unit: item.unit,
      productIds: { PLUS: null, DekaMarkt: null },
    })),
  }
  const json = JSON.stringify(result, null, 2) + '\n'
  if (new TextEncoder().encode(json).length > MAX_BYTES) throw Error('Result too large')
  return { json, count: result.ingredients.length }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args.some(arg => !arg || arg.startsWith('-'))) {
    throw Error('Expected private week and new demand output')
  }
  const input = resolve(args[0])
  const output = resolve(args[1])
  if (input === output) throw Error('Output must differ')
  const week = validateWeek(await readPrivateFile(input))
  const { json, count } = toBasketDemand(week)
  await writeFile(output, json, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  process.stdout.write(count + ' samengevoegde ingrediëntbehoeften zonder product-ID of prijs opgeslagen. ' +
    'Controleer jouw echte winkelproductmatches apart voordat de mand vergelijkbaar wordt.\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write('Omzetten van privé-weekmenu mislukt: controleer echte maaltijden, hoeveelheden, receptidentiteiten, eenheden en nieuw uitvoerpad. Geen bestand overschreven.\n')
    process.exitCode = 1
  })
}
