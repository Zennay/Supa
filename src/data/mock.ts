import type {
  BasketLine,
  BasketSummary,
  PlannedMeal,
  Recipe,
  Store,
} from '../domain/types'

type FrozenRecipe = Omit<Readonly<Recipe>, 'tags'> & {
  readonly tags: readonly string[]
}

type FrozenBasket = Omit<Readonly<BasketSummary>, 'store' | 'lines'> & {
  readonly store: Readonly<Store>
  readonly lines: readonly Readonly<BasketLine>[]
}

const sourceStores: Store[] = [
  { id: 'store-a', name: 'Supermarkt A' },
  { id: 'store-b', name: 'Supermarkt B' },
]

export const stores: readonly Readonly<Store>[] = Object.freeze(
  sourceStores.map((store) => Object.freeze({ ...store })),
)

const sourceRecipes: Recipe[] = [
  {
    id: 'tikka',
    title: 'Tikka chicken bowl',
    minutes: 25,
    servings: 2,
    estimatedCost: 6.4,
    tags: ['budget', 'meal-prep'],
  },
  {
    id: 'teriyaki',
    title: 'Teriyaki veggie bowl',
    minutes: 20,
    servings: 2,
    estimatedCost: 5.8,
    tags: ['snel', 'reuse'],
  },
  {
    id: 'pasta',
    title: 'Creamy tomato pasta',
    minutes: 18,
    servings: 2,
    estimatedCost: 4.9,
    tags: ['comfort', 'budget'],
  },
]

export const recipes: readonly FrozenRecipe[] = Object.freeze(
  sourceRecipes.map((recipe) =>
    Object.freeze({
      ...recipe,
      tags: Object.freeze([...recipe.tags]),
    }),
  ),
)

const sourcePlan: PlannedMeal[] = [
  { day: 'Ma', recipeId: 'tikka' },
  { day: 'Di', recipeId: 'teriyaki' },
  { day: 'Wo', recipeId: 'pasta' },
  { day: 'Do', recipeId: 'tikka' },
]

export const plan: readonly Readonly<PlannedMeal>[] = Object.freeze(
  sourcePlan.map((meal) => Object.freeze({ ...meal })),
)

const sourceBasketLines: BasketLine[] = [
  {
    id: '1',
    label: 'Kippendij',
    quantity: '600 g',
    price: 6.49,
    source: 'mock',
    observedAt: '2026-09-26T12:00:00Z',
  },
  {
    id: '2',
    label: 'Groentemix',
    quantity: '2 st',
    price: 4.58,
    source: 'mock',
    observedAt: '2026-09-26T12:00:00Z',
  },
  {
    id: '3',
    label: 'Pasta',
    quantity: '500 g',
    price: 1.49,
    source: 'mock',
    observedAt: '2026-09-26T12:00:00Z',
  },
  {
    id: '4',
    label: 'Tomatenbasis',
    quantity: '2 st',
    price: 2.98,
    source: 'mock',
    observedAt: '2026-09-26T12:00:00Z',
  },
  {
    id: '5',
    label: 'Overige weekboodschappen',
    quantity: '1 set',
    price: 16.26,
    source: 'mock',
    observedAt: '2026-09-26T12:00:00Z',
  },
]

export const basket: FrozenBasket = Object.freeze({
  store: stores[0],
  total: 31.8,
  baselineTotal: 38.25,
  lines: Object.freeze(
    sourceBasketLines.map((line) => Object.freeze({ ...line })),
  ),
})
