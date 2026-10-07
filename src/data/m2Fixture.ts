import type { PlannedMeal, Store } from '../domain/types.ts'
import type {
  RecipeWithIngredients,
  StoreProduct,
} from '../domain/basket.ts'

export const m2Store: Store = {
  id: 'm2-one-store',
  name: 'Voorbeeldwinkel',
}

export const m2Recipes: RecipeWithIngredients[] = [
  {
    id: 'tikka',
    title: 'Tikka chicken bowl',
    minutes: 25,
    servings: 2,
    estimatedCost: 6.4,
    tags: ['budget', 'meal-prep'],
    ingredients: [
      { id: 'chicken-thigh', label: 'Kippendij', query: 'kippendij', amount: 300, unit: 'g' },
      { id: 'basmati-rice', label: 'Basmati rijst', query: 'basmati rijst', amount: 150, unit: 'g' },
      { id: 'coconut-milk', label: 'Kokosmelk', query: 'kokosmelk', amount: 200, unit: 'ml' },
      { id: 'cauliflower', label: 'Bloemkool', query: 'bloemkool', amount: 1, unit: 'piece' },
      { id: 'garam-masala', label: 'Garam masala', query: 'garam masala', amount: 10, unit: 'g' },
    ],
  },
  {
    id: 'teriyaki',
    title: 'Teriyaki veggie bowl',
    minutes: 20,
    servings: 2,
    estimatedCost: 5.8,
    tags: ['snel', 'reuse'],
    ingredients: [
      { id: 'basmati-rice', label: 'Basmati rijst', query: 'basmati rijst', amount: 150, unit: 'g' },
      { id: 'broccoli', label: 'Broccoli', query: 'broccoli', amount: 250, unit: 'g' },
      { id: 'edamame', label: 'Edamame', query: 'edamame', amount: 150, unit: 'g' },
      { id: 'teriyaki-sauce', label: 'Teriyaki saus', query: 'teriyaki saus', amount: 60, unit: 'ml' },
    ],
  },
  {
    id: 'pasta',
    title: 'Creamy tomato pasta',
    minutes: 18,
    servings: 2,
    estimatedCost: 4.9,
    tags: ['comfort', 'budget'],
    ingredients: [
      { id: 'spaghetti', label: 'Spaghetti', query: 'spaghetti', amount: 250, unit: 'g' },
      { id: 'tomato-cubes', label: 'Tomatenblokjes', query: 'tomatenblokjes', amount: 400, unit: 'g' },
      { id: 'greek-yogurt', label: 'Griekse yoghurt', query: 'griekse yoghurt', amount: 100, unit: 'g' },
    ],
  },
]

export const m2InitialPlan: PlannedMeal[] = [
  { day: 'Ma', recipeId: 'tikka' },
  { day: 'Di', recipeId: 'teriyaki' },
  { day: 'Wo', recipeId: 'pasta' },
  { day: 'Do', recipeId: 'tikka' },
]

export const m2Products: StoreProduct[] = [
  { id: 'chicken-400', storeId: m2Store.id, name: 'Kippendij 400 g', packAmount: 400, packUnit: 'g', available: true, priceCents: 479 },
  { id: 'basmati-1kg', storeId: m2Store.id, name: 'Basmati rijst 1 kg', packAmount: 1, packUnit: 'kg', available: true, priceCents: 249 },
  { id: 'coconut-400', storeId: m2Store.id, name: 'Kokosmelk 400 ml', packAmount: 400, packUnit: 'ml', available: true, priceCents: 159 },
  { id: 'cauliflower-1', storeId: m2Store.id, name: 'Bloemkool', packAmount: 1, packUnit: 'piece', available: true, priceCents: 199 },
  { id: 'broccoli-500', storeId: m2Store.id, name: 'Broccoli 500 g', packAmount: 500, packUnit: 'g', available: true, priceCents: 229 },
  { id: 'edamame-300', storeId: m2Store.id, name: 'Edamame 300 g', packAmount: 300, packUnit: 'g', available: true, priceCents: 299 },
  { id: 'teriyaki-250', storeId: m2Store.id, name: 'Teriyaki saus 250 ml', packAmount: 250, packUnit: 'ml', available: true, priceCents: 249 },
  { id: 'spaghetti-500', storeId: m2Store.id, name: 'Spaghetti 500 g', packAmount: 500, packUnit: 'g', available: true, priceCents: 139 },
  { id: 'tomato-400', storeId: m2Store.id, name: 'Tomatenblokjes 400 g', packAmount: 400, packUnit: 'g', available: true, priceCents: 99 },
  { id: 'yogurt-500', storeId: m2Store.id, name: 'Griekse yoghurt 500 g', packAmount: 500, packUnit: 'g', available: true, priceCents: 229 },
  { id: 'curry-50', storeId: m2Store.id, name: 'Kerriepoeder 50 g', packAmount: 50, packUnit: 'g', available: true, priceCents: 129 },
]

export const m2DefaultActiveDays = m2InitialPlan.map((meal) => meal.day)

for (const recipe of m2Recipes) {
  Object.freeze(recipe.tags)
  for (const ingredient of recipe.ingredients) Object.freeze(ingredient)
  Object.freeze(recipe.ingredients)
  Object.freeze(recipe)
}
for (const meal of m2InitialPlan) Object.freeze(meal)
for (const product of m2Products) Object.freeze(product)

Object.freeze(m2Store)
Object.freeze(m2Recipes)
Object.freeze(m2InitialPlan)
Object.freeze(m2Products)
Object.freeze(m2DefaultActiveDays)
