import type { BasketSummary, PlannedMeal, Recipe } from '../domain/types'

export interface GroceryRepository {
  getRecipes(): Promise<Recipe[]>
  getPlan(): Promise<PlannedMeal[]>
  getBasket(): Promise<BasketSummary>
}
