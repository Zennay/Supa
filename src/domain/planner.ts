import type { PlannedMeal, Recipe } from './types'

export type PlannerBudgetState = {
  plannedCost: number
  budget: number
  remaining: number
  usage: number
  overBudget: boolean
}

export function getPlannedCost(
  plan: PlannedMeal[],
  recipes: Recipe[],
  activeDays: string[],
) {
  const active = new Set(activeDays)

  return plan.reduce((total, item) => {
    if (!active.has(item.day)) return total

    const recipe = recipes.find((candidate) => candidate.id === item.recipeId)
    return total + (recipe?.estimatedCost ?? 0)
  }, 0)
}

export function getBudgetState(
  plannedCost: number,
  budget: number,
): PlannerBudgetState {
  const safeBudget = Math.max(0, budget)
  const remaining = safeBudget - plannedCost

  return {
    plannedCost,
    budget: safeBudget,
    remaining,
    usage: safeBudget === 0 ? 1 : Math.min(plannedCost / safeBudget, 1),
    overBudget: remaining < 0,
  }
}
