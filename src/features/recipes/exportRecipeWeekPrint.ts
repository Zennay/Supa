import type { SavedRecipe } from './recipeLibrary.ts'
import { formatOwnRecipeChecklist, type OwnRecipeChecklist } from './recipeShoppingChecklist.ts'

export type RecipeWeekAssignment = {
  day: string
  recipeId: string
  title: string
  servings: number | null
}

/**
 * Download-only, script-free paper cooking plan. Uses the SAME complete
 * unpriced ingredients that the existing recipe collection presents. The
 * caller must supply a strictly approved physical-demand checklist, never a
 * retailer projection or unreviewed substitution.
 */
export function exportRecipeWeekPrint(
  assignments: readonly RecipeWeekAssignment[],
  recipes: readonly SavedRecipe[],
  days: readonly string[],
  checklist: OwnRecipeChecklist,
): string {
  if (!assignments.length || assignments.length > days.length ||
      days.length !== 7 || new Set(days).size !== days.length ||
      !checklist.canCopy || !checklist.lines.length ||
      checklist.lines.some(line => line.needsReview || line.amount === null ||
        !Number.isFinite(line.amount) || line.amount <= 0 ||
        !['g', 'ml', 'piece'].includes(line.unit ?? '')) ||
      checklist.recipeCount !== assignments.length) {
    throw new Error('Controleer eerst alle recepten en de volledige fysieke boodschappen.')
  }
  const byId = new Map(recipes.map(recipe => [recipe.id, recipe]))
  const seenDays = new Set<string>()
  const seenRecipes = new Set<string>()
  const week = assignments.map(assignment => {
    const recipe = byId.get(assignment.recipeId)
    if (!recipe || !days.includes(assignment.day) || seenDays.has(assignment.day) ||
        seenRecipes.has(assignment.recipeId) || recipe.title !== assignment.title ||
        !Number.isSafeInteger(assignment.servings) ||
        assignment.servings !== recipe.servings ||
        !Number.isFinite(recipe.minutes) || (recipe.minutes ?? 0) <= 0 ||
        !Array.isArray(recipe.steps) || !recipe.steps.length ||
        recipe.steps.some(step => typeof step !== 'string' || !step.trim())) {
      throw new Error('Een recept of weekdag is gewijzigd. Maak eerst een actueel weekmenu.')
    }
    seenDays.add(assignment.day)
    seenRecipes.add(assignment.recipeId)
    return { ...assignment, recipe }
  })
  const escape = (input: string): string => input.replace(/&/g, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
  const slots = days.map(day => {
    const row = week.find(item => item.day === day)
    return '<li><strong>' + escape(day) + '</strong>: ' +
      (row ? escape(row.recipe.title) + ' · ' + row.servings + ' porties'
        : 'Geen recept gekozen') + '</li>'
  }).join('')
  const instructions = week.map(({ day, recipe }) =>
    '<section><h3>' + escape(day) + ' — ' + escape(recipe.title) + '</h3>' +
    '<p>' + recipe.servings + ' porties · ' + recipe.minutes +
    ' minuten · eigen recept</p><ol>' +
    recipe.steps.map(step => '<li>' + escape(step) + '</li>').join('') +
    '</ol></section>').join('')
  const groceries = formatOwnRecipeChecklist(checklist, {}, false)
  const html = '<!doctype html><html lang="nl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Mijn Supa weekmenu en boodschappen</title>' +
    '<style>body{font:16px/1.5 system-ui,sans-serif;max-width:820px;margin:auto;padding:24px;color:#222}' +
    'h1,h2,h3{line-height:1.25}section{break-inside:avoid;margin-block:1.4em}li{margin-block:.4em}' +
    'pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;padding:16px;border:1px solid #ccc}' +
    'small{display:block;margin-block:1em} @media print{body{padding:0}section{break-inside:avoid}}</style>' +
    '</head><body><h1>Mijn Supa conceptweekmenu</h1>' +
    '<p><strong>Concept, niet opgeslagen in Planner.</strong> Privé en ongeprijsd. ' +
    'De gebruikte receptingrediënten zijn gecontroleerd, maar winkelverpakkingen, ' +
    'SKU’s, beschikbaarheid, actuele prijzen en besparingen zijn onbekend.</p>' +
    '<h2>Weekoverzicht</h2><ul>' + slots + '</ul>' +
    '<h2>Gecombineerde boodschappen</h2><pre>' + escape(groceries) + '</pre>' +
    '<h2>Bereiding per recept</h2>' + instructions +
    '<small>Alleen voor eigen gebruik. Deze afdruk is geen bewijs van bronrechten, ' +
    'productmatching of winkelprijs.</small></body></html>'
  if (new TextEncoder().encode(html).length > 512_000)
    throw new Error('Het printbare weekmenu is te groot voor één privébestand.')
  return html
}
