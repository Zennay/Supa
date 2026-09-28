import type { GroceryRepository } from './repository'
import { basket, plan, recipes } from './mock'

export const mockRepository: GroceryRepository = {
  async getRecipes() {
    return recipes
  },

  async getPlan() {
    return plan
  },

  async getBasket() {
    return basket
  },
}
