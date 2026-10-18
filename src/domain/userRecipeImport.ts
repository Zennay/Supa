/**
 * Private user-recipe intake, before any persistence, price calculation or fetch.
 * A caller must fetch HTML through a separately protected server boundary.
 * The returned draft is never a trusted priced/plannable recipe until reviewed.
 */
export type MetricUnit = 'g' | 'ml' | 'piece'

export type RecipeDraftIngredient = {
  original: string
  label: string
  query: string
  amount: number | null
  unit: MetricUnit | null
  reviewReason: string | null
}

export type UserRecipeDraft = {
  source: 'manual' | 'url'
  sourceUrl: string | null
  title: string
  servings: number | null
  minutes: number | null
  steps: string[]
  ingredients: RecipeDraftIngredient[]
  warnings: string[]
  status: 'needs_review'
}

const MAX_HTML = 512_000
const MAX_INGREDIENTS = 100
const MAX_STEPS = 100

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function positiveNumber(value: unknown, max: number): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string'
    ? Number(value.trim().replace(',', '.')) : NaN
  return Number.isFinite(number) && number > 0 && number <= max ? number : null
}

function recipeServings(value: unknown): number | null {
  if (Array.isArray(value)) return recipeServings(value[0])
  if (record(value)) return recipeServings(value.value)
  if (typeof value === 'number') return positiveNumber(value, 1000)
  const match = text(value, 100).match(/^(\d+(?:[.,]\d+)?)\s*(?:personen|porties|servings?|people|personen?)?$/i)
  return match ? positiveNumber(match[1], 1000) : null
}

function recipeMinutes(value: unknown): number | null {
  const input = text(value, 80)
  const duration = input.match(/^P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?$/i)
  if (!duration || (!duration[1] && !duration[2])) return null
  return positiveNumber(Number(duration[1] || 0) * 60 + Number(duration[2] || 0), 1440)
}

function quantity(raw: string): number | null {
  const vulgar: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75 }
  if (Object.hasOwn(vulgar, raw)) return vulgar[raw]
  if (raw.includes('/')) {
    const bits = raw.split(/\s+/)
    const fraction = bits.pop()!.split('/').map(Number)
    if (fraction.length !== 2 || !fraction[1]) return null
    return (bits.length ? Number(bits[0]) : 0) + fraction[0] / fraction[1]
  }
  return Number(raw.replace(',', '.'))
}

function rounded(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000
}

const units: Record<string, { unit: MetricUnit; factor: number }> = {
  'g': { unit: 'g', factor: 1 }, 'gram': { unit: 'g', factor: 1 }, 'grams': { unit: 'g', factor: 1 },
  'kg': { unit: 'g', factor: 1000 }, 'kilogram': { unit: 'g', factor: 1000 }, 'kilograms': { unit: 'g', factor: 1000 },
  'ml': { unit: 'ml', factor: 1 }, 'milliliter': { unit: 'ml', factor: 1 }, 'milliliters': { unit: 'ml', factor: 1 },
  'l': { unit: 'ml', factor: 1000 }, 'liter': { unit: 'ml', factor: 1000 }, 'liters': { unit: 'ml', factor: 1000 },
  'stuks': { unit: 'piece', factor: 1 }, 'stuk': { unit: 'piece', factor: 1 }, 'piece': { unit: 'piece', factor: 1 },
  'pieces': { unit: 'piece', factor: 1 }, 'pcs': { unit: 'piece', factor: 1 },
  'oz': { unit: 'g', factor: 28.349523125 }, 'ounce': { unit: 'g', factor: 28.349523125 },
  'ounces': { unit: 'g', factor: 28.349523125 }, 'lb': { unit: 'g', factor: 453.59237 },
  'lbs': { unit: 'g', factor: 453.59237 }, 'pound': { unit: 'g', factor: 453.59237 },
}
const pieceNouns = /^(?:(?:ui|uien)|eieren?|tenen?|knoflooktenen?|tomaten?|bananen?|wortels?|courgettes?|paprika.s?|bloemkolen?|komkommers?|aardappels?|citroenen?|limoenen?)\b/i

export function normalizeIngredientLine(raw: string): RecipeDraftIngredient {
  const original = text(raw, 400)
  if (!original) throw new Error('Ingredientregel ontbreekt')
  const match = original.match(/^((?:\d+\s+)?\d+\/\d+|\d+(?:[.,]\d+)?|[½¼¾])\s*(.*)$/u)
  if (!match) return { original, label: original, query: original.toLocaleLowerCase('nl'), amount: null, unit: null, reviewReason: 'Hoeveelheid of eenheid ontbreekt' }
  const amount = quantity(match[1])
  const tail = match[2].trim()
  const wordMatch = tail.match(/^([^\s,]+)(?:\s+|,\s*)(.*)$/u)
  const word = (wordMatch ? wordMatch[1] : tail).toLowerCase()
  const metric = units[word]
  let label = metric ? (wordMatch?.[2] || '').trim() : tail
  let compoundAmount = 0
  let compoundFound = false
  // Parse consecutive measurable additions instead of trusting only the first
  // quantity (which would silently underbuy 1 kg 250 g as 1000 g).
  if (metric) {
    const additional = /^(?:(?:en|\+)\s*)?((?:\d+\s+)?\d+\/\d+|\d+(?:[.,]\d+)?|[½¼¾])\s*([^\s,]+)(?:\s+|,\s*)(.*)$/u
    for (let index = 0; index < 8; index++) {
      const second = additional.exec(label)
      if (!second) break
      const extraUnit = units[second[2].toLowerCase()]
      const extraAmount = quantity(second[1])
      if (!extraUnit || extraUnit.unit !== metric.unit ||
          extraAmount === null || !Number.isFinite(extraAmount) || extraAmount <= 0) {
        return { original, label: original, query: original.toLocaleLowerCase('nl'),
          amount: null, unit: null,
          reviewReason: 'Controleer samengestelde hoeveelheden en voer het metrische totaal in' }
      }
      compoundFound = true
      compoundAmount += extraAmount * extraUnit.factor
      label = second[3].trim()
    }
    // A ninth quantity is not silently accepted as the ingredient label.
    if (compoundFound && additional.test(label)) {
      return { original, label: original, query: original.toLocaleLowerCase('nl'),
        amount: null, unit: null, reviewReason: 'Te veel samengestelde hoeveelheden: controleer handmatig' }
    }
  }
  const inferredPiece = !metric && pieceNouns.test(tail)
  if (!amount || !Number.isFinite(amount) || amount > 100_000 || !label) {
    return { original, label: label || original, query: (label || original).toLocaleLowerCase('nl'), amount: null, unit: null, reviewReason: 'Controleer de hoeveelheid en het ingrediënt' }
  }
  if (!metric && !inferredPiece) {
    return { original, label, query: label.toLocaleLowerCase('nl'), amount: null, unit: null, reviewReason: 'Onbekende maat: voer een metrische hoeveelheid in' }
  }
  const unit = metric?.unit || 'piece'
  const normalized = rounded(amount * (metric?.factor || 1) + compoundAmount)
  if (!Number.isFinite(normalized) || normalized <= 0 || normalized > 1_000_000) {
    return { original, label, query: label.toLocaleLowerCase('nl'), amount: null, unit: null, reviewReason: 'Hoeveelheid is buiten bereik' }
  }
  return { original, label, query: label.toLocaleLowerCase('nl'), amount: normalized, unit, reviewReason: null }
}

function normalizedDraft(input: {
  source: 'manual' | 'url'
  sourceUrl: string | null
  title: unknown
  servings: unknown
  minutes: unknown
  steps: string[]
  ingredients: string[]
}): UserRecipeDraft {
  const title = text(input.title, 160)
  if (!title) throw new Error('Recepttitel ontbreekt')
  if (!input.ingredients.length || input.ingredients.length > MAX_INGREDIENTS) throw new Error('Ongeldig aantal ingrediënten')
  if (input.steps.length > MAX_STEPS) throw new Error('Te veel bereidingsstappen')
  const ingredients = input.ingredients.map(normalizeIngredientLine)
  const servings = positiveNumber(input.servings, 1000)
  const minutes = positiveNumber(input.minutes, 1440)
  const warnings = ingredients.flatMap((ingredient, index) =>
    ingredient.reviewReason ? ['Ingrediënt ' + (index + 1) + ': ' + ingredient.reviewReason] : [])
  if (servings === null) warnings.push('Porties ontbreken of zijn onduidelijk')
  if (minutes === null) warnings.push('Bereidingstijd ontbreekt of is onduidelijk')
  return {
    source: input.source, sourceUrl: input.sourceUrl, title, servings, minutes,
    steps: input.steps.map(step => text(step, 5000)).filter(Boolean),
    ingredients, warnings, status: 'needs_review',
  }
}

export function createManualRecipeDraft(input: {
  title: string; servings?: number | null; minutes?: number | null;
  ingredients: string[]; steps?: string[]
}): UserRecipeDraft {
  return normalizedDraft({
    source: 'manual', sourceUrl: null, title: input.title,
    servings: input.servings, minutes: input.minutes,
    ingredients: input.ingredients, steps: input.steps || [],
  })
}

function stepsFrom(value: unknown, depth = 0): string[] {
  if (depth > 8) return []
  if (typeof value === 'string') return [text(value, 5000)].filter(Boolean)
  if (Array.isArray(value)) return value.flatMap(item => stepsFrom(item, depth + 1)).slice(0, MAX_STEPS)
  if (record(value)) {
    if (value['@type'] === 'HowToSection' && Array.isArray(value.itemListElement)) {
      return stepsFrom(value.itemListElement, depth + 1)
    }
    return stepsFrom(value.text ?? value.itemListElement ?? value.name, depth + 1)
  }
  return []
}

function locateRecipe(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 5) return null
  if (Array.isArray(value)) {
    for (const node of value.slice(0, 200)) {
      const found = locateRecipe(node, depth + 1)
      if (found) return found
    }
  } else if (record(value)) {
    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']]
    if (types.some(type => typeof type === 'string' && /^(?:https?:\/\/schema\.org\/)?Recipe$/i.test(type))) return value
    return locateRecipe(value['@graph'], depth + 1) || locateRecipe(value.mainEntity, depth + 1)
  }
  return null
}

/**
 * Parse already-retrieved HTML. This function performs NO network operations.
 * Its caller must enforce SSRF, redirect, private-IP, size and time limits.
 */
export function importRecipeFromHtml(html: string, sourceUrl: string): UserRecipeDraft {
  if (typeof html !== 'string' || !html || html.length > MAX_HTML) throw new Error('HTML ontbreekt of is te groot')
  let parsedUrl: URL
  try { parsedUrl = new URL(sourceUrl) } catch { throw new Error('Ongeldige receptlink') }
  if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname || parsedUrl.username || parsedUrl.password) {
    throw new Error('Alleen publieke HTTPS-receptlinks zijn toegestaan')
  }
  const script = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
  let match: RegExpExecArray | null
  while ((match = script.exec(html)) !== null) {
    if (!/\btype\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'|application\/ld\+json)(?=[\s>]|$)/i.test(match[1])) continue
    if (match[2].length > 200_000) continue
    let data: unknown
    try { data = JSON.parse(match[2]) } catch { continue }
    const recipe = locateRecipe(data)
    if (!recipe) continue
    const ingredients = Array.isArray(recipe.recipeIngredient) ? recipe.recipeIngredient : []
    const lines = ingredients.map(item => typeof item === 'string' ? item : record(item) ? text(item.name) : '').filter(Boolean)
    if (!lines.length) throw new Error('Geen herkenbare ingrediënten; vul het recept handmatig in')
    return normalizedDraft({
      source: 'url', sourceUrl: parsedUrl.toString(),
      title: recipe.name,
      servings: recipeServings(recipe.recipeYield),
      minutes: recipeMinutes(recipe.totalTime) ?? recipeMinutes(recipe.cookTime),
      ingredients: lines,
      steps: stepsFrom(recipe.recipeInstructions),
    })
  }
  throw new Error('Geen schema.org/Recipe gevonden; vul het recept handmatig in')
}
