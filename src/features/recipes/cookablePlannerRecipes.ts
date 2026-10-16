import { m2Recipes } from '../../data/m2Fixture.ts'
import type { RecipeWithIngredients } from '../../domain/basket.ts'

/**
 * Complete, cookable instructions for SUPA's existing planner recipes.
 * Unlike Figma's placeholder cards, every ingredient and quantity comes from
 * the same recipe object used by the actual planner/basket. This content is
 * authored for SUPA; it is not a licensed supermarket recipe or a priced deal.
 */
const stepsById: Readonly<Record<string, readonly string[]>> = {
  tikka: [
    'Spoel de rijst en kook 150 g basmatirijst volgens de verpakking.',
    'Snijd de bloemkool in kleine roosjes en de 300 g kippendij in stukjes.',
    'Bak de kip gaar in een pan. Voeg de bloemkool en 10 g garam masala toe en bak mee tot de bloemkool zacht is.',
    'Schenk 200 ml kokosmelk erbij, laat enkele minuten zachtjes pruttelen en serveer met de rijst.',
  ],
  teriyaki: [
    'Kook 150 g basmatirijst volgens de verpakking.',
    'Snijd 250 g broccoli klein. Kook of stoom de broccoli en 150 g edamame tot ze gaar zijn.',
    'Doe de groenten in een pan met 60 ml teriyakisaus en verwarm kort.',
    'Verdeel de rijst over twee kommen en schep de teriyakigroenten erop.',
  ],
  pasta: [
    'Kook 250 g spaghetti volgens de verpakking en bewaar een beetje kookwater.',
    'Verwarm 400 g tomatenblokjes in een pan tot de saus zacht pruttelt.',
    'Zet het vuur laag en roer 100 g Griekse yoghurt door de saus. Voeg zo nodig wat kookwater toe.',
    'Meng de spaghetti door de saus en verdeel over twee borden.',
  ],
}

export type CookablePlannerRecipe = RecipeWithIngredients & { steps: readonly string[]; source: 'supa-planner-recipe' }

export const cookablePlannerRecipes: readonly CookablePlannerRecipe[] = Object.freeze(
  m2Recipes.map(recipe => Object.freeze({
    ...recipe,
    source: 'supa-planner-recipe' as const,
    steps: Object.freeze([...(stepsById[recipe.id] ?? [])]),
  })),
)
