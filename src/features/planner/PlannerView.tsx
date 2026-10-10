import type { PlannedMeal, Recipe } from '../../domain/types'
import { euro } from '../../lib/money'
import { assessPlannerBudgetCents } from '../../lib/plannerBudgetCents.ts'
import './planner.css'

const budgetOptions = [30, 35, 40]

type PlannerViewProps = {
  budget: number
  activeDays: string[]
  plannedMeals: PlannedMeal[]
  recipes: Recipe[]
  basketTotalCents: number
  basketUnresolvedLineCount: number
  onBudgetChange: (budget: number) => void
  onToggleDay: (day: string) => void
  onRecipeChange: (day: string, recipeId: string) => void
  onReset: () => void
}

export function PlannerView({
  budget,
  activeDays,
  plannedMeals,
  recipes,
  basketTotalCents,
  basketUnresolvedLineCount,
  onBudgetChange,
  onToggleDay,
  onRecipeChange,
  onReset,
}: PlannerViewProps) {
  const plannedCost = basketTotalCents / 100
  // The basket is already measured in cents. Do not subtract floating-point
  // euro values and then ask the strict formatter to round the result (#1041).
  const budgetAssessment = assessPlannerBudgetCents(
    basketTotalCents,
    budget,
    basketUnresolvedLineCount,
  )
  const budgetKnown = budgetAssessment.status === 'known'
  const validProgress =
    Number.isSafeInteger(basketTotalCents) &&
    basketTotalCents >= 0 &&
    Number.isFinite(budget) &&
    budget >= 0
  const progressValue = validProgress ? Math.min(plannedCost, budget) : 0
  const progressUsage = budgetKnown
    ? budgetAssessment.usage
    : validProgress && budget > 0
      ? Math.min(plannedCost / budget, 1)
      : 0

  return (
    <section className="screen">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Deze week</span>
          <h2>Plan eerst. Vergelijk daarna.</h2>
        </div>
        <button type="button" className="ghost-button" onClick={onReset}>Reset</button>
      </div>

      <section className="budget-card" aria-labelledby="weekbudget-title">
        <div className="budget-heading">
          <div>
            <span className="eyebrow">Voorkeur · weekbudget</span>
            <strong id="weekbudget-title">{euro.format(budget)}</strong>
          </div>
          <span
            className={
              budgetKnown && budgetAssessment.overBudget
                ? 'budget-status warning'
                : budgetKnown
                  ? 'budget-status'
                  : 'budget-status warning'
            }
            aria-live="polite"
          >
            {budgetKnown
              ? budgetAssessment.overBudget
                ? `${euro.formatCents(-budgetAssessment.remainingCents)} boven budget`
                : `${budgetAssessment.remainingLabel} over`
              : budgetAssessment.reason === 'unresolved-products'
                ? `${budgetAssessment.unresolvedLineCount} ${budgetAssessment.unresolvedLineCount === 1 ? 'mandregel' : 'mandregels'} open`
                : 'Budgetgegevens controleren'}
          </span>
        </div>

        <div className="budget-options" role="group" aria-label="Kies je weekbudget">
          {budgetOptions.map((option) => (
            <button
              type="button"
              key={option}
              className={budget === option ? 'budget-chip active' : 'budget-chip'}
              aria-pressed={budget === option}
              onClick={() => onBudgetChange(option)}
            >
              {euro.format(option)}
            </button>
          ))}
        </div>

        <div
          className="budget-progress"
          role="progressbar"
          aria-label={
            budgetKnown
              ? 'Gepland deel van het weekbudget'
              : 'Bekend minimum van het weekbudget'
          }
          aria-valuemin={0}
          aria-valuemax={budget}
          aria-valuenow={progressValue}
        >
          <span style={{ width: `${progressUsage * 100}%` }} />
        </div>

        <div className="budget-summary">
          <span>{activeDays.length} maaltijden actief</span>
          <strong>
            {budgetKnown
              ? euro.formatCents(basketTotalCents)
              : budgetAssessment.reason === 'unresolved-products' &&
                  budgetAssessment.knownMinimumCents !== null
                ? `min. ${euro.formatCents(budgetAssessment.knownMinimumCents)}`
                : '—'}
          </strong>
        </div>
        <p className="disclaimer">
          {budgetKnown ? (
            <>
              Dit bedrag komt uit exact dezelfde productmatching en
              verpakkingsberekening als de Mand-tab.
            </>
          ) : budgetAssessment.reason === 'unresolved-products' ? (
            <>
              Nog {budgetAssessment.unresolvedLineCount}{' '}
              {budgetAssessment.unresolvedLineCount === 1
                ? 'productmatch is'
                : 'productmatches zijn'}{' '}
              onopgelost. Daarom is dit alleen het bekende minimum; SUPA claimt
              nog niet dat je binnen of boven budget zit.
            </>
          ) : (
            <>
              Het budget of de mandgegevens zijn niet geldig. Controleer de
              producten en bedragen voordat je een budgetvergelijking maakt.
            </>
          )}
        </p>
      </section>

      <div className="day-grid" role="group" aria-label="Geplande maaltijden">
        {plannedMeals.map((item) => {
          const recipe = recipes.find((candidate) => candidate.id === item.recipeId)
          if (!recipe) return null
          const active = activeDays.includes(item.day)

          return (
            <article
              className={active ? 'meal-card meal-config active' : 'meal-card meal-config'}
              key={item.day}
            >
              <span className="day">{item.day}</span>
              <span className="meal-copy">
                <label htmlFor={`recipe-${item.day}`}>Recept</label>
                <select
                  id={`recipe-${item.day}`}
                  aria-label={`Recept voor ${item.day}`}
                  value={item.recipeId}
                  onChange={(event) => onRecipeChange(item.day, event.target.value)}
                >
                  {recipes.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.title}
                    </option>
                  ))}
                </select>
                <small>{recipe.minutes} min · {euro.format(recipe.estimatedCost)} / recept</small>
              </span>
              <button
                type="button"
                className="plan-check"
                aria-label={active ? `${item.day} uit planning halen` : `${item.day} aan planning toevoegen`}
                aria-pressed={active}
                onClick={() => onToggleDay(item.day)}
              >
                {active ? '✓' : '+'}
              </button>
            </article>
          )
        })}
      </div>

      <div className="insight-card">
        <span className="eyebrow">Van plan naar lijst</span>
        <strong>Je receptkeuzes sturen nu dezelfde mand en boodschappenlijst aan.</strong>
        <p>
          Onzekere productmatches worden niet ingevuld: ze blijven zichtbaar
          als controlepunt in Mand en Lijst.
        </p>
      </div>
    </section>
  )
}
