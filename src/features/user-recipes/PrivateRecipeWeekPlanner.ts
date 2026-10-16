import { createElement } from 'react'
import type { ChangeEvent } from 'react'
import type { UnpricedPrivateRecipe } from './reviewedRecipeBasketBridge.ts'
import {
  createPrivateRecipeWeekPreview,
  privateWeekDays,
  type PrivateWeekSelection,
  type PrivateWeekDay,
} from './privateWeekPlanner.ts'
import { UnpricedPrivateShoppingPreviewView } from './UnpricedPrivateShoppingPreviewView.ts'

/**
 * Opt-in controlled mobile seven-day planner for PRIVATE reviewed recipes.
 * Composable without modifying the active M3 App.tsx owner's route.
 * The host owns selection state; this component writes no storage and calls
 * no APIs, browser clipboard or printing capability.
 */
export function PrivateRecipeWeekPlanner({
  recipes,
  selection,
  onSelectionChange,
}: {
  recipes: readonly UnpricedPrivateRecipe[]
  selection: PrivateWeekSelection
  onSelectionChange: (updated: Record<string, string | null>) => void
}) {
  const result = createPrivateRecipeWeekPreview(recipes, selection)

  const safeRecipes = Array.isArray(recipes)
    ? recipes.filter((recipe) => recipe && /^private-recipe:[A-Za-z0-9_-]{1,64}$/.test(recipe.id))
    : []

  function chooseDay(day: PrivateWeekDay, event: ChangeEvent<HTMLSelectElement>) {
    const nextId = event.currentTarget.value
    if (nextId !== '' && !safeRecipes.some((recipe) => recipe.id === nextId)) return
    if (result.status === 'review_required' && result.reason === 'invalid_selection') return
    const next: Record<string, string | null> = {}
    for (const currentDay of privateWeekDays) {
      const old = Object.getOwnPropertyDescriptor(selection, currentDay)
      next[currentDay] = typeof old?.value === 'string' && old.value !== ''
        ? old.value : null
    }
    next[day] = nextId || null
    onSelectionChange(next)
  }

  const editors = privateWeekDays.map((day) => {
    const id = 'supa-private-week-' + day.toLowerCase()
    const chosen = Object.getOwnPropertyDescriptor(selection, day)?.value
    const options = [
      createElement('option', { key:'empty', value:'' }, 'Geen recept'),
      ...safeRecipes.map((recipe) =>
        createElement('option', { key:recipe.id, value:recipe.id }, recipe.title)),
    ]
    return createElement('div', { key:day, className:'private-week-day' }, [
      createElement('label', { key:'label', htmlFor:id }, day),
      createElement('select', {
        key:'select', id, value: typeof chosen === 'string' ? chosen : '',
        onChange: (event: ChangeEvent<HTMLSelectElement>) => chooseDay(day, event),
        'aria-label': 'Recept voor ' + day,
      }, options),
    ])
  })

  return createElement('section', { 'aria-label':'Mijn recepten in de weekplanner' }, [
    createElement('h2', { key:'title' }, 'Mijn recepten plannen'),
    createElement('p', { key:'intro' },
      'Kies voor elke dag een eigen recept. Winkels, actuele prijzen en besparing blijven onbekend.'),
    createElement('fieldset', { key:'days' }, [
      createElement('legend', { key:'legend' }, 'Weekplanning'),
      ...editors,
    ]),
    result.status === 'preview_ready'
      ? createElement(UnpricedPrivateShoppingPreviewView, { key:'list', preview:result.preview })
      : createElement('p', { key:'note', role:'status' },
          result.reason === 'no_recipes_selected'
            ? 'Kies ten minste één recept om boodschappen te bekijken.'
            : 'Controleer de recepten en dagkeuzes voordat je de lijst bekijkt.'),
  ])
}
