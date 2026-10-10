import { useState } from 'react'
import type { PlannedMeal } from '../../domain/types.ts'
import type { RecipeWithIngredients } from '../../domain/basket.ts'
import { previewRecipeReuseChange } from '../../domain/ingredientReusePreview.ts'
import { IngredientReusePreviewCard } from './IngredientReusePreviewCard.tsx'
import './recipe-reuse-preview-panel.css'

/**
 * Optional, non-destructive recipe comparison.
 *
 * The user's real week remains owned by PlannerView's onRecipeChange handler.
 * Preview controls never call that handler or write preferences. Only the
 * separate explicit, validated "Kies" button invokes onChooseRecipe;
 * no price, leftover, or savings claim is inferred.
 */
export function RecipeReusePreviewPanel({
  plannedMeals,
  activeDays,
  recipes,
  onChooseRecipe,
}: {
  plannedMeals: PlannedMeal[]
  activeDays: string[]
  recipes: RecipeWithIngredients[]
  onChooseRecipe: (day: string, recipeId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [requestedDay, setRequestedDay] = useState<string | null>(null)
  const [requestedRecipe, setRequestedRecipe] = useState<string | null>(null)
  const [confirmedSource, setConfirmedSource] = useState<{
    day: string
    recipeId: string
    weekKey: string
  } | null>(null)

  if (!Array.isArray(plannedMeals) || !Array.isArray(activeDays) ||
      !Array.isArray(recipes) || activeDays.length === 0 || recipes.length < 2) {
    return null
  }

  const days = activeDays.filter((day) =>
    typeof day === 'string' &&
    plannedMeals.filter((meal) => meal?.day === day).length === 1,
  )
  if (days.length === 0) return null

  // Derived selections recover from changes in the *current* active plan.
  // Never reuse a stale day/recipe identity for an unrelated week.
  const day = requestedDay !== null && days.includes(requestedDay)
    ? requestedDay : days[0]
  const currentMeal = plannedMeals.find((meal) => meal.day === day)
  if (!currentMeal) return null
  const alternatives = recipes.filter((recipe) =>
    typeof recipe?.id === 'string' && recipe.id !== currentMeal.recipeId,
  )
  if (alternatives.length === 0) return null
  const recipeId =
    requestedRecipe !== null && alternatives.some((recipe) => recipe.id === requestedRecipe)
      ? requestedRecipe : alternatives[0].id

  // The proposed overlap depends on *all* active meals, not just the
  // selected day's source recipe. A change on Tuesday can alter a Monday
  // proposal too; require a fresh user confirmation before enabling Apply.
  // Build a primitive-only identity: unexpected runtime objects cannot turn
  // JSON.stringify into a crash or an authorization for an old proposal.
  const weekKey = JSON.stringify(activeDays.map((activeDay) => [
    typeof activeDay === 'string' ? activeDay : null,
    plannedMeals.filter((meal) => meal?.day === activeDay)
      .map((meal) => typeof meal?.recipeId === 'string' ? meal.recipeId : null),
  ]))

  // A previously chosen day/recipe may disappear when the real plan changes.
  // Do not silently turn an old proposal into an actionable different one.
  // The user must explicitly refresh the suggestion before applying it.
  const staleSelection =
    (requestedDay !== null && !days.includes(requestedDay)) ||
    (requestedRecipe !== null &&
      !alternatives.some((recipe) => recipe.id === requestedRecipe)) ||
    (confirmedSource !== null &&
      (confirmedSource.day !== day ||
        confirmedSource.recipeId !== currentMeal.recipeId ||
        confirmedSource.weekKey !== weekKey))

  const preview = expanded && !staleSelection
    ? previewRecipeReuseChange({
        plan: plannedMeals,
        recipes,
        activeDays,
        day,
        recipeId,
      })
    : null

  return (
    <section className="recipe-reuse-preview-panel" aria-label="Een ander recept bekijken">
      <button
        type="button"
        className="recipe-reuse-preview-toggle"
        aria-expanded={expanded}
        aria-controls="recipe-reuse-preview-content"
        onClick={() => {
          if (!expanded) {
            // Opening begins a fresh proposal against the current recipe.
            setRequestedDay(null)
            setRequestedRecipe(null)
            const openingDay = days[0]
            const openingMeal = plannedMeals.find((meal) => meal?.day === openingDay)
            setConfirmedSource({
              day: openingDay,
              recipeId: openingMeal?.recipeId ?? '',
              weekKey,
            })
          }
          setExpanded((value) => !value)
        }}
      >
        {expanded ? 'Verberg receptvoorbeeld' : 'Bekijk een ander recept zonder te wijzigen'}
      </button>
      {expanded && (
        <div id="recipe-reuse-preview-content" className="recipe-reuse-preview-content">
          <div className="recipe-reuse-preview-fields">
            <label htmlFor="reuse-preview-day">
              Dag bekijken
              <select
                id="reuse-preview-day"
                value={day}
                onChange={(event) => {
                  setRequestedDay(event.target.value)
                  setRequestedRecipe(null)
                  setConfirmedSource({
                    day: event.target.value,
                    recipeId: plannedMeals.find((meal) => meal?.day === event.target.value)?.recipeId ?? '',
                    weekKey,
                  })
                }}
              >
                {days.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label htmlFor="reuse-preview-recipe">
              Alternatief recept bekijken
              <select
                id="reuse-preview-recipe"
                value={recipeId}
                onChange={(event) => setRequestedRecipe(event.target.value)}
              >
                {alternatives.map((option) => (
                  <option key={option.id} value={option.id}>{option.title}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="recipe-reuse-preview-note">
            Je planning blijft hetzelfde. Dit laat alleen gedeelde ingrediënten zien,
            geen boodschappenprijzen of bewezen besparing.
          </p>
          {staleSelection && (
            <div className="recipe-reuse-preview-refresh" role="status">
              <p>Je planning is veranderd. Bekijk het voorstel opnieuw voordat je een recept kiest.</p>
              <button
                type="button"
                className="recipe-reuse-preview-apply"
                onClick={() => {
                  setRequestedDay(null)
                  setRequestedRecipe(null)
                  const freshDay = days[0]
                  setConfirmedSource({
                    day: freshDay,
                    recipeId: plannedMeals.find((meal) => meal?.day === freshDay)?.recipeId ?? '',
                    weekKey,
                  })
                }}
              >
                Werk voorbeeld bij
              </button>
            </div>
          )}
          <IngredientReusePreviewCard preview={preview} />
          {preview !== null && (
            <button
              type="button"
              className="recipe-reuse-preview-apply"
              onClick={() => {
                // Only a confirmed, current proposal can mutate the week.
                onChooseRecipe(day, recipeId)
                setExpanded(false)
              }}
            >
              Kies {alternatives.find((recipe) => recipe.id === recipeId)?.title} voor {day}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
