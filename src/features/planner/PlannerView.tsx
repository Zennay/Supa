import { useMemo } from 'react'
import type { PlannedMeal, Recipe } from '../../domain/types'
import { getBudgetState, getPlannedCost } from '../../domain/planner'
import { euro } from '../../lib/money'
import './planner.css'

const budgetOptions = [30, 35, 40]

type PlannerViewProps = {
  budget: number
  activeDays: string[]
  plannedMeals: PlannedMeal[]
  recipes: Recipe[]
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
  onBudgetChange,
  onToggleDay,
  onRecipeChange,
  onReset,
}: PlannerViewProps) {
  const plannedCost = useMemo(
    () => getPlannedCost(plannedMeals, recipes, activeDays),
    [activeDays, plannedMeals, recipes],
  )
  const budgetState = getBudgetState(plannedCost, budget)

  return (
    <section className="screen">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Deze week</span>
          <h2>Plan eerst. Bespaar daarna.</h2>
        </div>
        <button className="ghost-button" onClick={onReset}>Reset</button>
      </div>

      <section className="budget-card" aria-labelledby="weekbudget-title">
        <div className="budget-heading">
          <div>
            <span className="eyebrow">Voorkeur · weekbudget</span>
            <strong id="weekbudget-title">{euro.format(budget)}</strong>
          </div>
          <span className={budgetState.overBudget ? 'budget-status warning' : 'budget-status'}>
            {budgetState.overBudget
              ? `${euro.format(Math.abs(budgetState.remaining))} boven budget`
              : `${euro.format(budgetState.remaining)} over`}
          </span>
        </div>

        <div className="budget-options" aria-label="Kies je weekbudget">
          {budgetOptions.map((option) => (
            <button
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
          aria-label="Gepland deel van het weekbudget"
          aria-valuemin={0}
          aria-valuemax={budget}
          aria-valuenow={Math.min(plannedCost, budget)}
        >
          <span style={{ width: `${budgetState.usage * 100}%` }} />
        </div>

        <div className="budget-summary">
          <span>{activeDays.length} maaltijden actief</span>
          <strong>{euro.format(plannedCost)}</strong>
        </div>
        <p className="disclaimer">
          Receptkosten zijn planningsfixtures. De Mand-tab rekent de gekozen
          week apart uit via productmatching en verpakkingen.
        </p>
      </section>

      <div className="day-grid" aria-label="Geplande maaltijden">
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
        <span className="eyebrow">M2 verticale slice</span>
        <strong>Je receptkeuzes sturen nu dezelfde mand en boodschappenlijst aan.</strong>
        <p>
          Onzekere productmatches worden niet ingevuld: ze blijven zichtbaar
          als controlepunt in Mand en Lijst.
        </p>
      </div>
    </section>
  )
}
