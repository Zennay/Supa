export type Store = {
  id: string
  name: string
}

export type Recipe = {
  id: string
  title: string
  minutes: number
  servings: number
  estimatedCost: number
  tags: string[]
}

export type PlannedMeal = {
  day: string
  recipeId: string
}
