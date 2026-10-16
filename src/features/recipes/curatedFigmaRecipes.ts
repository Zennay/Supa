import type { RecipeIngredient, RecipeWithIngredients } from '../../domain/basket.ts'

/**
 * Six fully specified original SUPA recipes matching the food photos/titles
 * in the user's Figma screen. Recipes are written for SUPA, not copied from
 * a retailer website. They contain real cookable ingredients/steps but NO
 * asserted retailer source, stock, price, promotion or savings.
 */
export type CuratedFigmaRecipe = RecipeWithIngredients & {
  source: 'supa-original-recipe'
  steps: string[]
}

const ingredient = (id: string, label: string, query: string, amount: number, unit: RecipeIngredient['unit']): RecipeIngredient =>
  ({ id, label, query, amount, unit })

export const curatedFigmaRecipes: CuratedFigmaRecipe[] = [
  {
    id: 'supa-thai', title: 'Thai red curry', minutes: 40, servings: 2,
    estimatedCost: Number.NaN, tags: ['groente', 'rijst'], source: 'supa-original-recipe',
    ingredients: [
      ingredient('basmati-rice', 'Basmati rijst', 'basmati rijst', 150, 'g'),
      ingredient('coconut-milk', 'Kokosmelk', 'kokosmelk', 250, 'ml'),
      ingredient('supa-curry-paste', 'Rode currypasta', 'rode currypasta', 40, 'g'),
      ingredient('supa-paprika', 'Paprika', 'paprika', 1, 'piece'),
      ingredient('supa-courgette', 'Courgette', 'courgette', 1, 'piece'),
    ],
    steps: [
      'Spoel de rijst en kook 150 g basmatirijst volgens de verpakking.',
      'Snijd een paprika en een courgette in kleine stukken.',
      'Bak 40 g rode currypasta kort in een pan. Voeg de groenten toe en roerbak enkele minuten.',
      'Schenk 250 ml kokosmelk erbij en laat zacht koken totdat de groenten gaar zijn. Serveer met de rijst.',
    ],
  },
  {
    id: 'supa-quesadillas', title: 'Quesadillas', minutes: 15, servings: 2,
    estimatedCost: Number.NaN, tags: ['snel', 'vegetarisch'], source: 'supa-original-recipe',
    ingredients: [
      ingredient('supa-tortillas', 'Tortilla wraps', 'tortilla wraps', 4, 'piece'),
      ingredient('supa-cheese', 'Geraspte kaas', 'geraspte kaas', 100, 'g'),
      ingredient('supa-beans', 'Kidneybonen', 'kidneybonen', 200, 'g'),
      ingredient('supa-paprika', 'Paprika', 'paprika', 1, 'piece'),
    ],
    steps: [
      'Laat 200 g kidneybonen uitlekken en snijd de paprika fijn.',
      'Verdeel de bonen, paprika en 100 g geraspte kaas over twee wraps.',
      'Dek af met de andere wraps en bak per kant enkele minuten in een droge koekenpan.',
      'Snijd de quesadillas in punten zodra de kaas gesmolten is.',
    ],
  },
  {
    id: 'supa-fried-rice', title: 'Fried rice', minutes: 15, servings: 2,
    estimatedCost: Number.NaN, tags: ['snel', 'rijst'], source: 'supa-original-recipe',
    ingredients: [
      ingredient('basmati-rice', 'Basmati rijst', 'basmati rijst', 150, 'g'),
      ingredient('supa-eggs', 'Eieren', 'eieren', 2, 'piece'),
      ingredient('edamame', 'Edamame', 'edamame', 100, 'g'),
      ingredient('teriyaki-sauce', 'Teriyaki saus', 'teriyaki saus', 30, 'ml'),
    ],
    steps: [
      'Kook 150 g basmatirijst en laat even uitdampen. Gebruik bij voorkeur afgekoelde rijst.',
      'Klop twee eieren los en roerbak ze gaar in een hete pan.',
      'Voeg de rijst en 100 g edamame toe en bak al omscheppend goed heet.',
      'Schep 30 ml teriyakisaus erdoor en serveer direct.',
    ],
  },
  {
    id: 'supa-bao', title: 'Bao buns', minutes: 20, servings: 2,
    estimatedCost: Number.NaN, tags: ['comfort'], source: 'supa-original-recipe',
    ingredients: [
      ingredient('supa-bao-buns', 'Bao buns', 'bao buns', 4, 'piece'),
      ingredient('chicken-thigh', 'Kippendij', 'kippendij', 200, 'g'),
      ingredient('supa-cucumber', 'Komkommer', 'komkommer', 1, 'piece'),
      ingredient('supa-hoisin', 'Hoisinsaus', 'hoisinsaus', 50, 'ml'),
    ],
    steps: [
      'Stoom vier bao buns volgens de verpakking.',
      'Snijd 200 g kippendij in reepjes en bak ze volledig gaar.',
      'Roer 50 ml hoisinsaus door de kip en warm kort door.',
      'Snijd de komkommer in dunne plakjes en vul de buns met kip en komkommer.',
    ],
  },
  {
    id: 'supa-katsu', title: 'Katsu curry', minutes: 40, servings: 2,
    estimatedCost: Number.NaN, tags: ['comfort', 'rijst'], source: 'supa-original-recipe',
    ingredients: [
      ingredient('basmati-rice', 'Basmati rijst', 'basmati rijst', 150, 'g'),
      ingredient('chicken-thigh', 'Kippendij', 'kippendij', 300, 'g'),
      ingredient('supa-panko', 'Panko', 'panko', 80, 'g'),
      ingredient('supa-eggs', 'Eieren', 'eieren', 1, 'piece'),
      ingredient('supa-katsu-sauce', 'Japanse currysaus', 'japanse currysaus', 200, 'ml'),
    ],
    steps: [
      'Kook 150 g basmatirijst volgens de verpakking en verwarm 200 ml currysaus apart.',
      'Klop een ei los. Haal de kippendijen door het ei en daarna door 80 g panko.',
      'Bak de gepaneerde kip in een pan met een beetje olie helemaal gaar en krokant.',
      'Snijd de kip in repen en serveer met rijst en warme currysaus.',
    ],
  },
  {
    id: 'supa-veg-pasta', title: 'Groente pasta', minutes: 15, servings: 2,
    estimatedCost: Number.NaN, tags: ['vegetarisch', 'snel'], source: 'supa-original-recipe',
    ingredients: [
      ingredient('spaghetti', 'Spaghetti', 'spaghetti', 250, 'g'),
      ingredient('tomato-cubes', 'Tomatenblokjes', 'tomatenblokjes', 400, 'g'),
      ingredient('supa-courgette', 'Courgette', 'courgette', 1, 'piece'),
      ingredient('supa-spinach', 'Spinazie', 'spinazie', 100, 'g'),
    ],
    steps: [
      'Kook 250 g spaghetti volgens de verpakking.',
      'Snijd een courgette klein en bak in een pan tot de stukken zacht worden.',
      'Voeg 400 g tomatenblokjes en 100 g spinazie toe. Laat de spinazie slinken.',
      'Meng de spaghetti door de groentesaus en verdeel over twee borden.',
    ],
  },
]

for (const recipe of curatedFigmaRecipes) {
  for (const item of recipe.ingredients) Object.freeze(item)
  Object.freeze(recipe.ingredients)
  Object.freeze(recipe.steps)
  Object.freeze(recipe.tags)
  Object.freeze(recipe)
}
Object.freeze(curatedFigmaRecipes)
