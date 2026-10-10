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
 * This panel never calls that handler or writes preferences: it only compares
 * the current recipe identities, and no money/leftover claim is inferred.
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

  const preview = expanded
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
        onClick={() => setExpanded((value) => !value)}
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
