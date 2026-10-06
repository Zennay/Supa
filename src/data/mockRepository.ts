import type { GroceryRepository } from './repository.ts'
import { basket, plan, recipes } from './mock.ts'

function recipeSnapshot() {
  return recipes.map((recipe) => ({
    ...recipe,
    tags: [...recipe.tags],
  }))
}

function planSnapshot() {
  return plan.map((meal) => ({ ...meal }))
}

function basketSnapshot() {
  return {
    ...basket,
    store: { ...basket.store },
    lines: basket.lines.map((line) => ({ ...line })),
  }
}

export const mockRepository: GroceryRepository = {
  async getRecipes() {
    return recipeSnapshot()
  },

  async getPlan() {
    return planSnapshot()
  },

  async getBasket() {
    return basketSnapshot()
  },
}
