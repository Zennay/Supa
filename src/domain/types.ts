export type Store = {
  id: string
  name: string
}

export type PriceSource =
  | 'mock'
  | 'supermarket-api'
  | 'scraper'
  | 'manual'

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

export type BasketLine = {
  id: string
  label: string
  quantity: string
  price: number
  source: PriceSource
  observedAt: string
}

export type BasketSummary = {
  store: Store
  lines: BasketLine[]
  total: number
  baselineTotal: number
}
