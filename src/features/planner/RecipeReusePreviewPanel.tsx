import { useEffect, useState } from 'react'
import type { PlannedMeal } from '../../domain/types.ts'
import type { RecipeWithIngredients } from '../../domain/basket.ts'
import { previewRecipeReuseChange } from '../../domain/ingredientReusePreview.ts'
import { IngredientReusePreviewCard } from './IngredientReusePreviewCard.tsx'
import { recipeShoppingChange } from './recipeShoppingChange.ts'
import { RecipeShoppingChangePanel } from './RecipeShoppingChangePanel.tsx'
import './recipe-reuse-preview-panel.css'

/**
 * Optional, non-destructive recipe comparison.
 *
 * The user's real week remains owned by PlannerView's onRecipeChange handler.
 * Preview has no side effects; only the user's explicit recipe choice calls
 * the Planner handler. The physical shopping delta is never a price claim.
 */
export function RecipeReusePreviewPanel({
  plannedMeals,
  activeDays,
  recipes,
  onChooseRecipe,
  onOpenComparison,
  onOpenList,
  onImportSourceFiles,
}: {
  plannedMeals: PlannedMeal[]
  activeDays: string[]
  recipes: RecipeWithIngredients[]
  onChooseRecipe: (day: string, recipeId: string) => void
  onOpenComparison: () => void
  onOpenList: () => void
  onImportSourceFiles: (files: File[]) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [requestedDay, setRequestedDay] = useState<string | null>(null)
  const [requestedRecipe, setRequestedRecipe] = useState<string | null>(null)
  const [importNotice, setImportNotice] = useState('')
  const [pendingImport, setPendingImport] = useState<{
    files: File[]
    beforePlan: string
    expectedPlan: string
    activeDays: string
    recipes: string
  } | null>(null)
  const currentPlan = JSON.stringify(plannedMeals)
  const currentDays = JSON.stringify(activeDays)
  const currentRecipes = JSON.stringify(recipes.map(recipe => [recipe.id, recipe.ingredients]))
  useEffect(() => {
    if (!pendingImport) return
    if (pendingImport.activeDays !== currentDays ||
        pendingImport.recipes !== currentRecipes ||
        (currentPlan !== pendingImport.expectedPlan && currentPlan !== pendingImport.beforePlan)) {
      setPendingImport(null)
      setImportNotice('Het weekmenu is veranderd. Kies de bronbestanden opnieuw voor je actuele planning.')
      return
    }
    // Source files must be handed to the existing canonical importer ONLY
    // after App has installed the newly selected recipe and planKey. Doing
    // this in the file-input handler would bind evidence to the old week.
    if (currentPlan === pendingImport.expectedPlan) {
      setPendingImport(null)
      onImportSourceFiles(pendingImport.files)
    }
  }, [pendingImport, currentPlan, currentDays, currentRecipes, onImportSourceFiles])


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
  const shoppingPreview = expanded ? recipeShoppingChange({
    plan: plannedMeals, recipes, activeDays, day, recipeId,
  }) : null
  const canApply = preview !== null && shoppingPreview?.status === 'ready'
  function apply(nextScreen: 'planner' | 'compare' | 'list') {
    // Both previews are derived from this render's actual active Planner
    // state. Do not apply a candidate with unknown quantities or identities.
    if (!canApply) return
    onChooseRecipe(day, recipeId)
    setExpanded(false)
    if (nextScreen === 'compare') onOpenComparison()
    if (nextScreen === 'list') onOpenList()
  }

  function chooseAndImport(files: File[]) {
    setImportNotice('')
    if (!files.length) return // Closing the file picker never alters a recipe.
    if (!canApply) {
      setImportNotice('Het voorstel is gewijzigd of de fysieke hoeveelheden zijn onzeker. Controleer de recepten eerst.')
      return
    }
    if (files.length > 2 || files.some(file => file.size < 1 || file.size > 256_000)) {
      setImportNotice('Kies maximaal twee gevulde bronbestanden van elk maximaal 256 kB.')
      return
    }
    const expectedPlan = JSON.stringify(plannedMeals.map(meal =>
      meal.day === day ? { ...meal, recipeId } : { ...meal }))
    if (expectedPlan === currentPlan) {
      setImportNotice('Je receptvoorstel is niet gewijzigd. Gebruik de bestaande bronimport in Vergelijk.')
      return
    }
    setPendingImport({
      files, beforePlan: currentPlan, expectedPlan,
      activeDays: currentDays, recipes: currentRecipes,
    })
    onChooseRecipe(day, recipeId)
    setExpanded(false)
  }
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
      {importNotice && <p role="status" aria-live="polite">{importNotice}</p>}
      {pendingImport && <p role="status">Nieuw recept verwerken; daarna opent de bestaande bronimport…</p>}
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
          {shoppingPreview && <RecipeShoppingChangePanel preview={shoppingPreview} day={day} />}
          {canApply && <div className="recipe-reuse-preview-shopping__actions">
            <button type="button" className="recipe-reuse-preview-apply"
              onClick={() => apply('planner')}>
              Kies {alternatives.find((recipe) => recipe.id === recipeId)?.title} voor {day}
            </button>
            <button type="button" className="recipe-reuse-preview-apply"
              onClick={() => apply('compare')}>
              Kies recept en controleer PLUS/Deka-prijzen
            </button>
            <label className="recipe-reuse-preview-import">
              <strong>Kies recept en importeer mijn eigen PLUS/Deka-bronopnames</strong>
              <small>De nieuwe weekplanning wordt pas gekozen zodra je bestanden selecteert.
                Bij annuleren verandert er niets. Daarna openen de bestaande broncontrole,
                productmatching en volledige twee-winkelvergelijking; prijzen worden niet automatisch bevestigd.</small>
              <input type="file" multiple
                accept=".csv,.tsv,.txt,.json,text/csv,text/plain,text/tab-separated-values,application/json"
                onChange={event => {
                  const files = Array.from(event.currentTarget.files ?? [])
                  event.currentTarget.value = ''
                  chooseAndImport(files)
                }} />
            </label>
            <button type="button" className="recipe-reuse-preview-apply"
              onClick={() => apply('list')}>
              Kies recept en open Boodschappenlijst
            </button>
          </div>}
        </div>
      )}
    </section>
  )
}
