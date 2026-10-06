import type { PlannedMeal, Recipe } from './types'

export type PlannerBudgetState = {
  plannedCost: number
  budget: number
  remaining: number
  usage: number
  overBudget: boolean
}

export type PlannerBudgetAssessment =
  | {
      status: 'known'
      budgetState: PlannerBudgetState
    }
  | {
      status: 'unknown'
      knownCost: number
      budget: number
      unresolvedLineCount: number
    }

export function getPlannedCost(
  plan: PlannedMeal[],
  recipes: Recipe[],
  activeDays: string[],
): number | null {
  const active = new Set(activeDays)
  let total = 0

  for (const item of plan) {
    if (!active.has(item.day)) continue

    const matches = recipes.filter((candidate) => candidate.id === item.recipeId)
    if (matches.length !== 1) return null

    total += matches[0].estimatedCost
  }

  return total
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

export function assessPlannerBudget(
  knownCost: number,
  budget: number,
  unresolvedLineCount: number,
): PlannerBudgetAssessment {
  const safeBudget = Math.max(0, budget)

  if (!Number.isInteger(unresolvedLineCount) || unresolvedLineCount !== 0) {
    return {
      status: 'unknown',
      knownCost,
      budget: safeBudget,
      unresolvedLineCount:
        Number.isInteger(unresolvedLineCount) && unresolvedLineCount > 0
          ? unresolvedLineCount
          : 1,
    }
  }

  return {
    status: 'known',
    budgetState: getBudgetState(knownCost, safeBudget),
  }
}
