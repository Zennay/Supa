import type { PlannedMeal } from '../domain/types.ts'

/**
 * The week the app opens with: five days (Sunday–Thursday), matching the
 * original SUPA planner design. The first three days are planned; the others
 * are open slots the user can fill. `m2InitialPlan` stays untouched because
 * the recorded M2/M3 evidence is tied to it.
 */
export const appInitialPlan: PlannedMeal[] = [
  { day: 'Zo', recipeId: 'supa-burrito-bowl' },
  { day: 'Ma', recipeId: 'supa-fried-rice' },
  { day: 'Di', recipeId: 'supa-thai' },
  { day: 'Wo', recipeId: 'supa-bao' },
  { day: 'Do', recipeId: 'supa-katsu' },
]
export const appDefaultActiveDays: string[] = ['Zo', 'Ma', 'Di']

for (const meal of appInitialPlan) Object.freeze(meal)
Object.freeze(appInitialPlan)
