import { useEffect, useMemo, useState } from 'react'
import { plan, recipes } from '../../data/mock'
import { getBudgetState, getPlannedCost } from '../../domain/planner'
import {
  parsePlannerPreferences,
  serializePlannerPreferences,
} from '../../domain/plannerPreferences'
import { euro } from '../../lib/money'
import './planner.css'

const budgetOptions = [30, 35, 40]
const plannerStorageKey = 'supa:planner-preferences:v1'
const defaultActiveDays = plan.map((item) => item.day)

export function PlannerView() {
  const [preferences, setPreferences] = useState(() => {
    if (typeof window === 'undefined') {
      return parsePlannerPreferences(null, defaultActiveDays)
    }

    try {
      return parsePlannerPreferences(
        window.localStorage.getItem(plannerStorageKey),
        defaultActiveDays,
      )
    } catch {
      return parsePlannerPreferences(null, defaultActiveDays)
    }
  })

  const { budget, activeDays } = preferences
  const plannedCost = useMemo(
    () => getPlannedCost(plan, recipes, activeDays),
    [activeDays],
  )
  const budgetState = getBudgetState(plannedCost, budget)

  useEffect(() => {
    try {
      window.localStorage.setItem(
        plannerStorageKey,
        serializePlannerPreferences(preferences),
      )
    } catch {
      // Storage can be unavailable in strict privacy modes; planner remains usable.
    }
  }, [preferences])

  const toggleDay = (day: string) => {
    setPreferences((current) => ({
      ...current,
      activeDays: current.activeDays.includes(day)
        ? current.activeDays.filter((candidate) => candidate !== day)
        : [...current.activeDays, day],
    }))
  }

  const resetWeek = () => {
    setPreferences({
      budget: 35,
      activeDays: [...defaultActiveDays],
    })
  }

  return (
    <section className="screen">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Deze week</span>
          <h2>Plan eerst. Bespaar daarna.</h2>
        </div>
        <button className="ghost-button" onClick={resetWeek}>Reset</button>
      </div>

      <section className="budget-card" aria-labelledby="weekbudget-title">
        <div className="budget-heading">
          <div>
            <span className="eyebrow">Weekbudget</span>
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
              onClick={() =>
                setPreferences((current) => ({ ...current, budget: option }))
              }
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
          <span>{activeDays.length} maaltijden gepland</span>
          <strong>{euro.format(plannedCost)}</strong>
        </div>
        <p className="disclaimer">Gebaseerd op mock-receptkosten; nog geen echte besparingsclaim.</p>
      </section>

      <div className="day-grid" aria-label="Geplande maaltijden">
        {plan.map((item) => {
          const recipe = recipes.find((candidate) => candidate.id === item.recipeId)!
          const active = activeDays.includes(item.day)

          return (
            <button
              type="button"
              className={active ? 'meal-card meal-toggle active' : 'meal-card meal-toggle'}
              key={item.day}
              aria-pressed={active}
              onClick={() => toggleDay(item.day)}
            >
              <span className="day">{item.day}</span>
              <span className="meal-copy">
                <strong>{recipe.title}</strong>
                <small>{recipe.minutes} min · {euro.format(recipe.estimatedCost)} / recept</small>
              </span>
              <span className="plan-check" aria-hidden="true">{active ? '✓' : '+'}</span>
            </button>
          )
        })}
      </div>

      <div className="insight-card">
        <span className="eyebrow">Slim gecombineerd</span>
        <strong>2 ingrediënten worden deze week opnieuw gebruikt.</strong>
        <p>De planner houdt budget en maaltijden nu samen bij; hergebruik blijft voorlopig expliciete mockdata.</p>
      </div>
    </section>
  )
}
