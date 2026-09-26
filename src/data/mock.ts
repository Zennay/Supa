import type { BasketSummary, PlannedMeal, Recipe, Store } from '../domain/types'

export const stores: Store[] = [
  { id: 'store-a', name: 'Supermarkt A' },
  { id: 'store-b', name: 'Supermarkt B' },
]

export const recipes: Recipe[] = [
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

export const plan: PlannedMeal[] = [
  { day: 'Ma', recipeId: 'tikka' },
  { day: 'Di', recipeId: 'teriyaki' },
  { day: 'Wo', recipeId: 'pasta' },
  { day: 'Do', recipeId: 'tikka' },
]

export const basket: BasketSummary = {
  store: stores[0],
  total: 31.8,
  baselineTotal: 38.25,
  lines: [
    { id: '1', label: 'Kippendij', quantity: '600 g', price: 6.49, source: 'mock', observedAt: '2026-09-26T12:00:00Z' },
    { id: '2', label: 'Groentemix', quantity: '2 st', price: 4.58, source: 'mock', observedAt: '2026-09-26T12:00:00Z' },
    { id: '3', label: 'Pasta', quantity: '500 g', price: 1.49, source: 'mock', observedAt: '2026-09-26T12:00:00Z' },
    { id: '4', label: 'Tomatenbasis', quantity: '2 st', price: 2.98, source: 'mock', observedAt: '2026-09-26T12:00:00Z' },
    { id: '5', label: 'Overige weekboodschappen', quantity: '1 set', price: 16.26, source: 'mock', observedAt: '2026-09-26T12:00:00Z' },
  ],
}
