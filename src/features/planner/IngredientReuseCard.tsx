import type { IngredientReuseInsight } from '../../domain/ingredientReuse.ts'
import './ingredient-reuse.css'

/**
 * Read-only ingredient overlap explanation for the planner.
 * The parent must recalculate the insight from the current active plan.
 */
export function IngredientReuseCard({
  insight,
}: {
  insight: IngredientReuseInsight | null
}) {
  return (
    <section className="ingredient-reuse-card" aria-label="Ingrediënten opnieuw gebruiken">
      <h3>Handig gecombineerd</h3>
      {insight === null ? (
        <p role="status">Maak eerst een geldige planning om gedeelde ingrediënten te bekijken.</p>
      ) : insight.reusedIngredients.length === 0 ? (
        <p>In deze gekozen maaltijden komen nog geen ingrediënten meerdere dagen terug.</p>
      ) : (
        <>
          <p>Deze ingrediënten komen in meerdere geplande maaltijden terug:</p>
          <ul className="ingredient-reuse-list">
            {insight.reusedIngredients.map((ingredient) => (
              <li key={ingredient.ingredientId}>
                <strong>{ingredient.label}</strong>
                <span>{ingredient.mealCount} maaltijden · {ingredient.days.join(', ')}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="ingredient-reuse-note">
        Dit laat alleen zien welke maaltijden ingrediënten delen. Het bewijst
        geen restjes, minder verpakkingen of financiële besparing.
      </p>
    </section>
  )
}
