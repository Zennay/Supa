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

function isCanonicalIdentity(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim()
  )
}

export function getPlannedCost(
  plan: PlannedMeal[],
  recipes: Recipe[],
  activeDays: string[],
): number | null {
  if (
    !Array.isArray(plan) ||
    !Array.isArray(recipes) ||
    !Array.isArray(activeDays)
  ) {
    return null
  }

  const active = new Set(activeDays)
  let total = 0

  for (const day of active) {
    if (!isCanonicalIdentity(day)) return null

    const plannedMeals = plan.filter((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        return false
      }

      return (candidate as { day?: unknown }).day === day
    })
    if (plannedMeals.length !== 1) return null

    const item = plannedMeals[0]
    if (!isCanonicalIdentity(item.recipeId)) {
      return null
    }

    const matches = recipes.filter((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        return false
      }

      return (candidate as { id?: unknown }).id === item.recipeId
    })
    if (matches.length !== 1) return null

    const estimatedCost = matches[0].estimatedCost
    if (
      typeof estimatedCost !== 'number' ||
      !Number.isFinite(estimatedCost) ||
      estimatedCost < 0
    ) {
      return null
    }

    total += estimatedCost
    if (!Number.isFinite(total)) return null
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

function isValidBudgetMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function assessPlannerBudget(
  knownCost: unknown,
  budget: unknown,
  unresolvedLineCount: unknown,
): PlannerBudgetAssessment {
  const validKnownCost = isValidBudgetMoney(knownCost)
  const validBudget = isValidBudgetMoney(budget)
  const safeKnownCost = validKnownCost ? knownCost : 0
  const safeBudget = validBudget ? budget : 0
  const validUnresolvedLineCount =
    typeof unresolvedLineCount === 'number' &&
    Number.isSafeInteger(unresolvedLineCount) &&
    unresolvedLineCount >= 0

  if (
    !validKnownCost ||
    !validBudget ||
    !validUnresolvedLineCount ||
    unresolvedLineCount !== 0
  ) {
    return {
      status: 'unknown',
      knownCost: safeKnownCost,
      budget: safeBudget,
      unresolvedLineCount:
        validUnresolvedLineCount && unresolvedLineCount > 0
          ? unresolvedLineCount
          : 1,
    }
  }

  return {
    status: 'known',
    budgetState: getBudgetState(safeKnownCost, safeBudget),
  }
}
